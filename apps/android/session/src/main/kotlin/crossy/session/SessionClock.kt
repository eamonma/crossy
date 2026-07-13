// The driver's only view of time (AD-6 applied to timers): a monotonic now for survival
// measurement and a suspension for the policy's delays. Injected so driver tests script every
// sleep and every elapsed second; durations are plain seconds, matching ReconnectPolicy's data.
// Kotlin twin of apps/ios/Sources/CrossySession/SessionClock.swift.

package crossy.session

import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.coroutineContext

/**
 * A monotonic clock plus a sleeper. Seconds as Double end to end, the same unit
 * [crossy.store.BackoffSchedule] and [crossy.store.ReconnectPolicy] speak.
 */
public interface SessionClock {
    /** Monotonic seconds; only differences are meaningful. */
    public fun now(): Double

    /** Suspend for [seconds]; honors cancellation like [delay]. */
    public suspend fun sleep(seconds: Double)
}

/**
 * The production clock over `System.nanoTime()`: monotonic, dispatcher-scheduled, cancellation
 * propagating. A non-positive delay is a cancellation check and an immediate return, matching
 * the Swift twin (delay(0) is already a no-op, but the explicit check keeps the contract exact).
 */
public class MonotonicSessionClock : SessionClock {
    private val origin: Long = System.nanoTime()

    override fun now(): Double = (System.nanoTime() - origin) / 1_000_000_000.0

    override suspend fun sleep(seconds: Double) {
        if (seconds <= 0.0) {
            coroutineContext.ensureActive()
            return
        }
        delay((seconds * 1000.0).toLong())
    }
}
