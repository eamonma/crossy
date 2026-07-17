// The hidden-WebView captcha minter (AAD-3, the app-target twin of iOS #230's TurnstileProvider).
// Supabase has Cloudflare Turnstile on project-wide, so the email OTP /otp send is refused with
// `captcha_failed` unless it carries a token; this mints an invisible one from the public site key.
//
// Why the app target: WebKit is not in :ui or :api (AAD-2, the layering that keeps the domain core
// JVM-pure). This class is deliberately THIN: it is one raw token pump. Every decision worth testing
// (the timeout, the single retry, the error mapping) lives in the pure crossy.api.TurnstileMintPolicy,
// which wraps this and is unit-tested against a fake (TurnstileMintPolicyTests). WebView code cannot
// run headlessly, so there is nothing here a JVM test could exercise; the owner device-verifies it.
//
// The token lifecycle mirrors iOS: mint() resets and executes the widget, then suspends on a
// continuation the JS bridge resumes when Turnstile calls back with a fresh token (or an error).
// Tokens are single-use and expire (~300s), so every send and resend mints anew.
//
// Every step logs under the "CrossyTurnstile" tag (page load, resource errors, bridge events,
// reveal), so one logcat filter shows exactly where a hung mint sits.

package crossy.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ApplicationInfo
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import crossy.api.TurnstileError
import crossy.api.TurnstileMinter
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * The pure page the hidden WebView loads, split out (no WebKit) so the render options and the bridge
 * contract read at a glance. Mirrors iOS TurnstilePage: an explicit render so we own size and
 * callbacks, `appearance: interaction-only` so nothing shows in the calm case, `retry: never` so the
 * policy owns retries. The interactive callbacks post through the bridge so the minter can reveal
 * the WebView when Cloudflare demands a hand-solved challenge. The site key is injected as a JS
 * string literal, escaped so the page stays well-formed for any future key shape (a site key is a
 * plain public token, but escape anyway).
 */
internal object TurnstilePage {
    /** The `@JavascriptInterface` object name the page posts every event through. */
    const val BRIDGE = "CrossyTurnstile"

    /** The origin the page loads under, so Turnstile sees an allowed hostname on the site key's
     *  allowlist. Never about:blank (Turnstile refuses an opaque origin). Matches iOS. */
    const val BASE_URL = "https://crossy.party"

    /** Kick a fresh challenge; the minter evaluates this each mint() once the page has loaded. */
    const val EXECUTE = "window.__crossyExecute && window.__crossyExecute();"

    fun html(siteKey: String): String {
        val key = jsStringLiteral(siteKey)
        return """
            <!doctype html>
            <html>
            <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
            <style>html,body{margin:0;padding:0;background:transparent;}</style>
            </head>
            <body>
            <div id="widget"></div>
            <script>
              // Call the @JavascriptInterface methods by exact arg count (onToken takes the token,
              // the rest take none), so the JS-to-Java bridge matches and never silently drops a call.
              function postToken(token) { try { window.$BRIDGE.onToken(token); } catch (e) {} }
              function postError() { try { window.$BRIDGE.onError(); } catch (e) {} }
              function postInteractive() { try { window.$BRIDGE.onInteractive(); } catch (e) {} }
              function postInteractiveDone() { try { window.$BRIDGE.onInteractiveDone(); } catch (e) {} }
              var widgetId = null;
              function renderWidget() {
                if (typeof turnstile === "undefined") { return false; }
                widgetId = turnstile.render("#widget", {
                  sitekey: $key,
                  appearance: "interaction-only",
                  size: "flexible",
                  retry: "never",
                  callback: function (token) { postToken(token); },
                  "error-callback": function () { postError(); return true; },
                  "before-interactive-callback": function () { postInteractive(); },
                  "after-interactive-callback": function () { postInteractiveDone(); }
                });
                return true;
              }
              // Bounded wait for api.js: a fresh ~10s budget per execute, then postError() so the
              // native policy's error mapping and retry engage. Without the cap, a blocked network
              // (the script tag never fires) would loop this forever and the mint would hang silent.
              var scriptWaitsLeft = 0;
              function awaitScriptThenRender() {
                if (renderWidget()) { return; }
                if (--scriptWaitsLeft <= 0) { postError(); return; }
                setTimeout(awaitScriptThenRender, 150);
              }
              // execute(): reset any prior render and run a fresh challenge, so every call yields a
              // single-use token. The first call renders (which runs the first challenge); later
              // calls reset then re-execute.
              window.__crossyExecute = function () {
                if (widgetId === null) {
                  scriptWaitsLeft = 67;
                  awaitScriptThenRender();
                  return;
                }
                try { turnstile.reset(widgetId); turnstile.execute(widgetId); }
                catch (e) { postError(); }
              };
            </script>
            </body>
            </html>
        """.trimIndent()
    }

