// Teammate presence for the board, assembled from the store's render model. Placement is the
// Wave 2.1d module contract (GridModule); this file owns who appears and in what color: the
// server's wire color string is authoritative for roster slotting, spectator cursors are never
// rendered (DESIGN.md §15), and your own cursor is the selection, not a presence mark. Twin of the
// iOS GridPresence.

package crossy.ui

import crossy.design.IdentityRoster
import crossy.design.RGBColor
import crossy.protocol.Cursor
import crossy.protocol.Participant
import crossy.protocol.Role
import crossy.protocol.asciiUppercase

/** One teammate cursor rendered in a cell: the direction arrow, the avatar puck, and any conflict
 *  flash all borrow this color. The 8 px puck is always the initial, never the avatar image (at
 *  8 px an image is mud); the initial in the writer's color still reads. */
data class PresenceMark(
    val userId: String,
    val initial: String,
    val color: RGBColor,
    val isAcross: Boolean,
)

object Presence {
    /** Presence marks by cell. Excluded: the local player (your cursor renders as the selection,
     *  DESIGN.md §10 draws teammate cursors only) and spectators (DESIGN.md §15). A cursor with no
     *  participant entry still renders, colored by user-id fallback: presence is best-effort and a
     *  late roster must not blank a live cursor. Marks within a cell are ordered by userId so
     *  stacking is deterministic. */
    fun marks(
        cursors: Map<String, Cursor>,
        participants: List<Participant>,
        selfUserId: String?,
        ground: GridGround,
    ): Map<Int, List<PresenceMark>> {
        val roster = participants.associateBy { it.userId }
        val out = HashMap<Int, MutableList<PresenceMark>>()
        for (cursor in cursors.values.sortedBy { it.userId }) {
            if (cursor.userId == selfUserId) continue
            val participant = roster[cursor.userId]
            if (participant?.role == Role.SPECTATOR) continue
            val identity = IdentityRoster.colorForWireColor(participant?.color ?: "")
                ?: IdentityRoster.color(cursor.userId)
            val mark = PresenceMark(
                userId = cursor.userId,
                initial = initialOf(participant?.displayName ?: ""),
                color = ground.rosterColor(identity),
                isAcross = cursor.direction == crossy.protocol.Direction.ACROSS,
            )
            out.getOrPut(cursor.cell) { mutableListOf() }.add(mark)
        }
        return out
    }

    /** The local player's roster color for the cursor and active-word tint: wire color when the
     *  roster carries us (authoritative), else the hash of the user id, else violet before the
     *  welcome names us at all (at most a frame's worth of life). */
    fun selfColor(participants: List<Participant>, selfUserId: String?, ground: GridGround): RGBColor {
        if (selfUserId == null) return ground.rosterColor(IdentityRoster.violet)
        val own = participants.firstOrNull { it.userId == selfUserId }
        val identity = own?.let { IdentityRoster.colorForWireColor(it.color) ?: IdentityRoster.color(selfUserId) }
            ?: IdentityRoster.color(selfUserId)
        return ground.rosterColor(identity)
    }

    /** The avatar's fallback initial: the display name's first character, ASCII-uppercased via
     *  :protocol (INV-1; a non-ASCII initial passes through verbatim), empty when the name is empty. */
    fun initialOf(displayName: String): String {
        if (displayName.isEmpty()) return ""
        return asciiUppercase(displayName.substring(0, 1))
    }
}
