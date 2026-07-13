// The room's top chrome (iOS RoomBar, trimmed to the Wave A4 functional bar): a back affordance,
// the room name, the roster as color dots, a share affordance, and the connection state as a small
// chip. Share emits the canonical short invite link through the system share sheet (iOS ShareMenu,
// PROTOCOL.md §12); it renders only when the room has a code to share (onShare non-null), so the
// demo room shows none. Rich roster menus and the ambient clock are later tracks. A pure function of
// the render model's presence plus the sync state; the room screen owns the exit and share intents.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.design.IdentityRoster
import crossy.protocol.GameStatus
import crossy.protocol.Participant
import crossy.protocol.Role
import crossy.store.SyncState

@Composable
fun RoomBar(
    roomName: String?,
    participants: List<Participant>,
    sync: SyncState,
    status: GameStatus,
    ground: GridGround,
    modifier: Modifier = Modifier,
    onExit: () -> Unit = {},
    onShare: (() -> Unit)? = null,
) {
    val tokens = ground.tokens
    Surface(modifier = modifier.fillMaxWidth(), color = tokens.canvas.toColor(), contentColor = tokens.ink.toColor()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "‹",
                color = tokens.ink.toColor(),
                fontSize = 24.sp,
                modifier = Modifier.size(28.dp).pointerInput(Unit) { detectTapGestures { onExit() } },
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            Text(
                roomName?.takeIf { it.isNotBlank() } ?: "Crossy",
                color = tokens.ink.toColor(),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                participants.filter { it.role != Role.SPECTATOR }.take(5).forEach { p ->
                    val identity = IdentityRoster.colorForWireColor(p.color) ?: IdentityRoster.color(p.userId)
                    val dot = ground.rosterColor(identity).toColor()
                    Box(
                        modifier = Modifier.size(12.dp).clip(CircleShape).background(dot.copy(alpha = if (p.connected) 1f else 0.35f)),
                    )
                }
            }
            if (onShare != null) ShareChip(ground, onShare)
            SyncChip(sync, status, ground)
        }
    }
}

// The share affordance: a quiet pill matching the SyncChip idiom, tapping it fires the room's share
// intent (the composition root builds the short link and hands it to the system share sheet).
@Composable
private fun ShareChip(ground: GridGround, onShare: () -> Unit) {
    val tokens = ground.tokens
    Surface(
        color = tokens.cell.toColor(),
        contentColor = tokens.ink.toColor(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
        modifier = Modifier.pointerInput(Unit) { detectTapGestures { onShare() } },
    ) {
        Text("Share", fontSize = 11.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
    }
}

@Composable
private fun SyncChip(sync: SyncState, status: GameStatus, ground: GridGround) {
    val label = when {
        status == GameStatus.COMPLETED -> "Solved"
        status == GameStatus.ABANDONED -> "Ended"
        sync == SyncState.LIVE -> "Live"
        sync == SyncState.CONNECTING -> "Connecting"
        sync == SyncState.RESYNCING -> "Syncing"
        sync == SyncState.RECONNECTING -> "Reconnecting"
        else -> sync.wire
    }
    val tokens = ground.tokens
    Surface(
        color = tokens.cell.toColor(),
        contentColor = tokens.number.toColor(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    ) {
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
    }
}
