// A room row as a card (iOS RoomCard / FeaturedRoomCard): the puzzle's black-square silhouette
// (from the INV-6-safe mask, never the solution), the headline (name -> title -> geometry), an
// optional subline, and a row of member dots. Cards sell people, not progress: no fill fraction and
// no lifecycle chip on the card face (a terminal room's quiet is the section's to tell). The compact
// PuzzleCard leads the shelves; FeaturedRoomCard stands the silhouette up large for the featured
// wall. Both are pure functions of one GameSummary. The silhouette is a small Canvas drawing the
// mask's `#`/`.` pattern.

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.design.IdentityRoster
import crossy.protocol.GameSummary

/** How much a terminal room's silhouette dims (iOS RoomCard.solvedFingerprintOpacity, main
 *  760e6e4): a quiet muted-silhouette echo of the web's `Silhouette muted`, the smallest honest
 *  signal a room is done. A first pass for the owner's device eye, tuned by one constant. */
private const val TerminalSilhouetteAlpha = 0.45f

@Composable
fun PuzzleCard(
    game: GameSummary,
    ground: GridGround,
    modifier: Modifier = Modifier,
    onOpen: () -> Unit = {},
) {
    Card(modifier = modifier.fillMaxWidth().clickable { onOpen() }) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // A terminal room (solved or host-ended) dims its silhouette, the smallest honest
            // signal that it is done so the trailing shelf reads finished without a loud badge (iOS
            // RoomCard solvedFingerprintOpacity, main 760e6e4). Only the fingerprint dims; the name
            // and people stay full ink. Colors are unchanged :design tokens; the dim is a layer alpha.
            // Decorative geometry, hidden from the reader (iOS PuzzleSilhouette accessibilityHidden);
            // the headline and people carry the card's spoken content.
            Silhouette(
                game.puzzle.mask, game.puzzle.rows, game.puzzle.cols, ground,
                Modifier.size(56.dp).alpha(if (game.isTerminal) TerminalSilhouetteAlpha else 1f)
                    .clearAndSetSemantics {},
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    game.headline,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                game.subline?.let {
                    Text(
                        it,
                        fontSize = 13.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                // People are the only color on the card (iOS RoomCard): the creator's dot carries
                // the one honest roster color, the rest stay quiet, a +N speaks the overflow.
                MemberDotsRow(game.memberCount, game.createdBy, ground, Modifier.padding(top = 2.dp))
            }
        }
    }
}

/** A featured room card (iOS FeaturedRoomCard, EXPERIENCE.md §3 Rooms): the same paper grammar stood
 *  up vertically so the silhouette leads as a large square face, the way the web home leads its live
 *  rooms with a real grid. The featured wall renders the few most-recently-active LIVE rooms this way
 *  (a 2x2 grid, RoomsListScreen); featured rooms are live by construction, so no muted-silhouette
 *  branch here. Headline plus member dots, no subline: the face reads large and the people carry it. */
@Composable
fun FeaturedRoomCard(
    game: GameSummary,
    ground: GridGround,
    modifier: Modifier = Modifier,
    onOpen: () -> Unit = {},
) {
    Card(modifier = modifier.fillMaxWidth().clickable { onOpen() }) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // A square face fits the common 15x15 exactly and centers an oblong grid (the silhouette
            // keeps true aspect inside the square), filling the card's width: the featured card's
            // whole point is the puzzle read large.
            // Decorative geometry, hidden from the reader (iOS PuzzleSilhouette accessibilityHidden).
            Silhouette(
                game.puzzle.mask, game.puzzle.rows, game.puzzle.cols, ground,
                Modifier.fillMaxWidth().aspectRatio(1f).clearAndSetSemantics {},
            )
            Text(
                game.headline,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurface,
            )
            MemberDotsRow(game.memberCount, game.createdBy, ground)
        }
    }
}

/** The headline: the game's own name when it has one, else the puzzle title, else the honest
 *  geometry (iOS RoomCardModel.headline, same words). */
private val GameSummary.headline: String
    get() = name?.takeIf { it.isNotBlank() }
        ?: puzzle.title?.takeIf { it.isNotBlank() }
        ?: "${puzzle.rows}×${puzzle.cols} crossword"

/** The subline under a named game: the puzzle title, absent when it would repeat the headline (iOS
 *  RoomCardModel.subline). */
private val GameSummary.subline: String?
    get() {
        val n = name?.takeIf { it.isNotBlank() } ?: return null
        val title = puzzle.title?.takeIf { it.isNotBlank() } ?: return null
        return title.takeIf { it != n }
    }

/** The member-dot arithmetic, pure so it pins headlessly (iOS RoomCardDots): at most [cap] dots, the
 *  rest a +N (the count-badge vocabulary the board already speaks, root DESIGN.md §10). */
object RoomCardDots {
    const val cap = 4

    /** [Pair.first] painted circles and [Pair.second] the overflow the +N carries. A negative count
     *  clamps to zero. */
    fun counts(memberCount: Int, cap: Int = RoomCardDots.cap): Pair<Int, Int> {
        val members = maxOf(memberCount, 0)
        return if (members <= cap) members to 0 else cap to (members - cap)
    }
}

/** Member dots, shared by the compact and featured cards (iOS MemberDotsRow). The list row names one
 *  member (the creator), so one dot carries that person's roster color and the rest stay quiet;
 *  painting invented colors on unknown members would be dressing (people are the only color, and only
 *  real people earn it). The +N overflow speaks the count-badge vocabulary the board already speaks. */
@Composable
fun MemberDotsRow(
    memberCount: Int,
    createdBy: String,
    ground: GridGround,
    modifier: Modifier = Modifier,
) {
    val (count, overflow) = RoomCardDots.counts(memberCount)
    val creatorColor = ground.rosterColor(IdentityRoster.color(createdBy)).toColor()
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
    Row(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            Canvas(Modifier.size(8.dp)) {
                drawCircle(if (index == 0) creatorColor else quiet)
            }
        }
        if (overflow > 0) {
            Text(
                "+$overflow",
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The black-square silhouette from the mask (`#` block, `.` playable). A geometry-only render, so
 *  INV-6 holds structurally: there is no value to draw. Rows/cols bound the draw when the mask is
 *  absent (an older server), which yields an empty grid. */
@Composable
private fun Silhouette(mask: List<String>, rows: Int, cols: Int, ground: GridGround, modifier: Modifier = Modifier) {
    val block = ground.tokens.block.toColor()
    val cell = ground.tokens.cell.toColor()
    val line = ground.tokens.gridLine.toColor()
    Canvas(modifier = modifier.clip(RoundedCornerShape(6.dp))) {
        val r = if (mask.isNotEmpty()) mask.size else rows
        val c = if (mask.isNotEmpty()) mask.maxOf { it.length } else cols
        if (r <= 0 || c <= 0) return@Canvas
        val step = minOf(size.width / c, size.height / r)
        for (row in 0 until r) {
            val lineStr = mask.getOrNull(row)
            for (col in 0 until c) {
                val isBlock = lineStr?.getOrNull(col) == '#'
                drawRect(
                    color = if (isBlock) block else cell,
                    topLeft = Offset(col * step, row * step),
                    size = Size(step, step),
                )
            }
        }
        drawRect(color = line, topLeft = Offset(0f, 0f), size = Size(c * step, r * step), style = androidx.compose.ui.graphics.drawscope.Stroke(1f))
    }
}
