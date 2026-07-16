// The reaction fan (twin of apps/ios ReactionFan): a floating button near the clue bar's trailing
// corner that opens the holder's five reaction options; a tap on one sends at the current cursor
// cell. All grammar lives in the pure ReactionFanModel (tested exhaustively); this surface only
// translates touches into its calls and renders the phase. It stays visible in any game status
// (reactions are legal post-completion, PROTOCOL.md §9), so it is composed independently of the key
// deck's terminal retirement.

package crossy.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
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
    val tokens = ground.tokens

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
        verticalArrangement = Arrangement.spacedBy(8.dp),
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
        FanButton(
            ground = ground,
            enabled = enabled,
            open = fan.isOpen,
            onTap = {
                // The tap fallback: press opens (heldOpen), release on the button either opens the
                // standing fan or toggles a standing one closed. One button, one toggle.
                fan = fan.holdBegan()
                val step = fan.holdEnded(over = null, onButton = true, now = reactionNow())
                fan = step.model
                fire(step.effect)
            },
        )
    }
}

/** The round fan trigger. Token-colored surface with the current-set's first emoji as its face; a
 *  minimal press posture, no springs (Wave A4 bar). */
@Composable
private fun FanButton(
    ground: GridGround,
    enabled: Boolean,
    open: Boolean,
    onTap: () -> Unit,
) {
    val surface = if (ground.isDark) Color.White.copy(alpha = 0.12f) else Color.Black.copy(alpha = 0.08f)
    Row(
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape)
            .background(surface)
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures(onTap = { onTap() })
            },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (open) "×" else "☺", fontSize = if (open) 22.sp else 20.sp, color = ground.tokens.ink.toColor())
    }
}

/** The open capsule: the five options in slot order, the highlighted one enlarged. A tap fires. */
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
            .padding(horizontal = 6.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        emojis.forEachIndexed { index, emoji ->
            Row(
                modifier = Modifier
                    .size(44.dp)
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
