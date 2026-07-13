// The invite link's parse and emit contract (PROTOCOL.md §12 "Invite links"): the
// code is the join capability, so a recognized payload digests to it and everything
// else to null, and the emitted link is the canonical short form byte for byte.
// These vectors are ported from the iOS twins (InviteScanTests, ShareInviteTests in
// #226 / a8b1a29) and the web emit suite (invite.test.ts in #225 / eb9faf9) so the
// three clients agree. Casing is bytewise ASCII per INV-1: a lowercased link still
// joins, a glyph no code can contain never conjures one.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class InviteLinkTests {

    // Parse: the recognized shapes all digest to the code (iOS
    // test_theThreeInviteShapesAllDigestToTheCode_PROTOCOL12, a8b1a29).
    @Test
    fun `INV-1 the invite shapes all digest to the code (PROTOCOL 12)`() {
        // Bare read-aloud code, with and without cosmetic separators.
        assertEquals("AB23CD45", InviteScan.parse("AB23CD45"))
        assertEquals("AB23CD45", InviteScan.parse("AB23-CD45"))
        assertEquals("AB23CD45", InviteScan.parse(" AB23 CD45 \n"))
        // An old named share link still in the wild (links are code-only now): the
        // extra param never confuses the digest.
        assertEquals(
            "AB23CD45",
            InviteScan.parse("https://crossy.app/game/g-1?code=AB23CD45&name=Tuesday%20evening"),
        )
        // The legacy query-routed link still in the wild.
        assertEquals("AB23CD45", InviteScan.parse("https://crossy.app/?game=g-1&code=AB23CD45"))
        // The §12 unfurl link, the one public route.
        assertEquals("AB23CD45", InviteScan.parse("https://crossy.app/g/AB23CD45"))
        // The canonical short link the web app emits: a single path segment that IS
        // the code (host-agnostic, like the /g/ branch).
        assertEquals("AB23CD45", InviteScan.parse("https://crossy.ing/AB23CD45"))
    }

    // Parse casing is bytewise ASCII (iOS test_casingIsBytewiseASCII_INV1, a8b1a29).
    @Test
    fun `INV-1 parse casing is bytewise ASCII`() {
        assertEquals("AB23CD45", InviteScan.parse("ab23cd45"))
        assertEquals("AB23CD45", InviteScan.parse("https://crossy.app/g/ab23cd45"))
        // The short link's segment normalizes too: a lowercased host path joins.
        assertEquals("AB23CD45", InviteScan.parse("https://crossy.ing/ab23cd45"))
    }

    // Parse rejects (iOS test_proseAndForeignPayloadsNeverConjureACode, a8b1a29).
    @Test
    fun `INV-1 prose and foreign payloads never conjure a code`() {
        // Sanitize alone would fish "HELLWRLD" out of this; the digest must not.
        assertNull(InviteScan.parse("HELLO WORLD"))
        assertNull(InviteScan.parse(""))
        assertNull(InviteScan.parse("WIFI:S:cafe;T:WPA;P:secret;;"))
        // Seven characters is no code; neither is a link without the capability.
        assertNull(InviteScan.parse("AB23CD4"))
        assertNull(InviteScan.parse("https://crossy.app/game/g-1"))
        assertNull(InviteScan.parse("https://crossy.app/game/g-1?code=NOPE"))
        // A /g/ path whose tail only shrinks to eight after dropping glyphs (0, 1, I,
        // O can appear in no code) is not an invite.
        assertNull(InviteScan.parse("https://crossy.app/g/AB23CD450"))
        // A single-segment path that is NOT a code is a plain route, not a short
        // link: the short-link branch is shape-gated, never a catch-all.
        assertNull(InviteScan.parse("https://crossy.party/puzzles"))
    }

    // Emit: the canonical short link, byte for byte (iOS ShareInviteTests a8b1a29,
    // web invite.test.ts eb9faf9). The host arrives as data (BuildConfig.INVITE_HOST,
    // default crossy.ing per api #222 / fc9c26a).
    @Test
    fun `emit builds the canonical short link`() {
        assertEquals("https://crossy.ing/ABCD2345", ShareInvite.url("crossy.ing", "ABCD2345"))
    }

    // The short link is the host plus the code: no gameId, no name, no query string
    // (web "carries only the code" case, eb9faf9).
    @Test
    fun `emit carries only the code`() {
        val url = ShareInvite.url("crossy.ing", "ABCD2345")
        assertEquals("https://crossy.ing/ABCD2345", url)
        assertTrue(url != null && !url.contains("name"))
        assertTrue(url != null && !url.contains("game"))
        assertTrue(url != null && !url.contains("?"))
    }

    // A null or empty code means there is nothing to share yet (iOS
    // test_noCodeMeansNoLink / test_emptyCodeMeansNoLink, a8b1a29).
    @Test
    fun `emit yields no link without a code`() {
        assertNull(ShareInvite.url("crossy.ing", null))
        assertNull(ShareInvite.url("crossy.ing", ""))
    }

    // The alphabet mirror is pinned, the same fixture the iOS InviteCodeEntry and the
    // api INVITE_ALPHABET pin (INV-1: no 0/1/I/O).
    @Test
    fun `INV-1 the invite alphabet mirror is pinned`() {
        assertEquals("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", InviteCode.ALPHABET)
        assertEquals(8, InviteCode.LENGTH)
        assertTrue(InviteCode.ALPHABET.none { it == '0' || it == '1' || it == 'I' || it == 'O' })
    }
}
