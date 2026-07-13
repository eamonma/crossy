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

package crossy.app

import android.annotation.SuppressLint
import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
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
 * policy owns retries. The site key is injected as a JS string literal, escaped so the page stays
 * well-formed for any future key shape (a site key is a plain public token, but escape anyway).
 */
internal object TurnstilePage {
    /** The `@JavascriptInterface` object name the page posts every event through. */
    const val BRIDGE = "CrossyTurnstile"

    /** The origin the page loads under, so Turnstile sees an allowed hostname on the site key's
     *  allowlist. Never about:blank (Turnstile refuses an opaque origin). Matches iOS. */
    const val BASE_URL = "https://crossy.party"

    /** Kick a fresh challenge; the minter evaluates this each mint(). */
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
              // onError takes none), so the JS-to-Java bridge matches and never silently drops a call.
              function postToken(token) { try { window.$BRIDGE.onToken(token); } catch (e) {} }
              function postError() { try { window.$BRIDGE.onError(); } catch (e) {} }
              var widgetId = null;
              function renderWidget() {
                if (typeof turnstile === "undefined") { return false; }
                widgetId = turnstile.render("#widget", {
                  sitekey: $key,
                  appearance: "interaction-only",
                  size: "flexible",
                  retry: "never",
                  callback: function (token) { postToken(token); },
                  "error-callback": function () { postError(); return true; }
                });
                return true;
              }
              // execute(): reset any prior render and run a fresh challenge, so every call yields a
              // single-use token. The first call renders; later calls reset then re-execute.
              window.__crossyExecute = function () {
                if (widgetId === null) {
                  if (!renderWidget()) { setTimeout(window.__crossyExecute, 150); }
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
 */
class WebViewTurnstileMinter(
    private val activity: Activity,
    private val siteKey: String,
) : TurnstileMinter {

    private var webView: WebView? = null

    /** The in-flight acquisition, resolved once by the first bridge event. */
    private var pending: CancellableContinuation<String>? = null

    @SuppressLint("SetJavaScriptEnabled")
    override suspend fun mint(): String {
        if (siteKey.isEmpty()) throw TurnstileError.Unconfigured()
        val view = ensureWebView()
        // A second request supersedes a stuck one rather than leaking its continuation (the policy
        // calls sequentially, but a resend racing a stalled send must not dangle).
        pending?.let { if (it.isActive) it.resumeWithException(TurnstileError.Canceled()) }
        pending = null

        return suspendCancellableCoroutine { cont ->
            pending = cont
            cont.invokeOnCancellation { if (pending === cont) pending = null }
            view.evaluateJavascript(TurnstilePage.EXECUTE, null)
        }
    }

    /** Build the hidden WebView once and load the page. Kept 1px and invisible in the content view so
     *  it lays out and runs its script while showing nothing (the interaction-only widget draws
     *  nothing in the calm case). A forced interactive-challenge reveal is a device-verification
     *  follow-up, not wired here (see PARITY.md / the report). */
    @SuppressLint("SetJavaScriptEnabled")
    private fun ensureWebView(): WebView {
        webView?.let { return it }
        val view = WebView(activity)
        view.settings.javaScriptEnabled = true
        view.addJavascriptInterface(Bridge(), TurnstilePage.BRIDGE)
        view.visibility = View.INVISIBLE
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        root.addView(view, ViewGroup.LayoutParams(1, 1))
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

    /** Resume the pending acquisition exactly once, then clear it. */
    private fun resolve(result: Result<String>) {
        val cont = pending ?: return
        pending = null
        result.fold(
            onSuccess = { if (cont.isActive) cont.resume(it) },
            onFailure = { if (cont.isActive) cont.resumeWithException(it) },
        )
    }

    /** The JS callback bridge. Methods arrive on the WebView's JS thread, so each hops to the main
     *  thread via [WebView.post] before touching the continuation. */
    private inner class Bridge {
        @JavascriptInterface
        fun onToken(token: String?) {
            webView?.post {
                if (!token.isNullOrEmpty()) resolve(Result.success(token))
                else resolve(Result.failure(TurnstileError.WidgetError()))
            }
        }

        @JavascriptInterface
        fun onError() {
            webView?.post { resolve(Result.failure(TurnstileError.WidgetError())) }
        }
    }
}
