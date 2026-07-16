// The room's top chrome (iOS RoomBar): a back affordance, the room name, the roster as a tappable puck
// cluster (opening the participant list), a share affordance, and the time pill carrying the room's
// vital signs. The time pill is the room's facts (owner ruling 2026-07-10): the weather dot and the
// ambient clock while the room runs, a quiet seal at completion (a check beside the frozen clock), the
// bare frozen clock when a host ended it; a tap presents the facts sheet (RoomScreen gates the summon
// to `ongoing`). Share emits the canonical short invite link (iOS ShareMenu, PROTOCOL.md §12), shown
// only when there is a code (onShare non-null). A near-pure function of the render model's presence,
// cursors, and sync; the room screen owns the exit, share, tap-facts, and roster action intents.

package crossy.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.protocol.Cursor
import crossy.protocol.GameStatus
import crossy.protocol.Participant
import crossy.store.SyncState
import kotlinx.coroutines.delay

@Composable
fun RoomBar(
    roomName: String?,
    participants: List<Participant>,
    cursors: Map<String, Cursor>,
    selfUserId: String?,
    sync: SyncState,
    status: GameStatus,
    // The timer's origin and its freeze instant (ID-2; root DESIGN.md D15): the clock ticks from the
    // first fill and stops at the terminal instant (completedAt, or abandonedAt for a host-ended room).
    firstFillAt: String?,
    freezeAt: String?,
    ground: GridGround,
    modifier: Modifier = Modifier,
    // The resolved-avatar bridge for the roster sheet's pucks (threaded from :app; the demo room and
    // previews pass the no-cache provider, which renders every row as its initial).
    avatars: RosterAvatars = RosterAvatars.none,
    onExit: () -> Unit = {},
    onShare: (() -> Unit)? = null,
    // A tap on the time pill; RoomScreen gates the facts summon to `ongoing`.
    onTapTime: () -> Unit = {},
    // The roster actions (RoomScreen / the composition root own the seams): jump the local selection to
    // a member's cursor, kick a member (host), promote a spectator to solver.
    onGoTo: (RosterCursor) -> Unit = {},
    onKick: (String) -> Unit = {},
    onJoinIn: () -> Unit = {},
    // The instant (epoch millis) the driver's next reconnect dial is due, or null when none is
    // scheduled. The time pill counts it down while reconnecting; ignored in every other state.
    reconnectRetryAt: Long? = null,
) {
    val tokens = ground.tokens
    val members = remember(participants, cursors, selfUserId) {
        RosterList.membersFrom(participants, cursors, selfUserId)
    }
    var rosterOpen by remember { mutableStateOf(false) }

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
                modifier = Modifier
                    .size(28.dp)
                    .semantics { contentDescription = "Back"; role = Role.Button }
                    .pointerInput(Unit) { detectTapGestures { onExit() } },
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
            RosterCluster(members, ground) { rosterOpen = true }
            if (onShare != null) ShareChip(ground, onShare)
            RoomTimePill(sync, status, firstFillAt, freezeAt, ground, reconnectRetryAt, onTapTime)
        }
    }

    if (rosterOpen) {
        RosterMenu(
            members = members,
            selfUserId = selfUserId,
            ground = ground,
            avatars = avatars,
            onGoTo = onGoTo,
            onKick = onKick,
            onJoinIn = onJoinIn,
            onDismiss = { rosterOpen = false },
        )
    }
}

/** The bar's puck cluster (iOS RosterList.cluster): the solvers-only pucks in presence order, the rest
 *  collapsed to a +N, tappable to open the participant list. Renders nothing before the roster lands
 *  (no welcome, no seed), so the bar shows no hollow chrome. */
