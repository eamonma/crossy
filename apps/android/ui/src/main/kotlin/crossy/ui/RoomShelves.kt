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
