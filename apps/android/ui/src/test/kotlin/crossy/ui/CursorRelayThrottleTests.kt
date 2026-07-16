// The cursor relay throttle (PROTOCOL.md §9: at most 10 moveCursor per second per client),
// mirroring the web's posture and iOS's CursorRelayThrottleTests: a leading send plus one coalesced
// trailing send, so the room sees a hop at once, a run of hops collapses to the cap, and the final
// position always goes out. Pure over injected times.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CursorRelayThrottleTests {
    @Test
    fun `the cap is the wire's ten per second protocol-9`() {
        assertEquals(0.1, CursorRelayThrottle.CAP_SECONDS)
    }

    @Test
    fun `the first change sends immediately the leading edge`() {
        val throttle = CursorRelayThrottle()
        assertEquals(CursorRelayThrottle.Verdict.Send, throttle.selectionChanged(5.0))
    }

    @Test
    fun `a change inside the window schedules one trailing send then coalesces protocol-9`() {
        val throttle = CursorRelayThrottle()
        assertEquals(CursorRelayThrottle.Verdict.Send, throttle.selectionChanged(5.0))
        // 30 ms later: too soon, schedule the remainder of the window.
        val scheduled = throttle.selectionChanged(5.03)
        assertTrue(scheduled is CursorRelayThrottle.Verdict.ScheduleTrailing, "expected a trailing schedule")
        assertEquals(0.07, (scheduled as CursorRelayThrottle.Verdict.ScheduleTrailing).afterSeconds, 0.0001)
        // Further changes coalesce into the pending trailing send.
        assertEquals(CursorRelayThrottle.Verdict.Coalesce, throttle.selectionChanged(5.05))
        assertEquals(CursorRelayThrottle.Verdict.Coalesce, throttle.selectionChanged(5.09))
    }

    @Test
    fun `the trailing fire restarts the window protocol-9`() {
        val throttle = CursorRelayThrottle()
        assertEquals(CursorRelayThrottle.Verdict.Send, throttle.selectionChanged(5.0))
        throttle.selectionChanged(5.03)
        throttle.trailingFired(5.1)
        // 50 ms after the trailing send is still inside the window.
        val scheduled = throttle.selectionChanged(5.15)
        assertTrue(scheduled is CursorRelayThrottle.Verdict.ScheduleTrailing, "expected a trailing schedule")
        assertEquals(0.05, (scheduled as CursorRelayThrottle.Verdict.ScheduleTrailing).afterSeconds, 0.0001)
    }

    @Test
    fun `a change past the window sends again`() {
        val throttle = CursorRelayThrottle()
        assertEquals(CursorRelayThrottle.Verdict.Send, throttle.selectionChanged(5.0))
        assertEquals(CursorRelayThrottle.Verdict.Send, throttle.selectionChanged(5.2))
    }

    @Test
    fun `a cancelled trailing allows a new schedule`() {
        val throttle = CursorRelayThrottle()
        assertEquals(CursorRelayThrottle.Verdict.Send, throttle.selectionChanged(5.0))
        throttle.selectionChanged(5.03)
        throttle.trailingCancelled()
        assertTrue(
            throttle.selectionChanged(5.05) is CursorRelayThrottle.Verdict.ScheduleTrailing,
            "a cancelled trailing send must not block the next one",
        )
    }
}
