package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// The member-dot arithmetic (iOS RoomCardDots): at most `cap` dots, the rest an overflow the +N
// carries (the count-badge vocabulary, root DESIGN.md §10). Pure, so it pins here headlessly, the
// same posture as RoomShelves and CellFill.

class RoomCardDotsTests {
    @Test
    fun underOrAtCapPaintsEveryMemberNoOverflow_DESIGN10() {
        assertEquals(0 to 0, RoomCardDots.counts(0))
        assertEquals(1 to 0, RoomCardDots.counts(1))
        assertEquals(RoomCardDots.cap to 0, RoomCardDots.counts(RoomCardDots.cap))
    }

    @Test
    fun overCapClampsToCapAndOverflows_DESIGN10() {
        // Five members: four dots plus a +1, so the row never grows past the cap.
        assertEquals(RoomCardDots.cap to 1, RoomCardDots.counts(RoomCardDots.cap + 1))
        assertEquals(RoomCardDots.cap to 8, RoomCardDots.counts(RoomCardDots.cap + 8))
    }

    @Test
    fun negativeCountClampsToZero_DESIGN10() {
        // A malformed count never paints negative dots.
        assertEquals(0 to 0, RoomCardDots.counts(-3))
    }
}
