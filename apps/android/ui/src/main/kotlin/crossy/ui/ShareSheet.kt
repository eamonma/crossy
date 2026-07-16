// The share surface (iOS ShareMenu.swift): the invite's three intents plus the read-aloud code as
// the header, and the QR the projector shows drawn on a Compose Canvas (iOS QRTile). Copy link is
// primary (the group chat is the product's honest social space); Share… hands to the system sheet;
// Show QR stages the scannable code, because a row cannot render one inline. The header carries the
// invite code verbatim so the read-aloud channel (the code's alphabet was designed to be spoken on
// a call, EXPERIENCE.md §5) stays visible.
//
// AD-2 split, mirroring iOS: this layer is pure Compose over the link and reports intents; the app
// target owns the clipboard and the system share sheet (the callbacks below). Presentation diverges
// from iOS by platform idiom: iOS drops a native Menu out of the pill, Android raises the share
// surface as a bottom sheet (the platform's share idiom). The composition root presents it, because
// the share link and code live there (RoomBar's chip cannot reach them through RoomScreen), the same
// posture as iOS where the app target closes over the link and CrossyUI stays pure.

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/** The QR tile's pure geometry (iOS QRTileLayout): a paper tile with a quiet zone, sized above the
 *  scannable floor. Dark modules on a light tile in BOTH grounds, the projector's rule. */
object QrTileLayout {
    val side = 220.dp
    val quietZone = 16.dp
    val cornerRadius = 12.dp
}

/** The share surface's row set, pinned in tests (iOS ShareMenuList): three intents, Copy link
 *  keeping the primary slot, then the system's catch-all, then the QR's stage. */
enum class ShareRow {
    COPY_LINK,
    SHARE,
    SHOW_QR,
    ;

    val title: String
        get() = when (this) {
            COPY_LINK -> "Copy link"
            SHARE -> "Share…"
            SHOW_QR -> "Show QR code"
        }

    companion object {
        /** Row order (Copy link primary), a one-line change if the owner later swaps QR up. */
        val rows: List<ShareRow> = listOf(COPY_LINK, SHARE, SHOW_QR)
    }
}

/**
 * The invite share sheet (iOS ShareMenu + ShareQRSheet as one bottom sheet). The header is the
 * read-aloud [code]; the rows report their intents through the callbacks; Show QR swaps the row
 * stack for the scannable tile over [url]. The app target supplies [onSystemShare] (the system share
 * sheet) and [onCopyLink] (the clipboard); this layer owns only the presentation and the matrix.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSheet(
    ground: GridGround,
    code: String,
    url: String,
    onSystemShare: () -> Unit,
    onCopyLink: () -> Unit,
    onDismiss: () -> Unit,
) {
    val tokens = ground.tokens
    val sheetState = rememberModalBottomSheetState()
    var showQr by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = tokens.canvas.toColor(),
        contentColor = tokens.ink.toColor(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // The read-aloud headline: the code verbatim, monospaced so it never jitters, tabular for
            // reading it aloud on a call (EXPERIENCE.md §5). Present in both the row view and the QR
            // view, so the spoken channel survives either.
            Text(
                text = code,
                fontSize = 26.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = tokens.ink.toColor(),
                modifier = Modifier.padding(top = 4.dp, bottom = 20.dp),
            )

            if (showQr) {
                QrTile(matrix = remember(url) { InviteQr.matrix(url) })
                Text(
                    text = "Point a camera here to join.",
                    fontSize = 13.sp,
                    color = tokens.number.toColor(),
                    modifier = Modifier.padding(top = 16.dp),
                )
            } else {
                Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    for (row in ShareRow.rows) {
                        ShareRowItem(row, ground) {
                            when (row) {
                                ShareRow.COPY_LINK -> { onCopyLink(); onDismiss() }
                                ShareRow.SHARE -> { onSystemShare(); onDismiss() }
                                ShareRow.SHOW_QR -> showQr = true
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One share row: a calm full-width tap target, ink title, no invented color (the roster owns the
 *  only color, ID-8). Text-only by choice, so the sheet pulls in no icon pack and reads as paper. */
@Composable
private fun ShareRowItem(row: ShareRow, ground: GridGround, onClick: () -> Unit) {
    val tokens = ground.tokens
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 16.dp),
    ) {
        Text(
            text = row.title,
            fontSize = 17.sp,
            fontWeight = if (row == ShareRow.COPY_LINK) FontWeight.SemiBold else FontWeight.Normal,
            color = tokens.ink.toColor(),
        )
    }
}

/**
 * The QR as paper (iOS QRTile): the pure [InviteQr] matrix drawn in a Canvas, dark modules on a
 * light tile in BOTH grounds (a scannable code is dark-on-light, the projector's rule, apps/web
 * PartyView), Studio's paper tokens fixed so Observatory never darkens it. Module edges snap to
 * pixels so adjacent modules tile without seams. Content, not chrome.
 */
@Composable
fun QrTile(matrix: QrMatrix?, modifier: Modifier = Modifier) {
    // Studio paper and ink in both grounds: a scannable code is always dark-on-light.
    val paper = GridGround.STUDIO.tokens.cell.toColor()
    val ink = GridGround.STUDIO.tokens.ink.toColor()
    Box(
        modifier = modifier
            .size(QrTileLayout.side)
            .clip(RoundedCornerShape(QrTileLayout.cornerRadius))
            .background(paper)
            .padding(QrTileLayout.quietZone),
        contentAlignment = Alignment.Center,
    ) {
        if (matrix != null && matrix.size > 0) {
            Canvas(modifier = Modifier.fillMaxWidth().size(QrTileLayout.side - QrTileLayout.quietZone * 2)) {
                val count = matrix.size
                val side = size.minDimension
                // Snap each module's edges to whole pixels so neighbours tile seamlessly (iOS's
                // rounded min/max edges), never a fractional gap that a scanner reads as noise.
                for (y in 0 until count) {
                    val minY = (y * side / count).roundToInt().toFloat()
                    val maxY = ((y + 1) * side / count).roundToInt().toFloat()
                    for (x in 0 until count) {
                        if (!matrix.modules[y][x]) continue
                        val minX = (x * side / count).roundToInt().toFloat()
                        val maxX = ((x + 1) * side / count).roundToInt().toFloat()
                        drawRect(
                            color = ink,
                            topLeft = Offset(minX, minY),
                            size = Size(maxX - minX, maxY - minY),
                        )
                    }
                }
            }
        } else {
            // No matrix (a payload past version 40, which no invite reaches): a blank tile, never a
            // crash. The share link is always well within capacity, so this is defensive only.
            Box(modifier = Modifier.size(QrTileLayout.side - QrTileLayout.quietZone * 2).background(Color.Transparent))
        }
    }
}
