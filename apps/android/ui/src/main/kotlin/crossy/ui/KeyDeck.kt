// The on-screen key deck (DESIGN.md §10 "an on-screen keyboard driving store actions directly";
// iOS KeyDeck / ID-4). A QWERTY letter set plus the rebus key and backspace — iOS's exact key set
// (direction toggles ride tap-again and the grid swipe, never a key) — each key a plain intent
// callback; the room screen routes intents through InputActions so the deck honors the store's
// navigation without knowing any of it. The rebus key opens (and commits) the inline multi-glyph
// field (EXPERIENCE.md baseline rebus); its glyph turns to a checkmark while the buffer is open,
// exactly as iOS's DeckKeyView does. Geometry and the glass material are a later design track
// (Wave A4 bar is functional): keys are token-colored surfaces with a minimal press-scale fade,
// no springs, no haptics wired yet. The deck always sits over solid canvas, never over the grid
// (ID-4); that stacking is the room screen's job.

package crossy.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A key press intent. Letters carry their character (already an ASCII A-Z uppercase); the utility
 *  keys are the rebus open/commit and backspace. Exact twin of iOS's DeckKey. */
sealed interface DeckKey {
    data class Letter(val character: Char) : DeckKey
    data object Rebus : DeckKey
    data object Backspace : DeckKey
}

private val ROWS = listOf("QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM")

@Composable
fun KeyDeck(
    ground: GridGround,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    // True while a rebus buffer is open (RoomScreen owns it): the rebus key wears a checkmark and
    // the press commits, mirroring iOS's DeckKeyView. Off, it opens the buffer.
    rebusActive: Boolean = false,
    // The per-press haptic tick, fired at touch-DOWN alongside the visual press (iOS KeyHaptics.tick,
    // fired in the deck's own gesture so it rides the press even as intent routing changes). No-op by
    // default (previews, the demo room).
    onKeyTick: () -> Unit = {},
    onKey: (DeckKey) -> Unit,
) {
    val tokens = ground.tokens
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ROWS.forEachIndexed { index, row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (index == ROWS.size - 1) {
                    // The rebus key leads the last row, opposite backspace (iOS DeckLayout). Its label
                    // tracks the mode, exactly as iOS's accessibilityName does.
                    DeckButton(
                        ground, enabled, weight = 1.5f,
                        label = if (rebusActive) "Commit rebus" else "Rebus",
                        onPress = { onKeyTick(); onKey(DeckKey.Rebus) },
                    ) {
                        if (rebusActive) {
                            Text("✓", color = tokens.ink.toColor(), fontSize = 18.sp, fontWeight = FontWeight.Medium)
                        } else {
                            Text("REBUS", color = tokens.ink.toColor(), fontSize = 10.sp, fontWeight = FontWeight.Medium)
                        }
                    }
                }
                row.forEach { ch ->
                    DeckButton(
                        ground, enabled, weight = 1f,
                        label = ch.toString(),
                        onPress = { onKeyTick(); onKey(DeckKey.Letter(ch)) },
                    ) {
                        Text(ch.toString(), color = tokens.ink.toColor(), fontSize = 18.sp, fontWeight = FontWeight(ground.glyphWeight))
                    }
                }
                if (index == ROWS.size - 1) {
                    DeckButton(
                        ground, enabled, weight = 1.5f,
                        label = "Delete",
                        onPress = { onKeyTick(); onKey(DeckKey.Backspace) },
                    ) {
                        Text("⌫", color = tokens.ink.toColor(), fontSize = 18.sp)
                    }
                }
            }
        }
    }
}

/** One key: a token-colored rounded surface with a minimal press-scale fade (no spring, Wave A4
 *  bar). Mutates on touch-down so press-to-glyph stays immediate, the iOS deck's latency posture. */
@Composable
private fun androidx.compose.foundation.layout.RowScope.DeckButton(
    ground: GridGround,
    enabled: Boolean,
    weight: Float,
    // The spoken name (iOS DeckKeyView.accessibilityName): the letter, "Delete", "Rebus"/"Commit rebus".
    label: String,
    onPress: () -> Unit,
    content: @Composable () -> Unit,
) {
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if (pressed) 0.93f else 1f, label = "key-press")
    val surface = if (ground.isDark) Color.White.copy(alpha = 0.06f) else Color.Black.copy(alpha = 0.05f)
    Row(
        modifier = Modifier
            .weight(weight)
            .height(46.dp)
            .scale(scale)
            .clip(RoundedCornerShape(8.dp))
            .background(surface)
            .semantics { this.contentDescription = label; this.role = Role.Button }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectTapGestures(
                    onPress = {
                        pressed = true
                        onPress()
                        tryAwaitRelease()
                        pressed = false
                    },
                )
            },
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        content()
    }
}
