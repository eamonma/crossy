// The reaction fan (twin of apps/ios ReactionFan): a floating button near the clue bar's trailing
// corner that opens the holder's five reaction options; a send fires at the current cursor cell. All
// grammar lives in the pure ReactionFanModel (tested exhaustively); this surface only translates
// touches into its calls and renders the phase. Two ways in, one way out (ReactionFanModel):
// HOLD-SLIDE-RELEASE rides one press gesture on the button (touch down opens, the finger's position
// maps through ReactionFanLayout so hit test and pixels cannot drift, release over an emoji fires and
// release elsewhere cancels), and TAP-TAP falls out of the same gesture (a release still on the
// button stands the fan open) plus the capsule's own slot taps. It stays visible in any game status
// (reactions are legal post-completion, PROTOCOL.md §9), so it is composed independently of the deck.

package crossy.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/**
 * The fan. `emojis` is the holder's five (D25); the reaction-sets follow-up track passes the
 * per-user set, defaulting here to the protocol five. `enabled` gates the surface before the first
 * welcome (no cursor to aim at yet). `onPick` fires the chosen grapheme at the current cursor cell;
 * the caller runs the 5/s cap, the local echo, and the wire send.
 */
@Composable
fun ReactionFan(
    onPick: (String) -> Unit,
    ground: GridGround,
    modifier: Modifier = Modifier,
    emojis: List<String> = ReactionPolicy.defaultSet,
    enabled: Boolean = true,
) {
    var fan by remember(emojis) { mutableStateOf(ReactionFanModel(emojis)) }

    // The idle fold (owner spec ~3 s): a standing fan closes itself. Keyed on openedAt so a firing
    // tap or a re-open restarts the countdown, and idleExpired is validated against openedAt so a
    // stale timer can never close a newer opening.
    LaunchedEffect(fan.openedAt) {
        val opened = fan.openedAt
        if (fan.phase == ReactionFanModel.Phase.TAP_OPEN && opened != null) {
            delay((ReactionFanModel.TAP_OPEN_IDLE_SECONDS * 1000).toLong())
            fan = fan.idleExpired(now = opened + ReactionFanModel.TAP_OPEN_IDLE_SECONDS)
        }
    }

    fun fire(effect: ReactionFanModel.Effect) {
        (effect as? ReactionFanModel.Effect.Fire)?.let { onPick(it.emoji) }
    }

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(ROW_GAP_DP.dp),
    ) {
        AnimatedVisibility(
            visible = fan.isOpen,
            enter = fadeIn(tween(120)) + scaleIn(tween(120), initialScale = 0.85f),
            exit = fadeOut(tween(90)) + scaleOut(tween(90), targetScale = 0.85f),
        ) {
            FanCapsule(
                emojis = fan.emojis,
                highlighted = fan.highlighted,
                ground = ground,
                onTap = { index ->
                    val step = fan.tapEmoji(at = index)
                    fan = step.model
                    fire(step.effect)
                },
            )
        }
        // The hold-slide-release gesture, mirroring iOS's DragGesture(minimumDistance: 0): touch down
        // opens (heldOpen, no long-press latency), sliding highlights the emoji under the finger, and
        // release fires over an emoji, stands the fan open on the button (the tap fallback), or
        // cancels anywhere else. The row sits ROW_GAP above the button, End-aligned, so the slot under
        // a button-local finger comes straight from ReactionFanLayout (hit test and render agree).
        FanButton(
            ground = ground,
            enabled = enabled,
            open = fan.isOpen,
            count = fan.emojis.size,
            onHoldBegan = { fan = fan.holdBegan() },
            onHoldMoved = { slot -> fan = fan.holdMoved(over = slot) },
            onHoldEnded = { slot, onButton ->
                val step = fan.holdEnded(over = slot, onButton = onButton, now = reactionNow())
                fan = step.model
                fire(step.effect)
            },
        )
    }
}

/** The button's edge and the button-release slack (twin of iOS ReactionFan.buttonSize / buttonSlack);
 *  ROW_GAP is the air between the button's top and the open row's bottom (the Column's own spacing,
 *  so the render and the slot mapping share one number). */