    /** Escape a string as a double-quoted JS string literal (the site key). */
    fun jsStringLiteral(raw: String): String = buildString {
        append('"')
        for (ch in raw) when (ch) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            else -> append(ch)
        }
        append('"')
    }
}

/**
 * The WebView-backed [TurnstileMinter]. One raw acquisition per [mint]: reset and execute the widget,
 * then suspend until the JS bridge posts a token (resolve) or an error (throw [TurnstileError.WidgetError]).
 * No timeout and no retry here; those are [crossy.api.TurnstileMintPolicy]'s. Must be called on the
 * main thread: the Compose scope that drives the OTP send is main-confined, and WebView is main-only.
 * The `@JavascriptInterface` callbacks arrive on the WebView's JS thread, so they hop back via
 * [WebView.post].
 *
 * loadDataWithBaseURL is async, so the page (and `window.__crossyExecute`) may not exist when the
 * first mint arrives; the execute is queued and flushed by onPageFinished, never fired into a page
 * that cannot hear it. When Cloudflare demands an interactive challenge, the bridge's
 * before-interactive signal reveals the WebView at a solvable size, centered over the content view;
 * it shrinks back to an invisible 1x1 the moment a token or error posts (or the mint cancels).
 */
class WebViewTurnstileMinter(
    private val activity: Activity,
    private val siteKey: String,
) : TurnstileMinter {

    private var webView: WebView? = null

    /** The in-flight acquisition, resolved once by the first bridge event. */
    private var pending: CancellableContinuation<String>? = null

    /** True once onPageFinished has fired: `window.__crossyExecute` exists and can be evaluated. */
    private var pageReady = false

    /** A mint that arrived before the page loaded; onPageFinished flushes it exactly once. */
    private var executeQueued = false

    @SuppressLint("SetJavaScriptEnabled")
    override suspend fun mint(): String {
        if (siteKey.isEmpty()) throw TurnstileError.Unconfigured()
        val view = ensureWebView()
        // A second request supersedes a stuck one rather than leaking its continuation (the policy
        // calls sequentially, but a resend racing a stalled send must not dangle).
        pending?.let { if (it.isActive) it.resumeWithException(TurnstileError.Canceled()) }
        pending = null
        setRevealed(view, false)

        return suspendCancellableCoroutine { cont ->
            pending = cont
            cont.invokeOnCancellation {
                if (pending === cont) pending = null
                // The handler may run off-main (the policy's timeout cancels it); hop before
                // touching the view to re-hide a challenge the person never finished.
                view.post { setRevealed(view, false) }
            }
            Log.d(TAG, "mint start (pageReady=$pageReady)")
            // Never evaluate into a page that has not loaded: the execute would be a silent no-op
            // and nothing would ever resume the continuation. Queue it for onPageFinished instead.
            if (pageReady) view.evaluateJavascript(TurnstilePage.EXECUTE, null)
            else executeQueued = true
        }
    }

    /** Build the hidden WebView once and load the page. Kept 1px and invisible in the content view
     *  so it lays out and runs its script while showing nothing (the interaction-only widget draws
     *  nothing in the calm case); [setRevealed] grows it only for a hand-solved challenge. Added
     *  after the Compose content (first mint runs post-setContent), so a reveal draws on top. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureWebView(): WebView {
        webView?.let { return it }
        val view = WebView(activity)
        view.settings.javaScriptEnabled = true
        // Turnstile misbehaves in an Android WebView without DOM storage; it is harmless otherwise.
        view.settings.domStorageEnabled = true
        // Debuggable builds only: make the hidden page inspectable via chrome://inspect.
        if (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                Log.d(TAG, "page finished (executeQueued=$executeQueued)")
                pageReady = true
                if (executeQueued) {
                    executeQueued = false
                    view.evaluateJavascript(TurnstilePage.EXECUTE, null)
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                Log.w(TAG, "resource error ${error.errorCode} ${error.description}: ${request.url}")
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                response: WebResourceResponse,
            ) {
                Log.w(TAG, "http error ${response.statusCode}: ${request.url}")
            }
        }
        view.addJavascriptInterface(Bridge(), TurnstilePage.BRIDGE)
        view.visibility = View.INVISIBLE
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        root.addView(view, FrameLayout.LayoutParams(1, 1))
        view.loadDataWithBaseURL(
            TurnstilePage.BASE_URL,
            TurnstilePage.html(siteKey),
            "text/html",
            "utf-8",
            null,
        )
        webView = view
        return view
    }

    /** Show or hide the challenge surface. Revealed: a solvable centered box over the content view
     *  (the calm minimum: no chrome, no scrim, the widget is its own dialog). Hidden: back to the
     *  invisible 1x1 where the widget still runs its script. Main thread only. */
    private fun setRevealed(view: WebView, revealed: Boolean) {
        if (revealed) {
            val density = activity.resources.displayMetrics.density
            val params = FrameLayout.LayoutParams(
                (CHALLENGE_WIDTH_DP * density).toInt(),
                (CHALLENGE_HEIGHT_DP * density).toInt(),
                Gravity.CENTER,
            )
            // Breathing room from the dialog it floats over: dead center puts the box flush
            // under the send sheet's cancel button, so nudge it down and keep side margins for
            // narrow screens.
            val margin = (CHALLENGE_MARGIN_DP * density).toInt()
            params.setMargins(margin, (CHALLENGE_TOP_NUDGE_DP * density).toInt(), margin, 0)
            view.layoutParams = params
            view.visibility = View.VISIBLE
            view.bringToFront()
        } else {
            if (view.visibility == View.INVISIBLE) return
            view.layoutParams = FrameLayout.LayoutParams(1, 1)
            view.visibility = View.INVISIBLE
        }
    }

    /** Resume the pending acquisition exactly once, then clear it. A verdict (either way) also ends
     *  any revealed challenge. */
    private fun resolve(result: Result<String>) {
        webView?.let { setRevealed(it, false) }
        val cont = pending ?: return
        pending = null
        result.fold(
            onSuccess = { if (cont.isActive) cont.resume(it) },
            onFailure = { if (cont.isActive) cont.resumeWithException(it) },
        )
    }

    /** The JS callback bridge. Methods arrive on the WebView's JS thread, so each hops to the main
     *  thread via [WebView.post] before touching the continuation or the view. */
    private inner class Bridge {
        @JavascriptInterface
        fun onToken(token: String?) {
            webView?.post {
                Log.d(TAG, "bridge onToken (length=${token?.length ?: 0})")
                if (!token.isNullOrEmpty()) resolve(Result.success(token))
                else resolve(Result.failure(TurnstileError.WidgetError()))
            }
        }

        @JavascriptInterface
        fun onError() {
            webView?.post {
                Log.d(TAG, "bridge onError")
                resolve(Result.failure(TurnstileError.WidgetError()))
            }
        }

        @JavascriptInterface
        fun onInteractive() {
            webView?.post {
                Log.d(TAG, "bridge onInteractive: revealing challenge")
                webView?.let { setRevealed(it, true) }
            }
        }

        @JavascriptInterface
        fun onInteractiveDone() {
            webView?.post {
                Log.d(TAG, "bridge onInteractiveDone: hiding challenge")
                webView?.let { setRevealed(it, false) }
            }
        }
    }

    private companion object {
        /** One logcat filter (`adb logcat -s CrossyTurnstile`) shows the whole mint. */
        const val TAG = "CrossyTurnstile"

        /** The revealed challenge surface, sized for the Turnstile interactive box. */
        const val CHALLENGE_WIDTH_DP = 300
        const val CHALLENGE_HEIGHT_DP = 240

        /** Side breathing room, and the downward nudge that clears the send sheet's controls
         *  (a FrameLayout centers the child inclusive of margins, so the top margin shifts the
         *  box below dead center). */
        const val CHALLENGE_MARGIN_DP = 24
        const val CHALLENGE_TOP_NUDGE_DP = 96
    }
}
