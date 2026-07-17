// The roster as the room's participant list (owner ruling 2026-07-10; twin of apps/ios RosterList.swift
// + RosterMenu.swift): the room bar's puck cluster taps open a sheet listing every member with their
// puck, display name, a quiet state word, and the actions the room supports. Presence order is the one
// rule the cluster and the sheet share: connected people first, each group stable by name then id
// (ASCII byte order, INV-1) so the list never shuffles between renders. The host may Go to a member's
// cursor and Remove anyone but themselves (a two-beat confirm); a spectator's one affordance is Join
// in (changeRole to solver). The glass menu-morph is iOS's; here the sheet is a solid token surface
// (the material pass is later), the behavior is in: the list, the ordering, the actions, the confirm.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.protocol.Cursor
import crossy.protocol.Direction
import crossy.protocol.Participant
import crossy.protocol.Role

/** A member's live cursor as the roster needs it (PROTOCOL.md §4, §9): the one fact the "Go to"
 *  action gates on. Twin of iOS RosterCursor. */
data class RosterCursor(val cell: Int, val isAcross: Boolean)

/** One participant as the chrome renders it, plain data (twin of iOS RosterMember): the fields the
 *  roster sheet and its ordering read, mapped from the store's Participant plus its live cursor. */
data class RosterMember(
    val userId: String,
    val displayName: String,
    /** The wire color string, authoritative for roster slotting; empty for a seeded member. */
    val wireColor: String,
    /** The opaque server-resolved avatar URL, null when the server has none (PROTOCOL.md §4). */
    val avatarUrl: String?,
    val isHost: Boolean,
    val isSpectator: Boolean,
    val connected: Boolean,
    /** The member's live cursor, or null when they have none right now (never connected with a cursor
     *  yet, or a spectator whose cursor is suppressed). The one fact "Go to" gates on. */
    val cursor: RosterCursor?,
)

/** The roster copy, greppable in one place (ID-5 lexicon: plain, no metaphors). Kept here beside the
 *  ordering it names rather than inline, the RoomTerminal precedent for room-chrome sentences. */
object RosterCopy {
    const val title = "In this room"
    const val sectionHere = "Here"
    const val sectionAway = "Away"
    const val wordAway = "Away"
    const val wordWatching = "Watching"
    const val wordHost = "Host"
    const val goToAction = "Go to"
    const val removeAction = "Remove"
    const val joinInAction = "Join in"

    /** The kick confirm (two-beat, EXPERIENCE.md: one confirm, plainly worded). */
    fun removeConfirmTitle(displayName: String): String = "Remove $displayName from the room?"
    const val removeConfirmBody = "They lose their seat and cannot rejoin with this code."
    const val removeConfirmAction = "Remove from room"
    const val removeCancelAction = "Cancel"
}

/** The roster's pure rules (twin of iOS RosterList): the ordering both the cluster and the sheet
 *  share, the presence split, the cluster's solvers-only cap, the state word, and the action gates.
 *  All ASCII-ordered (INV-1) and pure, so tests pin them without Compose. */
object RosterList {
    /** The cluster shows at most this many pucks; a fuller room collapses the rest to a +N. */
    const val puckCap = 5

    /** Map the store's participants (plus live cursors and the self id) into roster members. A
     *  spectator's cursor is dropped: their on-board cursor is suppressed client-side (DESIGN.md §15),
     *  so "Go to" never lights on a spectator row with no extra role check. */
    fun membersFrom(
        participants: List<Participant>,
        cursors: Map<String, Cursor>,
        selfUserId: String?,
    ): List<RosterMember> =
        participants.map { p ->
            val cursor = cursors[p.userId]
                ?.takeIf { p.role != Role.SPECTATOR }
                ?.let { RosterCursor(it.cell, it.direction == Direction.ACROSS) }
            RosterMember(
                userId = p.userId,
                displayName = p.displayName,
                wireColor = p.color,
                avatarUrl = p.avatarUrl,
                isHost = p.role == Role.HOST,
                isSpectator = p.role == Role.SPECTATOR,
                connected = p.connected,
                cursor = cursor,
            )
        }

    /** Presence order: connected first, then away; within each group by display name then userId
     *  (ASCII byte order on both keys, INV-1: no locale-aware collation anywhere values compare). */
    fun ordered(members: List<RosterMember>): List<RosterMember> =
        members.sortedWith(
            Comparator { a, b ->
                if (a.connected != b.connected) return@Comparator if (a.connected) -1 else 1
                val byName = compareAscii(a.displayName, b.displayName)
                if (byName != 0) byName else compareAscii(a.userId, b.userId)
            },
        )

