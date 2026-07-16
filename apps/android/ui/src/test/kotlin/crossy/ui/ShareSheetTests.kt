// The share surface's row set, pinned (iOS ShareMenuTests): three intents in a fixed order with
// fixed titles, so the menu reads the same on both phones. Copy link keeps the primary slot (the
// group chat is the product's honest social space); Share… is the system's catch-all; Show QR
// stages the scannable code. The order is a one-line change in ShareRow if the owner swaps it, and
// this suite is what catches an accidental reorder.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ShareSheetTests {

    @Test
    fun `pins the share row order (Copy link primary, then Share, then Show QR)`() {
        assertEquals(
            listOf(ShareRow.COPY_LINK, ShareRow.SHARE, ShareRow.SHOW_QR),
            ShareRow.rows,
        )
    }

    @Test
    fun `pins the share row titles (iOS ShareMenuList)`() {
        assertEquals("Copy link", ShareRow.COPY_LINK.title)
        assertEquals("Share…", ShareRow.SHARE.title)
        assertEquals("Show QR code", ShareRow.SHOW_QR.title)
    }
}
