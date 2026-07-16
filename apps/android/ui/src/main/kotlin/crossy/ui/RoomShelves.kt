// The rooms list's shelf split (main 760e6e4, #234): live rooms lead, then solved, then
// host-ended, each gathered trailing. Twin of web homeData.partitionRooms and iOS
// RoomCardModel.shelved; the Android list classifies the wire GameSummary directly rather than a
// UI model, so the predicates and the partition live here as pure functions of one row. Kept out
// of the composables so the shelf logic is a plain JVM unit test (no device), the same posture as
// CellFill and GridGeometry.

package crossy.ui

import crossy.protocol.GameSummary

/** True when the game completed: the fact the trailing "Solved" shelf gathers on (§12). Null
 *  (ongoing, or an abandoned game that never completed) reads as not solved. */
val GameSummary.isCompleted: Boolean get() = completedAt != null

/** True when a host ended the game: the fact the trailing "Ended" shelf gathers on (§12). Mutually
 *  exclusive with [isCompleted] (a terminal room is one or the other, never both), so an abandoned
 *  room gathers into "Ended" rather than sitting in the live shelf its null completion once left it. */
val GameSummary.isAbandoned: Boolean get() = abandonedAt != null

/** True when the game is terminal (solved or ended): both dim the silhouette and read finished,
 *  the quiet the two trailing shelves share. Neither is ever in the live flow. */
val GameSummary.isTerminal: Boolean get() = isCompleted || isAbandoned

/** The three shelves the rooms list renders, in render order (live, then solved, then ended). An
 *  empty group draws no header, so an all-live shelf carries no trailing sections. */
data class RoomShelves(
    val live: List<GameSummary>,
    val solved: List<GameSummary>,
    val ended: List<GameSummary>,
)

/**
 * Split rooms into the three shelves (the web's grammar, Home.tsx GamesList): a game is classified
 * by its mutually exclusive terminal timestamps (§12): completedAt into `solved`, abandonedAt into
 * `ended`, neither into `live`. The partition PRESERVES the input order within each group and never
 * re-sorts, so the caller's activity order carries through and appended pages stay stable (§12
 * pagination: pages are createdAt-bounded and appended, never globally re-sorted, so a terminal
 * room from a deeper page lands after the earlier terminal rooms within its section). Pure and
 * non-mutating.
 */
fun partitionRooms(games: List<GameSummary>): RoomShelves {
    val live = ArrayList<GameSummary>()
    val solved = ArrayList<GameSummary>()
    val ended = ArrayList<GameSummary>()
    for (game in games) {
        when {
            game.isCompleted -> solved.add(game)
            game.isAbandoned -> ended.add(game)
            else -> live.add(game)
        }
    }
    return RoomShelves(live, solved, ended)
}

/**
 * Order rooms by when they were last touched, most recent first, matching the server's within-page
 * order (PROTOCOL.md §12). Twin of iOS `RoomCardModel.orderedByActivity`. The sort key is
 * `lastActivityAt ?? createdAt` (COALESCE): creating a room is its first activity, so a freshly
 * created unplayed room sorts by its `createdAt`, right where a room played at that instant would
 * sit, not below every played room. Ties on the coalesced key fall back to `createdAt`, then
 * `gameId`, so the order is total and stable. The server already sends the page in this order;
 * sorting again is belt-and-suspenders and never fights the server since the rule is identical.
 * Timestamps are ISO 8601 UTC in the one server format, so a lexicographic compare is chronological
 * (no date parsing in the view layer). Applied WITHIN a page and never across pages: pages are
 * createdAt-bounded and appended in order, so a global re-sort would break the documented "first
 * page fully activity-ordered, deeper pages stable" (§12). Pure and non-mutating.
 */
fun orderedByActivity(games: List<GameSummary>): List<GameSummary> =
    games.sortedWith(
        // COALESCE(lastActivityAt, createdAt): a never-played room keys on its creation time. All
        // three keys descend (more recent first), so a single reversed comparator over the triple
        // is the total, stable order.
        compareByDescending<GameSummary> { it.lastActivityAt ?: it.createdAt }
            .thenByDescending { it.createdAt }
            .thenByDescending { it.gameId },
    )