    /** The presence split for the sheet: the people here now lead, the away members gather below.
     *  Each side keeps `ordered`'s rule, so the split only groups, never reshuffles. The viewer is
     *  always here (a self row can echo connected:false mid-reconnect, but the reader is present by
     *  definition). A disconnected guest-spectator drops out of both sides (no permanent away ghost);
     *  a connected spectator stays in `here`, where their quiet Watching word names them. */
    fun sections(members: List<RosterMember>, selfUserId: String?): Pair<List<RosterMember>, List<RosterMember>> {
        val here = mutableListOf<RosterMember>()
        val away = mutableListOf<RosterMember>()
        for (member in ordered(members)) {
            val isSelf = selfUserId != null && member.userId == selfUserId
            if (member.connected || isSelf) {
                here.add(member)
            } else if (!member.isSpectator) {
                away.add(member)
            }
        }
        return here to away
    }

    /** The bar cluster (owner ruling 2026-07-10): only the people playing, host or solver, never a
     *  spectator (guests always seat as spectators, PROTOCOL.md §12, so a puck means "solving"). The
     *  first `puckCap` in presence order show, the rest collapse to a +N overflow count. */
    fun cluster(members: List<RosterMember>): Pair<List<RosterMember>, Int> {
        val playing = ordered(members).filter { !it.isSpectator }
        val shown = playing.take(puckCap)
        return shown to (playing.size - shown.size)
    }

    /** The quiet trailing word (ID-5 lexicon), the sheet row's subtitle: Away beats the role because
     *  presence is what the room asks first; Watching is the spectator word; Host names the seat; a
     *  connected solver needs no word. */
    fun stateWord(member: RosterMember): String? = when {
        !member.connected -> RosterCopy.wordAway
        member.isSpectator -> RosterCopy.wordWatching
        member.isHost -> RosterCopy.wordHost
        else -> null
    }

    /** Whether the room shows the spectator edge (EXPERIENCE.md Watching): the local participant holds
     *  the spectator role. Absent or unknown selves are not spectators; the room never guesses. */
    fun selfIsSpectator(members: List<RosterMember>, selfUserId: String?): Boolean {
        if (selfUserId == null) return false
        return members.firstOrNull { it.userId == selfUserId }?.isSpectator ?: false
    }

    /** Whether the local participant is the host: the gate on the sheet's Remove affordance and the
     *  facts sheet's End game. Absent or unknown selves are never host; the server enforces host-only
     *  regardless, so this only decides what the menu offers. */
    fun selfIsHost(members: List<RosterMember>, selfUserId: String?): Boolean {
        if (selfUserId == null) return false
        return members.firstOrNull { it.userId == selfUserId }?.isHost ?: false
    }

    /** Whether the host may remove this member: everyone but the host's own row (the server refuses a
     *  self-target; the menu never offers it). */
    fun canKick(member: RosterMember, selfUserId: String?): Boolean =
        selfUserId != null && member.userId != selfUserId

    /** Whether "Go to" is live for this member: only when they hold a live cursor right now. No cursor
     *  means no jump to a stale or guessed cell. */
    fun canJump(member: RosterMember): Boolean = member.cursor != null

    private fun compareAscii(a: String, b: String): Int {
        val an = a.toByteArray(Charsets.UTF_8)
        val bn = b.toByteArray(Charsets.UTF_8)
        var i = 0
        while (i < an.size && i < bn.size) {
            val x = an[i].toInt() and 0xff
            val y = bn[i].toInt() and 0xff
            if (x != y) return x - y
            i++
        }
        return an.size - bn.size
    }
}

/** The resolved-avatar bridge the puck rows sit behind (the AAD-2 split iOS holds between the puck and
 *  the cache): :ui takes the avatar as RESOLVED data and knows nothing about fetching. The composition
 *  root threads an implementation reading the shared AvatarImageCache (:app); a preview or the demo
 *  room passes [none], which renders every row as its colored initial. */
fun interface RosterAvatars {
    @Composable
    fun bitmap(url: String?): ImageBitmap?

    companion object {
        /** The no-cache provider: every row shows its initial (the first-class fallback). */
        val none = RosterAvatars { null }
    }
}

