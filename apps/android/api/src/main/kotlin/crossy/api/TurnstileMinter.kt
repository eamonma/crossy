// The captcha mint port and its policy (AAD-3, mirrors iOS #230's TurnstileProvider). Supabase has
// Cloudflare Turnstile on project-wide, so GoTrue refuses the /otp send with `captcha_failed` unless
// the request carries a token. Minting one needs a hidden WebView (WebKit is not in this ring), so
// the WebView-backed minter lives in :app; here we own only the PORT the app implements plus the
// PURE policy that wraps it. The split is deliberate: WebView code is untestable headlessly, so every
// decision (the timeout, the single retry, the error mapping) lives in [TurnstileMintPolicy] and is
// tested against a fake minter (TurnstileMintPolicyTests). The port mirrors BearerTokenProvider: an
// interface in :api, the concrete adapter in :app.

package crossy.api

import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.cancellation.CancellationException

/**
 * Why a captcha mint failed. The sign-in screen renders one calm send-failure sentence for all of
 * these (a mint failure must never fall through to a silent captcha-less send the server rejects);
 * the specific reason is diagnostic only. Twin of iOS `TurnstileError`.
 */
public sealed class TurnstileError(message: String) : Exception(message) {
    /** No site key in this build: the composition root omits the policy when the key is empty, so a
     *  keyless path never reaches a minter. This is the belt-and-suspenders case a misconfigured
     *  minter would raise. Terminal (retrying cannot conjure a key). */
    public class Unconfigured : TurnstileError("no turnstile site key in this build")

    /** The widget signaled an error callback (a network fault reaching Cloudflare, an expired
     *  challenge, a bad site key), or the raw acquisition threw something unexpected. Retryable. */
    public class WidgetError : TurnstileError("turnstile widget error")

    /** No token arrived inside the timeout window, so the send is not left hanging. Retryable. */
    public class TimedOut : TurnstileError("turnstile token timed out")

    /** The acquisition was superseded or the host web view went away mid-request. Terminal: a fresh
     *  request already replaced this one, so retrying the dead one is pointless. */
    public class Canceled : TurnstileError("turnstile request canceled")
}

/**
 * One raw Turnstile acquisition. The WebView adapter resets and executes the widget, then suspends on
 * the JS callback bridge until a token or an error posts back. It applies NO timeout and NO retry of
 * its own (those are the policy's), and it throws [TurnstileError] subtypes only for the widget's own
 * signals. Each call yields a FRESH single-use token (tokens are single-use and expire ~300s, so
 * every send and resend mints anew). A fake stands in for the policy's tests.
 */
public interface TurnstileMinter {
    public suspend fun mint(): String
}

/**
 * The pure captcha-mint policy: the timeout, the single retry, and the error mapping in one tested
 * place, so the WebView minter stays a thin token pump. Mirrors the iOS TurnstileProvider's 30s
 * timeout and calm-failure posture (#230); the retry-once is an Android addition (iOS leaves retry to
 * the widget's own `retry: "never"` and one hand resend), cheap insurance against a transient widget
 * blip before the person sees the send-failed copy.
 *
 * Retryability by verdict: [TurnstileError.TimedOut] and [TurnstileError.WidgetError] retry; a raw
 * unexpected throwable maps to WidgetError and retries; [TurnstileError.Canceled] and
 * [TurnstileError.Unconfigured] are terminal and rethrow at once. A genuine structured
 * [CancellationException] always propagates (it is never a mint failure).
 */
public class TurnstileMintPolicy(
    private val minter: TurnstileMinter,
    private val timeoutMillis: Long = DEFAULT_TIMEOUT_MILLIS,
    private val maxAttempts: Int = DEFAULT_MAX_ATTEMPTS,
) {
    /**
     * Mint a token, or throw the mapped [TurnstileError] after the attempts are spent. Returns the
     * first token an attempt yields; the caller (the OTP send) nests it under
     * `gotrue_meta_security.captcha_token`.
     */
    public suspend fun mint(): String {
        var lastError: TurnstileError = TurnstileError.WidgetError()
        repeat(maxAttempts) {
            val mapped: TurnstileError =
                try {
                    return withTimeout(timeoutMillis) { minter.mint() }
                } catch (timeout: TimeoutCancellationException) {
                    // withTimeout cancels the acquisition and throws this; it is safe to catch (the
                    // outer scope is untouched) and it is retryable weather, not a verdict.
                    TurnstileError.TimedOut()
                } catch (terminal: TurnstileError.Canceled) {
                    throw terminal
                } catch (terminal: TurnstileError.Unconfigured) {
                    throw terminal
                } catch (typed: TurnstileError) {
                    typed
                } catch (cancellation: CancellationException) {
                    // A genuine outer cancellation (the screen left): never swallow it into a mint
                    // failure, propagate so structured concurrency unwinds.
                    throw cancellation
                } catch (unexpected: Throwable) {
                    // Anything the raw minter did not type rides the widget-error lane, so a stray
                    // adapter exception still reads as one calm send failure rather than a crash.
                    TurnstileError.WidgetError()
                }
            lastError = mapped
        }
        throw lastError
    }

    public companion object {
        /** 30s, the iOS TurnstileProvider.timeout: generous enough for a slow network or a
         *  hand-solved interactive challenge, short enough that a dead widget never hangs the send. */
        public const val DEFAULT_TIMEOUT_MILLIS: Long = 30_000

        /** One try plus one retry. */
        public const val DEFAULT_MAX_ATTEMPTS: Int = 2
    }
}
