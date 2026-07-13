// The PROTOCOL.md §7 reconnect backoff as pure store logic (AD-6, mirrored): delays of 0, 1, 2,
// 4, 8, 16, then 30 seconds, capped at 30, each with full jitter; reset after a connection
// survives 30 seconds. Twin of apps/ios/Sources/CrossyStore/Reconnect.swift and
// apps/web/src/net/backoff.ts. Pure and clock-free (the INV-9 ethos applied to the store):
// randomness is injected, durations arrive as data, and the transport adapter owns the timers.
// It only sleeps, jitters, and dials with the numbers decided here.

package crossy.store

import kotlin.random.Random

/** The schedule's fixed numbers, pinned where unit tests can read them. */
object ReconnectPolicy {
    /** PROTOCOL.md §7: 0, 1, 2, 4, 8, 16, then 30 seconds, capped at 30. */
    val backoffBaseSeconds: List<Double> = listOf(0.0, 1.0, 2.0, 4.0, 8.0, 16.0, 30.0)

    /** A connection that survives this long resets the schedule (PROTOCOL.md §7). */
    const val resetAfterSeconds: Double = 30.0

    /** Clients send `heartbeat` every 15 s (PROTOCOL.md §5, §9). The adapter schedules the
     * timer; this is the number it schedules with. */
    const val heartbeatIntervalSeconds: Double = 15.0

    /** The undithered base delay for one attempt (0-based), clamped at the cap. */
    fun baseDelaySeconds(attempt: Int): Double =
        backoffBaseSeconds[attempt.coerceIn(0, backoffBaseSeconds.size - 1)]

    /** Full jitter: uniform in [0, base]. `unitRandom` is a draw in [0, 1]. */
    fun delaySeconds(attempt: Int, unitRandom: Double): Double =
        baseDelaySeconds(attempt) * unitRandom.coerceIn(0.0, 1.0)
}

/**
 * The reconnect walk. A value the store owns (the state machine's attempt counter is store
 * state); the adapter consumes delays and reports survival times. `random` draws uniformly in
 * [0, 1); injectable so tests pin the walk exactly, the ambient default only in production.
 */
class BackoffSchedule(private val random: () -> Double = { Random.nextDouble() }) {
    var attempt: Int = 0
        private set

    /** The next reconnect delay in seconds, consuming one attempt. */
    fun nextDelaySeconds(): Double {
        val delay = ReconnectPolicy.delaySeconds(attempt, random())
        attempt += 1
        return delay
    }

    fun reset() {
        attempt = 0
    }

    /** Report how long the last connection lived; a long-enough life resets the walk. */
    fun connectionSurvived(seconds: Double) {
        if (seconds >= ReconnectPolicy.resetAfterSeconds) reset()
    }
}
