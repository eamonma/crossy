// The reconnect schedule as pure, clock-free store logic (AD-6; PROTOCOL.md §7, §9). These pin
// the numbers the transport adapter (:session) will sleep and dial with, mirroring
// apps/web/src/net/backoff.test.ts and apps/ios ReconnectPolicyTests.swift so the three clients
// cannot drift.

package crossy.store

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ReconnectPolicyTest {
    @Test
    fun backoffWalksZeroOneTwoFourEightSixteenThirtyThenCapsAtThirty_PROTOCOL7() {
        // unitRandom pinned to 1.0 exposes the undithered bases.
        val schedule = BackoffSchedule(random = { 1.0 })
        val delays = (0 until 9).map { schedule.nextDelaySeconds() }
        assertEquals(listOf(0.0, 1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0, 30.0), delays)
    }

    @Test
    fun fullJitterDrawsUniformlyInZeroToBase_PROTOCOL7() {
        val schedule = BackoffSchedule(random = { 0.5 })
        assertEquals(0.0, schedule.nextDelaySeconds()) // base 0
        assertEquals(0.5, schedule.nextDelaySeconds()) // base 1
        assertEquals(1.0, schedule.nextDelaySeconds()) // base 2
        // The zero draw is a legal full-jitter outcome at every attempt.
        val floor = BackoffSchedule(random = { 0.0 })
        assertEquals(List(7) { 0.0 }, (0 until 7).map { floor.nextDelaySeconds() })
    }

    @Test
    fun thirtySecondSurvivalResetsTheWalk_PROTOCOL7() {
        val schedule = BackoffSchedule(random = { 1.0 })
        repeat(5) { schedule.nextDelaySeconds() }
        schedule.connectionSurvived(30.0)
        assertEquals(0, schedule.attempt)
        assertEquals(0.0, schedule.nextDelaySeconds(), "a reset walk starts over at 0 s")
    }

    @Test
    fun shortLivedConnectionDoesNotResetTheWalk_PROTOCOL7() {
        val schedule = BackoffSchedule(random = { 1.0 })
        repeat(3) { schedule.nextDelaySeconds() }
        schedule.connectionSurvived(29.9)
        assertEquals(3, schedule.attempt)
        assertEquals(4.0, schedule.nextDelaySeconds(), "the walk continues where it left off")
    }

    @Test
    fun policyConstantsMatchProtocol_PROTOCOL7_PROTOCOL9() {
        assertEquals(listOf(0.0, 1.0, 2.0, 4.0, 8.0, 16.0, 30.0), ReconnectPolicy.backoffBaseSeconds)
        assertEquals(30.0, ReconnectPolicy.resetAfterSeconds)
        assertEquals(15.0, ReconnectPolicy.heartbeatIntervalSeconds)
    }

    @Test
    fun baseDelayClampsAttemptIntoTheTable_PROTOCOL7() {
        assertEquals(0.0, ReconnectPolicy.baseDelaySeconds(-1))
        assertEquals(0.0, ReconnectPolicy.baseDelaySeconds(0))
        assertEquals(30.0, ReconnectPolicy.baseDelaySeconds(6))
        assertEquals(30.0, ReconnectPolicy.baseDelaySeconds(99))
        // A draw outside [0, 1] cannot push a delay past the cap or below zero.
        assertEquals(30.0, ReconnectPolicy.delaySeconds(6, 2.0))
        assertEquals(0.0, ReconnectPolicy.delaySeconds(6, -1.0))
    }
}
