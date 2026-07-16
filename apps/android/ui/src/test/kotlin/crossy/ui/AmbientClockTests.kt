// The shared ambient clock pinned against apps/ios AmbientClock.swift (ID-2; root DESIGN.md D15):
// 0:00 before the first fill, ticking from firstFillAt, frozen at the terminal instant, never
// negative under clock skew, and the m:ss / h:mm:ss display. Timestamps stay ISO 8601 wire strings;
// the parse tolerates the JS server's milliseconds and the fixture's plain form.
package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class AmbientClockTests {
    @Test
    fun `ID2 parses wire timestamps with and without fractional seconds`() {
        assertEquals(0L, AmbientClock.parse("1970-01-01T00:00:00Z"))
        assertEquals(1_500L, AmbientClock.parse("1970-01-01T00:00:01.500Z"))
        // The explicit-offset form some tooling emits still parses.
        assertEquals(0L, AmbientClock.parse("1970-01-01T00:00:00+00:00"))
        assertNull(AmbientClock.parse("not a timestamp"))
    }

    @Test
    fun `ID2 reads zero before the first fill, quietly`() {
        assertEquals(0, AmbientClock.elapsedSeconds(firstFillAtMillis = null, freezeAtMillis = null, nowMillis = 99_000))
        assertEquals("0:00", AmbientClock.display(firstFillAt = null, freezeAt = null, nowMillis = 99_000))
    }

    @Test
    fun `ID2 ticks from the first fill while the room runs`() {
        assertEquals(65, AmbientClock.elapsedSeconds(firstFillAtMillis = 10_000, freezeAtMillis = null, nowMillis = 75_000))
        assertEquals("1:05", AmbientClock.display(65))
    }

    @Test
    fun `ID2 freezes at the terminal instant, now no longer moves it`() {
        // completedAt (or abandonedAt, the same freeze seam) pins the clock; a later now is ignored.
        assertEquals(30, AmbientClock.elapsedSeconds(firstFillAtMillis = 0, freezeAtMillis = 30_000, nowMillis = 999_000))
        assertEquals(
            "0:30",
            AmbientClock.display(
                firstFillAt = "1970-01-01T00:00:00Z",
                freezeAt = "1970-01-01T00:00:30Z",
                nowMillis = 999_000,
            ),
        )
    }

    @Test
    fun `ID2 clock skew can never show a negative time`() {
        assertEquals(0, AmbientClock.elapsedSeconds(firstFillAtMillis = 50_000, freezeAtMillis = null, nowMillis = 40_000))
        assertEquals("0:00", AmbientClock.display(-5))
    }

    @Test
    fun `DESIGN6 m colon ss under an hour, h colon mm colon ss from there`() {
        assertEquals("0:00", AmbientClock.display(0))
        assertEquals("0:09", AmbientClock.display(9))
        assertEquals("59:59", AmbientClock.display(3599))
        assertEquals("1:00:00", AmbientClock.display(3600))
        assertEquals("2:05:09", AmbientClock.display(2 * 3600 + 5 * 60 + 9))
    }
}
