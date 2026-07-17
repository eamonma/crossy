// The inline rebus entry (EXPERIENCE.md baseline rebus: multi-glyph entry committed as one value).
// Two pieces, both twins of iOS. `RebusBuffer` is the pure buffer lifecycle iOS keeps in
// SelectionModel.pressInRebusMode: letters grow the buffer to the PROTOCOL.md §3 cap, backspace
// edits it and exits when it is already empty, and the rebus key commits the whole value (an empty
// commit just closes). It is pure over the buffer string so the room screen owns no rule, and the
// tests pin the cadence without a composable. `RebusField` is the momentary inline field iOS draws
// (SolveScreen.RebusField): the buffer as it grows with an ink caret, over the cell token surface.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One mode-changing step of the rebus buffer lifecycle (backspace and commit). `Editing` stays in
 *  rebus mode with the new buffer; `Exit` leaves rebus mode with nothing committed; `Commit` leaves
 *  and sends the value as one command (through InputActions.rebus). Twin of iOS's pressInRebusMode
 *  branches. Appending a letter never changes the mode, so `append` returns the buffer directly. */
sealed interface RebusStep {
    data class Editing(val buffer: String) : RebusStep
    data object Exit : RebusStep
    data class Commit(val value: String) : RebusStep
}

/** The rebus buffer transitions as pure functions (iOS SelectionModel.pressInRebusMode). The room
 *  screen holds the buffer string and routes deck keys here; nothing here touches a store. */
object RebusBuffer {
    /** The wire value charset cap (PROTOCOL.md §3): 1 to 10 glyphs. Twin of iOS's rebusGlyphCap. */
    const val GLYPH_CAP = 10

    /** A letter into the buffer: append its normalized glyph while under the cap, else hold. A
     *  non-value character (nothing the deck offers) is ignored, exactly as iOS's guard drops it.
     *  Always stays in rebus mode, so this returns the next buffer string. */
    fun append(buffer: String, character: Char): String {
        if (buffer.length >= GLYPH_CAP) return buffer
        val glyph = InputActions.deckValue(character.toString()) ?: return buffer
        return buffer + glyph
    }

    /** Backspace edits the buffer; on an already-empty buffer it leaves rebus mode (iOS: backspace
     *  on an empty buffer exits). Rebus editing never clears board cells. */
    fun backspace(buffer: String): RebusStep =
        if (buffer.isEmpty()) RebusStep.Exit else RebusStep.Editing(buffer.dropLast(1))

    /** The rebus key commits: a non-empty buffer sends its value, an empty one just closes (iOS:
     *  an empty commit just closes). */
    fun commit(buffer: String): RebusStep =
        if (buffer.isEmpty()) RebusStep.Exit else RebusStep.Commit(buffer)
}

/** The baseline rebus entry (EXPERIENCE.md §6: a plain inline field qualifies): the buffer as it
 *  grows, committed as one value by the deck's rebus key. Over the cell token surface with an ink
 *  caret; the glass material is a later design track (Wave A4 bar is functional). Twin of iOS's
 *  SolveScreen.RebusField. */
@Composable
fun RebusField(
    buffer: String,
    ground: GridGround,
    modifier: Modifier = Modifier,
) {
    val tokens = ground.tokens
    // The field's spoken value (iOS RebusField.accessibilityLabel): the entry and its buffer, merged so
    // the caret bar below stays decorative.
    val label = if (buffer.isEmpty()) "Rebus entry" else "Rebus entry $buffer"
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(tokens.cell.toColor())
            .semantics(mergeDescendants = true) { contentDescription = label }
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(3.dp),
    ) {
        if (buffer.isEmpty()) {
            Text("Rebus", color = tokens.number.toColor(), fontSize = 15.sp, fontWeight = FontWeight.Medium)
        } else {
            Text(buffer, color = tokens.ink.toColor(), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        // The ink caret, a thin bar (iOS's 2x18 rounded rect).
        Row(
            modifier = Modifier
                .width(2.dp)
                .height(18.dp)
                .clip(RoundedCornerShape(1.dp))
                .background(tokens.ink.toColor()),
        ) {}
    }
}
