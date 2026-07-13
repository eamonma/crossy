// The captcha-mint policy under a fake minter (AAD-3, mirrors iOS #230): the timeout, the single
// retry, and the error mapping. The WebView minter is untestable headlessly, so these guard the only
// decisions worth testing, over a scripted fake. Virtual time (runTest) makes the timeout instant and
// deterministic: a fake that suspends past the window trips withTimeout the same way a dead widget
// would on device. Exceptions are caught inside the runTest scope (assertThrows cannot host a suspend
// call), so every attempt still runs on the test scheduler.

package crossy.api

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TurnstileMintPolicyTests {

    /** A scripted minter: each call runs the next step (or the last one forever), counting calls so
     *  a test can assert whether the retry fired. */
    private class FakeMinter(private vararg val steps: suspend () -> String) : TurnstileMinter {
        var calls = 0
            private set

        override suspend fun mint(): String {
            val step = steps[minOf(calls, steps.size - 1)]
            calls += 1
            return step()
        }
    }

    private fun policy(minter: TurnstileMinter, maxAttempts: Int = 2) =
        TurnstileMintPolicy(minter, timeoutMillis = 1_000, maxAttempts = maxAttempts)

    @Test
    fun `a token on the first try returns it and never retries`() = runTest {
        val minter = FakeMinter({ "cf-token" })
        assertEquals("cf-token", policy(minter).mint())
        assertEquals(1, minter.calls, "a clean mint must not retry")
    }

    @Test
    fun `a widget error on the first try retries once and returns the second token`() = runTest {
        val minter = FakeMinter(
            { throw TurnstileError.WidgetError() },
            { "cf-token-2" },
        )
        assertEquals("cf-token-2", policy(minter).mint())
        assertEquals(2, minter.calls, "a widget error is retryable, so the second attempt runs")
    }

    @Test
    fun `a widget error on every attempt throws WidgetError after the attempts are spent`() = runTest {
        val minter = FakeMinter({ throw TurnstileError.WidgetError() })
        val thrown = runCatching { policy(minter).mint() }.exceptionOrNull()
        assertTrue(thrown is TurnstileError.WidgetError, "expected WidgetError, got $thrown")
        assertEquals(2, minter.calls, "one try plus one retry")
    }

    @Test
    fun `a stalled acquisition times out each attempt and throws TimedOut`() = runTest {
        // The fake never resolves; withTimeout(1s) trips at virtual +1s per attempt, mapping to
        // TimedOut, then retrying, then giving up as TimedOut (never hanging the send).
        val minter = FakeMinter({ delay(Long.MAX_VALUE); "unreachable" })
        val thrown = runCatching { policy(minter).mint() }.exceptionOrNull()
        assertTrue(thrown is TurnstileError.TimedOut, "expected TimedOut, got $thrown")
        assertEquals(2, minter.calls, "the timeout is retryable, so both attempts run")
    }

    @Test
    fun `a raw unexpected throwable maps to WidgetError and rides the retry lane`() = runTest {
        // The adapter threw something untyped; the policy must map it to the calm widget-error lane
        // rather than crash the send, and retry it once.
        val minter = FakeMinter({ throw IllegalStateException("boom") })
        val thrown = runCatching { policy(minter).mint() }.exceptionOrNull()
        assertTrue(thrown is TurnstileError.WidgetError, "an untyped adapter failure maps to WidgetError, got $thrown")
        assertEquals(2, minter.calls)
    }

    @Test
    fun `a canceled acquisition is terminal and does not retry`() = runTest {
        val minter = FakeMinter({ throw TurnstileError.Canceled() })
        val thrown = runCatching { policy(minter).mint() }.exceptionOrNull()
        assertTrue(thrown is TurnstileError.Canceled, "expected Canceled, got $thrown")
        assertEquals(1, minter.calls, "a superseded acquisition is terminal, not retryable")
    }

    @Test
    fun `an unconfigured minter is terminal and does not retry`() = runTest {
        val minter = FakeMinter({ throw TurnstileError.Unconfigured() })
        val thrown = runCatching { policy(minter).mint() }.exceptionOrNull()
        assertTrue(thrown is TurnstileError.Unconfigured, "expected Unconfigured, got $thrown")
        assertEquals(1, minter.calls)
    }

    @Test
    fun `a genuine cancellation propagates and is never mapped to a mint failure`() = runTest {
        val minter = FakeMinter({ throw CancellationException("outer") })
        val thrown = runCatching { policy(minter).mint() }.exceptionOrNull()
        assertTrue(
            thrown is CancellationException && thrown !is TurnstileError,
            "cancellation is structured concurrency, not a retryable mint failure, got $thrown",
        )
        assertEquals(1, minter.calls)
    }
}