private const val BUTTON_SIZE_DP: Float = 48f
private const val ROW_GAP_DP: Float = 8f
private const val BUTTON_SLACK_DP: Float = 10f

/** The round fan trigger. Token-colored surface; the whole hold-slide-release grammar lives here on
 *  one press gesture, the tap fallback included. */
@Composable
private fun FanButton(
    ground: GridGround,
    enabled: Boolean,
    open: Boolean,
    count: Int,
    onHoldBegan: () -> Unit,
    onHoldMoved: (Int?) -> Unit,
    onHoldEnded: (slot: Int?, onButton: Boolean) -> Unit,
) {
    val surface = if (ground.isDark) Color.White.copy(alpha = 0.12f) else Color.Black.copy(alpha = 0.08f)
    val density = LocalDensity.current.density
    // Read fresh inside the long-lived recognizer so a set change (count) is seen without restarting a
    // live gesture; the callbacks are stable but captured through updated state for safety.
    val began = rememberUpdatedState(onHoldBegan)
    val moved = rememberUpdatedState(onHoldMoved)
    val ended = rememberUpdatedState(onHoldEnded)

    // The row's slot under a button-local point, through the shared layout: the row is End-aligned and
    // ROW_GAP above the button, so its frame in button-local space is pure arithmetic (twin of iOS
    // ReactionFan.slot(at:)).
    fun slotAt(position: Offset): Int? {
        val xDp = position.x / density
        val yDp = position.y / density
        val rowWidth = ReactionFanLayout.width(count)
        val rowHeight = ReactionFanLayout.height
        val rowX = xDp - (BUTTON_SIZE_DP - rowWidth)
        val rowY = yDp + rowHeight + ROW_GAP_DP
        return ReactionFanLayout.slot(rowX.toDouble(), rowY.toDouble(), count)
    }

    fun onButtonAt(position: Offset): Boolean {
        val xDp = position.x / density
        val yDp = position.y / density
        return xDp >= -BUTTON_SLACK_DP && xDp <= BUTTON_SIZE_DP + BUTTON_SLACK_DP &&
            yDp >= -BUTTON_SLACK_DP && yDp <= BUTTON_SIZE_DP + BUTTON_SLACK_DP
    }

    Row(
        modifier = Modifier
            .size(BUTTON_SIZE_DP.dp)
            .clip(CircleShape)
            .background(surface)
            .pointerInput(enabled, count) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown()
                    began.value()
                    var lastPosition = down.position
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id } ?: event.changes.first()
                        lastPosition = change.position
                        if (!change.pressed) break
                        moved.value(slotAt(change.position))
                        change.consume()
                    }
                    ended.value(slotAt(lastPosition), onButtonAt(lastPosition))
                }
            },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (open) "×" else "☺", fontSize = if (open) 22.sp else 20.sp, color = ground.tokens.ink.toColor())
    }
}

/** The open capsule: the five options in slot order, the highlighted one enlarged. A tap fires (the
 *  standing tap-tap grammar), which keeps working alongside the button's hold-slide. */
@Composable
private fun FanCapsule(
    emojis: List<String>,
    highlighted: Int?,
    ground: GridGround,
    onTap: (Int) -> Unit,
) {
    val surface = if (ground.isDark) Color.White.copy(alpha = 0.10f) else Color.Black.copy(alpha = 0.06f)
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(28.dp))
            .background(surface)
            .padding(horizontal = ReactionFanLayout.CAPSULE_PADDING.dp, vertical = ReactionFanLayout.CAPSULE_PADDING.dp),
        horizontalArrangement = Arrangement.spacedBy(ReactionFanLayout.SLOT_SPACING.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        emojis.forEachIndexed { index, emoji ->
            Row(
                modifier = Modifier
                    .size(ReactionFanLayout.SLOT_SIZE.dp)
                    .clip(CircleShape)
                    .pointerInput(emojis) { detectTapGestures(onTap = { onTap(index) }) },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(emoji, fontSize = if (highlighted == index) 26.sp else 22.sp)
            }
        }
    }
}