@Composable
private fun RosterCluster(members: List<RosterMember>, ground: GridGround, onOpen: () -> Unit) {
    val (pucks, overflow) = remember(members) { RosterList.cluster(members) }
    if (pucks.isEmpty()) return
    val tokens = ground.tokens
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            // One spoken cluster with the room's head count (iOS RosterList label): the pucks below are
            // decorative once the cluster names the roster.
            .semantics(mergeDescendants = true) {
                contentDescription = "Roster, ${members.size} in the room"
                role = Role.Button
            }
            .pointerInput(Unit) { detectTapGestures { onOpen() } },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy((-7).dp)) {
            for (member in pucks) {
                Box(modifier = Modifier.alpha(if (member.connected) 1f else 0.5f)) {
                    RosterPuck(
                        userId = member.userId,
                        displayName = member.displayName,
                        ground = ground,
                        diameter = 22.dp,
                    )
                }
            }
        }
        if (overflow > 0) {
            Text(
                "+$overflow",
                color = tokens.number.toColor(),
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

// The share affordance: a quiet pill matching the time pill idiom. Tapping it opens the room's share
// surface (iOS ShareMenu: copy-link, system-share, show-QR over the invite link). The menu and the QR
// sheet (ShareSheet) live in :ui and are pure over the link, but the composition root PRESENTS them,
// because the invite code and short link live there and cannot reach this chip through RoomScreen (an
// untouched sibling region); onShare is that "open the share surface" intent.
@Composable
private fun ShareChip(ground: GridGround, onShare: () -> Unit) {
    val tokens = ground.tokens
    Surface(
        color = tokens.cell.toColor(),
        contentColor = tokens.ink.toColor(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
        modifier = Modifier
            .semantics { contentDescription = "Share"; role = Role.Button }
            .pointerInput(Unit) { detectTapGestures { onShare() } },
    ) {
        Text("Share", fontSize = 11.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
    }
}

/** The time pill (iOS RoomTimePill): the room's vital signs, then its record. Mid-solve the weather dot
 *  and the ambient clock stand together (a reconnect adds the quiet countdown beside the dot); a
 *  completed room seals the pill with a check beside the frozen clock; a host-ended room keeps the
 *  frozen clock alone. The clock ticks on a 1 Hz loop (the only thing in the room that ticks at rest),
 *  tabular so it never jitters. A tap reports up (RoomScreen gates the facts summon to `ongoing`). */
@Composable
private fun RoomTimePill(
    sync: SyncState,
    status: GameStatus,
    firstFillAt: String?,
    freezeAt: String?,
    ground: GridGround,
    reconnectRetryAt: Long?,
    onTap: () -> Unit,
) {
    val tokens = ground.tokens
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    // The 1 Hz clock: it ages the shared timer every second while the room runs, and ages the reconnect
    // countdown down beside the dot. A frozen (terminal) clock reads a fixed value, so the tick is a
    // harmless no-op there.
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val clock = AmbientClock.display(firstFillAt, freezeAt, now)
    // The pill's spoken line (iOS TimePillRegister.accessibilityLabel + weatherAccessibilityLabel): the
    // register's phrase, the live weather word, and the clock value, read as one element. A polite live
    // region so the weather's turn (connected, catching up, reconnecting) is announced as it changes.
    val weatherSpoken = when (RoomWeather.dot(sync)) {
        RoomWeather.Dot.CALM -> "Connected"
        RoomWeather.Dot.BREATHING -> "Catching up"
        RoomWeather.Dot.DIMMED -> if (RoomWeather.showsCountdown(sync)) "Reconnecting" else "Connecting"
    }
    val pillLabel = when (status) {
        GameStatus.ONGOING -> "Shared time, $weatherSpoken, $clock, show room facts"
        GameStatus.COMPLETED -> "Solved together, $clock, show stats"
        GameStatus.ABANDONED -> "Final time, $clock, show room facts"
    }
    Surface(
        color = tokens.cell.toColor(),
        contentColor = tokens.number.toColor(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
        modifier = Modifier
            .semantics(mergeDescendants = true) {
                contentDescription = pillLabel
                role = Role.Button
                liveRegion = LiveRegionMode.Polite
            }
            .pointerInput(Unit) { detectTapGestures { onTap() } },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            when (status) {
                GameStatus.ONGOING -> {
                    // The weather cluster: a reconnect names its countdown ("Back in Ns") beside the
                    // dot; live and resyncing carry only the dot (the terse pill, DESIGN.md §8).
                    val line = when {
                        RoomWeather.showsCountdown(sync) -> RoomWeather.reconnectLine(reconnectRetryAt, now)
                        else -> RoomWeather.label(sync)
                    }
                    if (line != null) {
                        Text(
                            line,
                            color = tokens.number.toColor(),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            style = TextStyle.Default.withTabularNumerals(),
                        )
                    }
                    WeatherDot(RoomWeather.dot(sync), ground)
                }
                // The solved seal: a quiet check in the weather's tone, the record that the room
                // finished (achromatic like all chrome, DESIGN.md §3).
                GameStatus.COMPLETED -> SealCheck(ground)
                // A host-ended room retires the weather and keeps the frozen clock alone.
                GameStatus.ABANDONED -> Unit
            }
            Text(
                clock,
                color = tokens.number.toColor(),
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                style = TextStyle.Default.withTabularNumerals(),
            )
        }
    }
}

/** The weather dot's three registers (iOS WeatherDot; DESIGN.md §8): a filled dot when calm, a slow
 *  opacity pulse while breathing (resync), a hollow ring while dimmed (connecting / reconnecting).
 *  Achromatic (§3): the tone is the quiet `number` ink, weather being the room's state, not a person.
 *  Reduce Motion holds the breath at half strength instead of moving (§7). */
@Composable
private fun WeatherDot(register: RoomWeather.Dot, ground: GridGround) {
    val tone = ground.tokens.number.toColor()
    val reduceMotion = rememberReduceMotion()
    when (register) {
        RoomWeather.Dot.CALM ->
            Box(Modifier.size(7.dp).clip(CircleShape).background(tone))
        RoomWeather.Dot.BREATHING -> {
            val alpha = if (reduceMotion) {
                0.5f
            } else {
                val transition = rememberInfiniteTransition(label = "weather-breath")
                val pulsed by transition.animateFloat(
                    initialValue = 1f,
                    targetValue = 0.25f,
                    animationSpec = infiniteRepeatable(tween(1200), RepeatMode.Reverse),
                    label = "weather-breath-alpha",
                )
                pulsed
            }
            Box(Modifier.size(7.dp).clip(CircleShape).background(tone.copy(alpha = alpha)))
        }
        RoomWeather.Dot.DIMMED ->
            Box(Modifier.size(7.dp).clip(CircleShape).border(1.5.dp, tone, CircleShape))
    }
}

/** The solved seal: a small check drawn in the quiet tone (no icon dependency; a hand-drawn tick keeps
 *  the pill achromatic and self-contained). */
@Composable
private fun SealCheck(ground: GridGround) {
    val tone = ground.tokens.number.toColor()
    Canvas(Modifier.size(11.dp)) {
        val w = size.width
        val h = size.height
        val stroke = Stroke(width = w * 0.16f)
        drawLine(tone, Offset(w * 0.18f, h * 0.55f), Offset(w * 0.42f, h * 0.80f), strokeWidth = stroke.width)
        drawLine(tone, Offset(w * 0.42f, h * 0.80f), Offset(w * 0.84f, h * 0.24f), strokeWidth = stroke.width)
    }
}