/**
 * The roster sheet: every member listed with their puck, name, and quiet state word, split into Here
 * and Away sections in presence order. The host's rows carry Go to (when the member has a live cursor)
 * and Remove (a two-beat confirm); a self-spectator gets the Join in action at the foot. A solid token
 * surface (the glass menu-morph is a later material pass); the behavior is the point.
 *
 * @param onGoTo jump the local selection and camera to a member's cursor (RoomScreen owns the seam).
 * @param onKick remove a member (host only; the composition root wires DELETE .../members/{id}).
 * @param onJoinIn a spectator promotes to solver (the composition root wires POST .../role).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RosterMenu(
    members: List<RosterMember>,
    selfUserId: String?,
    ground: GridGround,
    avatars: RosterAvatars,
    onGoTo: (RosterCursor) -> Unit,
    onKick: (String) -> Unit,
    onJoinIn: () -> Unit,
    onDismiss: () -> Unit,
) {
    val tokens = ground.tokens
    val sheetState = rememberModalBottomSheetState()
    val hosting = RosterList.selfIsHost(members, selfUserId)
    val (here, away) = RosterList.sections(members, selfUserId)
    val spectating = RosterList.selfIsSpectator(members, selfUserId)
    // A staged kick awaits its confirm (EXPERIENCE.md two-beat): the row's Remove tap stages the
    // target, the dialog fires over the sheet, and only its confirm reports the intent up.
    var kickTarget by remember { mutableStateOf<RosterMember?>(null) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = tokens.canvas.toColor(),
        contentColor = tokens.ink.toColor(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                RosterCopy.title,
                color = tokens.number.toColor(),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
            )
            RosterSection(RosterCopy.sectionHere, here, ground, avatars, hosting, selfUserId, onGoTo, onDismiss) { kickTarget = it }
            if (away.isNotEmpty()) {
                RosterSection(RosterCopy.sectionAway, away, ground, avatars, hosting, selfUserId, onGoTo, onDismiss) { kickTarget = it }
            }
            if (spectating) {
                Surface(
                    color = tokens.cell.toColor(),
                    contentColor = tokens.ink.toColor(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 14.dp)
                        .pointerInput(Unit) { detectTapGestures { onJoinIn(); onDismiss() } },
                ) {
                    Text(
                        RosterCopy.joinInAction,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = tokens.ink.toColor(),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 14.dp),
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
            }
        }
    }

    kickTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { kickTarget = null },
            containerColor = tokens.canvas.toColor(),
            title = { Text(RosterCopy.removeConfirmTitle(target.displayName), color = tokens.ink.toColor()) },
            text = { Text(RosterCopy.removeConfirmBody, color = tokens.number.toColor()) },
            confirmButton = {
                TextButton(onClick = {
                    onKick(target.userId)
                    kickTarget = null
                    onDismiss()
                }) { Text(RosterCopy.removeConfirmAction) }
            },
            dismissButton = {
                TextButton(onClick = { kickTarget = null }) { Text(RosterCopy.removeCancelAction) }
            },
        )
    }
}

@Composable
private fun RosterSection(
    title: String,
    members: List<RosterMember>,
    ground: GridGround,
    avatars: RosterAvatars,
    hosting: Boolean,
    selfUserId: String?,
    onGoTo: (RosterCursor) -> Unit,
    onDismiss: () -> Unit,
    onStageKick: (RosterMember) -> Unit,
) {
    val tokens = ground.tokens
    Text(
        title.uppercase(),
        color = tokens.number.toColor(),
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
    )
    for (member in members) {
        RosterRow(member, ground, avatars, hosting, selfUserId, onGoTo, onDismiss, onStageKick)
    }
}

@Composable
private fun RosterRow(
    member: RosterMember,
    ground: GridGround,
    avatars: RosterAvatars,
    hosting: Boolean,
    selfUserId: String?,
    onGoTo: (RosterCursor) -> Unit,
    onDismiss: () -> Unit,
    onStageKick: (RosterMember) -> Unit,
) {
    val tokens = ground.tokens
    val avatar = avatars.bitmap(member.avatarUrl)
    val jumpable = RosterList.canJump(member)
    val kickable = hosting && RosterList.canKick(member, selfUserId)
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(modifier = Modifier.alpha(if (member.connected) 1f else 0.5f)) {
            RosterPuck(
                userId = member.userId,
                displayName = member.displayName,
                ground = ground,
                diameter = 30.dp,
                wireColor = member.wireColor,
                avatar = avatar,
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                member.displayName.takeIf { it.isNotBlank() } ?: "Player",
                color = tokens.ink.toColor(),
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
            RosterList.stateWord(member)?.let { word ->
                Text(word, color = tokens.number.toColor(), fontSize = 12.sp)
            }
        }
        if (jumpable) {
            val cursor = member.cursor!!
            TextButton(onClick = { onGoTo(cursor); onDismiss() }) {
                Text(RosterCopy.goToAction, color = tokens.ink.toColor(), fontSize = 14.sp)
            }
        }
        if (kickable) {
            TextButton(onClick = { onStageKick(member) }) {
                Text(RosterCopy.removeAction, color = tokens.number.toColor(), fontSize = 14.sp)
            }
        }
    }
}
