// The roster puck's fallback contract (PROTOCOL.md §4): the initial is the floor a null, loading, or
// failed avatar url falls back to, so the puck always renders something legible. These pin the pure
// decision the composable reads (puckInitial) with no Compose host: an empty name is a blank circle,
// a name's first character folds ASCII-only (INV-1), and a non-ASCII initial passes through verbatim.
// The delete-failure copy is pinned here too, the same "say what happened, offer the retry" voice the
// arrival errors hold.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class RosterPuckTests {
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
