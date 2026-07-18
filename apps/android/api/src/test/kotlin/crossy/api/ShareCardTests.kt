// The completion share card's pure URL + name logic (design/post-game/SHARE.md; PROTOCOL.md §12
// `GET /s/{token}/card.png`). No wire, no Android: a plain JVM test, so CI (android.yml's six pure
// modules) exercises the card contract that :app rides but never builds. INV-6 is structural here
// (the inputs are a URL and a ground), so these pin the shape, not a leak.

package crossy.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ShareCardTests {

    private val shareUrl = "https://crossy.ing/s/aB3dEf7GhIjKlMnOpQrStUvWxYz012345678-_abcd"

    @Test
    fun pngUrl_appendsCardPathWithPortraitVariantAndLightGround() {
        assertEquals(
            "$shareUrl/card.png?variant=portrait&ground=light",
            ShareCard.pngUrl(shareUrl, ShareCard.Ground.LIGHT),
        )
    }

    @Test
    fun pngUrl_carriesTheDarkGroundTokenForObservatory() {
        assertEquals(
            "$shareUrl/card.png?variant=portrait&ground=dark",
            ShareCard.pngUrl(shareUrl, ShareCard.Ground.DARK),
        )
    }

    @Test
    fun pngUrl_alwaysRequestsThePortraitVariantTheOnlyOneAClientAsksFor() {
        // Portrait is the flagship poster (SHARE.md); a client never requests og or solo by name.
        for (ground in ShareCard.Ground.entries) {
            assertTrue(ShareCard.pngUrl(shareUrl, ground).contains("variant=portrait"))
        }
    }

    @Test
    fun pngUrl_isBuiltVerbatimOnTheMintedUrlSoTheTokenIsNeverReshaped() {
        // The mint owns the origin and the 256-bit token; the card URL only appends, so the exact
        // shareUrl is a prefix of the result (no re-encode, no origin rewrite).
        assertTrue(ShareCard.pngUrl(shareUrl, ShareCard.Ground.LIGHT).startsWith("$shareUrl/card.png"))
    }

    @Test
    fun pngUrl_trimsAtrailingSlashSoThePathNeverDoubles() {
        assertEquals(
            "$shareUrl/card.png?variant=portrait&ground=light",
            ShareCard.pngUrl("$shareUrl/", ShareCard.Ground.LIGHT),
        )
    }

    @Test
    fun groundWireTokens_matchTheCardPngContractExactly() {
        // The card.png query reads `ground=light|dark` verbatim (SHARE.md; the sibling wave's params).
        assertEquals("light", ShareCard.Ground.LIGHT.wire)
        assertEquals("dark", ShareCard.Ground.DARK.wire)
    }

    @Test
    fun fileName_isAstableHumanLabelWithNoTokenAndNoClock() {
        // A save-to-files keeps a readable name; no token, no timestamp, so it never multiplies files.
        assertEquals("crossy-card.png", ShareCard.FILE_NAME)
        assertTrue(ShareCard.FILE_NAME.endsWith(".png"), "the artifact is a PNG (image/png)")
    }
}
