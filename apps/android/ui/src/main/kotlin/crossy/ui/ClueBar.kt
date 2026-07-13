// The active-clue bar (DESIGN.md §10: "a tappable active-clue bar"; iOS ClueBook / ClueChrome).
// Shows the clue running through the cursor with prev/next controls that step the word cycle. A
// pure function of the resolved active clue; the room screen owns clue selection and the step
// intents. Rich clue-run styling (ClueRunText) is a later track: the plain `text` is the permanent
// fallback and the only field a functional bar needs (PROTOCOL.md §12, Clue.runs is additive).

package crossy.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The active clue in plain values: its label (number plus axis, e.g. "12 ACROSS") and prose. Null
 *  label/text render an empty bar so the room chrome keeps its height before a clue resolves. */
data class ActiveClue(val label: String, val text: String)

@Composable
fun ClueBar(
    clue: ActiveClue?,
    ground: GridGround,
    modifier: Modifier = Modifier,
    onPrev: () -> Unit = {},
    onNext: () -> Unit = {},
) {
    val tokens = ground.tokens
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = tokens.cell.toColor(),
        contentColor = tokens.ink.toColor(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Chevron("‹", tokens.number.toColor(), onPrev)
            androidx.compose.foundation.layout.Column(modifier = Modifier.weight(1f)) {
                Text(
                    clue?.label.orEmpty(),
                    color = tokens.number.toColor(),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    clue?.text.orEmpty(),
                    color = tokens.ink.toColor(),
                    fontSize = 16.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Chevron("›", tokens.number.toColor(), onNext)
        }
    }
}

@Composable
private fun Chevron(glyph: String, color: androidx.compose.ui.graphics.Color, onTap: () -> Unit) {
    Text(
        glyph,
        color = color,
        fontSize = 26.sp,
        modifier = Modifier
            .size(36.dp)
            .pointerInput(Unit) { detectTapGestures { onTap() } }
            .padding(top = 2.dp),
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    )
}
