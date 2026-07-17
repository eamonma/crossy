// The rooms list (iOS RoomsScreen): the caller's games, most-recently-active first. The few most
// recent live rooms lead as a featured wall (a 2x2 grid of large FeaturedRoomCard silhouettes, iOS
// featuredCount = 4), the rest fall to compact PuzzleCards, then a quiet "Solved" section and an
// "Ended" section gather the terminal rooms. Pull to refresh, and cursor pagination loads the next
// page when the last raw card scrolls into view. A pure function of the loaded list plus its
// loading/refreshing/error state; the composition root owns the fetch, the activity re-sort, and
// every intent (paging included).

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.protocol.GameSummary
import java.util.Locale

/** The featured wall: the few most-recently-active live rooms as large silhouette cards. Four fills
 *  a clean 2x2 on a phone (each face ~half width, still legible for a 15x15), so the compact list
 *  appears only at five or more live rooms (iOS RoomsScreen.featuredCount). */
private const val FeaturedCount = 4

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomsListScreen(
    games: List<GameSummary>,
    ground: GridGround,
    isLoading: Boolean,
    isRefreshing: Boolean,
    error: String?,
    onOpen: (GameSummary) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onJoinByCode: () -> Unit,
    onCreate: () -> Unit,
    onOpenDemo: () -> Unit,
) {
    // The shelf grammar (Home.tsx GamesList): live rooms lead, then solved, then host-ended, each
    // gathered off the ONE activity-ordered list by the pure helper. The featured slice leads the
    // live rooms; the rest and the terminal shelves stay compact. Partitioned at render time, never a
    // second paging list, so appended pages stay stable (§12).
    val shelves = partitionRooms(games)
    val featured = shelves.live.take(FeaturedCount)
    val restLive = shelves.live.drop(FeaturedCount)
    // The load-more trigger keys off the LAST raw appended card (not the visually last, which the
    // featured slice and the terminal sections reorder), so paging fires once per page (iOS roomTap).
    val lastId = games.lastOrNull()?.gameId

    Scaffold { inner ->
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize().padding(inner),
        ) {
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                fullSpan("header") {
                    Column {
                        Text(
                            ArrivalCopy.roomsTitle,
                            fontSize = 32.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.padding(top = 8.dp, bottom = 8.dp),
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Button(onClick = onCreate, modifier = Modifier.weight(1f)) { Text("Create") }
                            OutlinedButton(onClick = onJoinByCode, modifier = Modifier.weight(1f)) { Text("Join by code") }
                        }
                        OutlinedButton(
                            onClick = onOpenDemo,
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        ) { Text("Open demo room (scripted)") }
                        if (error != null) {
                            Text(
                                // Already a coded sentence (the composition root maps the §12 code
                                // through ArrivalFailure); the raw exception never reaches here.
                                error,
                                color = MaterialTheme.colorScheme.error,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                    }
                }

                when {
                    // The initial load spinner: only before the first page lands. A refresh over a
                    // standing list rides the pull-to-refresh indicator instead, never this.
                    isLoading && games.isEmpty() -> fullSpan("loading") {
                        Column(
                            modifier = Modifier.fillMaxWidth().padding(top = 32.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) { CircularProgressIndicator() }
                    }
                    games.isEmpty() -> fullSpan("empty") {
                        Text(
                            ArrivalCopy.roomsEmpty,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                    }
                    else -> {
                        // The featured wall keeps its grid-cell face no matter the count: a single
                        // live room sits in the first cell at the same size as a full 2x2, never
                        // ballooning to a lone full-width hero.
                        items(featured, key = { it.gameId }) { game ->
                            FeaturedRoomCard(game, ground, onOpen = { onOpen(game) })
                            LoadMoreOnLast(game.gameId, lastId, onLoadMore)
                        }
                        fullSpanItems(restLive) { game ->
                            PuzzleCard(game, ground, onOpen = { onOpen(game) })
                            LoadMoreOnLast(game.gameId, lastId, onLoadMore)
                        }
                        if (shelves.solved.isNotEmpty()) {
                            fullSpan("section-solved") { SectionHeader(ArrivalCopy.roomsSolvedSection) }
                            fullSpanItems(shelves.solved) { game ->
                                PuzzleCard(game, ground, onOpen = { onOpen(game) })
                                LoadMoreOnLast(game.gameId, lastId, onLoadMore)
                            }
                        }
                        if (shelves.ended.isNotEmpty()) {
                            fullSpan("section-ended") { SectionHeader(ArrivalCopy.roomsEndedSection) }
                            fullSpanItems(shelves.ended) { game ->
                                PuzzleCard(game, ground, onOpen = { onOpen(game) })
                                LoadMoreOnLast(game.gameId, lastId, onLoadMore)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Fire the next page's fetch when the LAST raw appended card enters composition (the lazy grid
 *  composes on scroll, so this is the Compose twin of iOS's `onAppear` on `rooms.last`). Keyed on the
 *  last id, so it re-arms once per appended page and never fires for an interior card. The composition
 *  root owns the guard (no cursor, already loading): a spurious call is a cheap no-op there. */
@Composable
private fun LoadMoreOnLast(gameId: String, lastId: String?, onLoadMore: () -> Unit) {
    if (gameId == lastId) {
        LaunchedEffect(lastId) { onLoadMore() }
    }
}

/** A quiet caps label over a trailing shelf (the web's CapsLabel, Home.tsx): the section copy in the
 *  theme's subtle ink (onSurfaceVariant maps to the :design `number` token) and rendered uppercase
 *  (ROOT locale: ASCII-only, INV-1-clean), so a "Solved" or "Ended" section reads as a divider, never
 *  a loud header. Drawn only when its group is non-empty. */
@Composable
private fun SectionHeader(text: String) {
    Text(
        text.uppercase(Locale.ROOT),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.8.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
    )
}

/** One full-width row inside the 2-column grid (the title, the action buttons, a section header, a
 *  compact card): spans both columns via `maxLineSpan`, so the grid mixes the featured wall's cells
 *  with full-width content in one scroll container. */
private fun LazyGridScope.fullSpan(
    key: String,
    content: @Composable () -> Unit,
) = item(key = key, span = { GridItemSpan(maxLineSpan) }) { content() }

/** The list form of [fullSpan]: each row of [rows] spans both columns, keyed by gameId. */
private fun LazyGridScope.fullSpanItems(
    rows: List<GameSummary>,
    content: @Composable (GameSummary) -> Unit,
) = items(rows, key = { it.gameId }, span = { GridItemSpan(maxLineSpan) }) { content(it) }
