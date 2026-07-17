// The roster puck's fallback contract (PROTOCOL.md §4): the initial is the floor a null, loading, or
// failed avatar url falls back to, so the puck always renders something legible. These pin the pure
// decision the composable reads (puckInitial) with no Compose host: an empty name is a blank circle,
// a name's first character folds ASCII-only (INV-1), and a non-ASCII initial passes through verbatim.
// The delete-failure copy is pinned here too, the same "say what happened, offer the retry" voice the
// arrival errors hold.

package crossy.ui

import crossy.design.IdentityRoster
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test

class RosterPuckTests {
    @Test
    fun puckIdentity_bucketsTheWireColorSlot_neverTheUserIdHash_whenAWireExists() {
        // design/identity/ROOM-COLORS.md: a client only ever buckets the wire color into a roster
        // slot, it never paints the wire verbatim. D28 made the server assign room-aware slots, so a
        // bumped member's wire slot can diverge from their local id hash; the off-board puck must
        // follow the wire, the same slot the board buckets (Presence, RoomScreen), not the hash.
        val wire = "#000000" // low 24 bits 0 -> roster slot 0
        assertEquals(IdentityRoster.colorForWireColor(wire), puckIdentity("ada", wire))
        assertNotEquals(
            IdentityRoster.color("ada"),
            puckIdentity("ada", wire),
            "ada's id hash lands a different slot than the wire, and the wire wins",
        )
    }

    @Test
    fun puckIdentity_nullOrEmptyWire_fallsBackToTheIdHash() {
        // A Settings/onboarding puck carries no wire (null); a seeded member's wire is empty. Both
        // read the identity hash, so those pucks render exactly as before.
        assertEquals(IdentityRoster.color("ada"), puckIdentity("ada", null))
        assertEquals(IdentityRoster.color("ada"), puckIdentity("ada", ""))
    }

    @Test
    fun puckInitial_emptyName_isBlank_soTheColoredCircleStandsAlone() {
        // PROTOCOL.md §4: a nameless account (pre-onboarding) shows the colored circle, no letter.
        assertEquals("", puckInitial(""))
    }

    @Test
    fun puckInitial_foldsFirstCharacterAsciiOnly_INV1() {
        assertEquals("A", puckInitial("ada"))
        assertEquals("Z", puckInitial("zeb"))
    }

    @Test
    fun puckInitial_nonAsciiInitial_passesThroughVerbatim_INV1() {
        // Locale-aware casing is forbidden (INV-1): a non-ASCII first character is never folded.
        assertEquals("Ω", puckInitial("Ωmega"))
        assertEquals("é", puckInitial("éric"))
    }

    @Test
    fun deleteAccountErrorCopy_keysOnStableCodes_neverTheRawCode() {
        assertEquals(
            "Couldn't reach Crossy to delete your account. Try again.",
            deleteAccountErrorCopy(null),
        )
        assertEquals(
            "Your sign-in expired. Sign in again, then delete your account.",
            deleteAccountErrorCopy("UNAUTHORIZED"),
        )
        assertEquals(
            "Couldn't delete your account. Try again.",
            deleteAccountErrorCopy("SOME_UNKNOWN_CODE"),
        )
    }
}
