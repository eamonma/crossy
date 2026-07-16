// Puzzles, the library tab (iOS PuzzlesScreen): the caller's uploaded puzzles from GET /puzzles,
// newest first, cursor-paginated, the RoomsListScreen grammar exactly (a big title in the scroll,
// paper cards, pull to refresh, quiet state lines). Each card's one action starts a fresh game from
// that upload (POST /games, the replay-without-reupload path the web gallery mirrors): on success
// the composition root pushes the created room, the same navigation an opened room card takes; a
// failure reads inline on the card and the card recovers. Android keeps a manual "Create room" entry
// too (the named-create + id-paste screen, a deliberate extra), reached from the header here.
//
// A pure function of the loaded list plus its loading/refreshing state and the per-card start
// progress; the composition root owns the fetch, the paging, the start call, and the navigation.

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.protocol.PuzzleSummary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PuzzlesScreen(
    puzzles: List<PuzzleSummary>,
    ground: GridGround,
    isLoading: Boolean,
    isRefreshing: Boolean,
    error: String?,
    // The puzzleId whose POST /games is currently out; null when none. One start at a time is enough
    // (a person taps one card) and it keeps the disabled control unambiguous (iOS PuzzlesScreen.starting).
    startingId: String?,
    // A per-card inline failure sentence, keyed by puzzleId; the host clears it when that card is
    // tapped again (iOS PuzzlesScreen.startFailures).
    startFailures: Map<String, String>,
    onStart: (PuzzleSummary) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onCreate: () -> Unit,
) {
    val lastId = puzzles.lastOrNull()?.puzzleId
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item(key = "header") {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            ArrivalCopy.puzzlesTitle,
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.weight(1f),
                        )
                        // Android's deliberate extra: the named-create + id-paste screen, reachable
                        // here so a room can be created by hand even when the upload list is empty.
                        TextButton(onClick = onCreate) { Text("Create room") }
                    }
                    if (error != null && puzzles.isEmpty()) {
                        Text(
                            error,
                            color = MaterialTheme.colorScheme.error,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                    }
                }
            }

            when {
                isLoading && puzzles.isEmpty() -> item(key = "loading") {
                    Box(Modifier.fillMaxWidth().padding(top = 32.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
                puzzles.isEmpty() -> item(key = "empty") {
                    Text(
                        ArrivalCopy.puzzlesEmpty,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(vertical = 16.dp),
                    )
                }
                else -> items(puzzles, key = { it.puzzleId }) { puzzle ->
                    LibraryPuzzleCard(
                        puzzle = puzzle,
                        ground = ground,
                        starting = startingId == puzzle.puzzleId,
                        failure = startFailures[puzzle.puzzleId],
                        onStart = { onStart(puzzle) },
                    )
                    if (puzzle.puzzleId == lastId) {
                        LaunchedEffect(lastId) { onLoadMore() }
                    }
                }
            }
        }
    }
}

/** One library puzzle card (iOS PuzzleCard): geometry fingerprint, title, author, and the one action
 *  that starts a fresh game from this upload (POST /games). No people row (a puzzle has no members,
 *  and people are the only color a card earns), so the start action is the card's only tint-free
 *  control. In flight it reads "Starting" and disables, so a double tap never fires a second create.
 *  A per-card failure line reads beneath, inline, no toast. */
@Composable
private fun LibraryPuzzleCard(
    puzzle: PuzzleSummary,
    ground: GridGround,
    starting: Boolean,
    failure: String?,
    onStart: () -> Unit,
) {
    androidx.compose.material3.Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                GeometryFingerprint(puzzle.rows, puzzle.cols, ground, Modifier.size(52.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        puzzle.headline,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    puzzle.subline?.let {
                        Text(
                            it,
                            fontSize = 13.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Button(onClick = onStart, enabled = !starting) {
                    Text(if (starting) ArrivalCopy.puzzleStarting else ArrivalCopy.puzzleStartGame)
                }
            }
            failure?.let {
                Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/** The headline: the title when the document carried one, else the honest geometry (the RoomCard
 *  fallback, same words). */
private val PuzzleSummary.headline: String
    get() = title?.takeIf { it.isNotBlank() } ?: "${rows}×${cols} crossword"

/** The author under the title, absent rather than empty when the document carried none. */
private val PuzzleSummary.subline: String?
    get() = author?.takeIf { it.isNotBlank() }

/** A bare geometry lattice (iOS GeometryFingerprintView): a puzzle summary carries no mask (INV-6,
 *  and there is nothing to solve yet), so the card draws only the grid's shape, `rows` by `cols`,
 *  cell-toned with quiet interior lines. Geometry only, so INV-6 holds structurally. */
@Composable
private fun GeometryFingerprint(rows: Int, cols: Int, ground: GridGround, modifier: Modifier = Modifier) {
    val cell = ground.tokens.cell.toColor()
    val line = ground.tokens.gridLine.toColor()
    Canvas(modifier = modifier.clip(RoundedCornerShape(6.dp))) {
        if (rows <= 0 || cols <= 0) return@Canvas
        val step = minOf(size.width / cols, size.height / rows)
        val w = step * cols
        val h = step * rows
        drawRect(color = cell, topLeft = Offset(0f, 0f), size = androidx.compose.ui.geometry.Size(w, h))
        for (c in 0..cols) {
            drawLine(line, Offset(c * step, 0f), Offset(c * step, h), strokeWidth = 1f)
        }
        for (r in 0..rows) {
            drawLine(line, Offset(0f, r * step), Offset(w, r * step), strokeWidth = 1f)
        }
    }
}
