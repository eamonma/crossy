// A game row as a card (iOS PuzzleCard / RoomCard, Wave A4 functional bar): the puzzle's
// black-square silhouette (from the INV-6-safe mask, never the solution), the room name, and a
// line of facts (member count, the caller's role, completion). A pure function of one GameSummary
// with an open intent. The silhouette is a small Canvas drawing the mask's `#`/`.` pattern.

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.protocol.GameSummary
import crossy.protocol.Role

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
            Silhouette(game.puzzle.mask, game.puzzle.rows, game.puzzle.cols, ground, Modifier.size(56.dp))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    game.name?.takeIf { it.isNotBlank() } ?: game.puzzle.title?.takeIf { it.isNotBlank() } ?: "Untitled room",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(factsLine(game), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

private fun factsLine(game: GameSummary): String {
    val members = "${game.memberCount} " + if (game.memberCount == 1) "player" else "players"
    val role = when (game.role) {
        Role.HOST -> "host"
        Role.SOLVER -> "solver"
        Role.SPECTATOR -> "spectator"
    }
    val state = if (game.completedAt != null) "solved" else "ongoing"
    return "$members · $role · $state"
}

/** The black-square silhouette from the mask (`#` block, `.` playable). A geometry-only render, so
 *  INV-6 holds structurally: there is no value to draw. Rows/cols bound the draw when the mask is
 *  absent (an older server), which yields an empty grid. */
@Composable
private fun Silhouette(mask: List<String>, rows: Int, cols: Int, ground: GridGround, modifier: Modifier = Modifier) {
    val block = ground.tokens.block.toColor()
    val cell = ground.tokens.cell.toColor()
    val line = ground.tokens.gridLine.toColor()
    Canvas(modifier = modifier) {
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
