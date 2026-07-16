// The kicked terminal (apps/ios/Sources/CrossyUI/TerminalChrome.swift; EXPERIENCE.md §5): when the
// host removes you, the room exits outright with one honest sentence and a way back to Rooms. There
// is no board left to browse, so this replaces the room rather than dimming it (the composition root
// raises it from GameStore.onKicked, PROTOCOL.md §6). The lexicon copy is verbatim from iOS's
// RoomTerminal so the three clients say the same one sentence. The chip glass is a later chrome
// track; this is the behavior: the notice, and the plain way home.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Terminal-state lexicon (EXPERIENCE.md §5, verbatim from apps/ios RoomTerminal), so Android says
 *  the same one honest sentence the other clients do. The store already refuses mutations after a
 *  terminal status (InputActions, the store's status gate); this is the kicked-exit copy only. */
object RoomTerminal {
    /** The kicked notice, the one honest sentence (EXPERIENCE.md lexicon: kicked). */
    const val kickedNotice: String = "The host removed you from this room"

    /** The kicked exit's affordance: home is Rooms, so the way out says so plainly (ID-5). */
    const val kickedExitWord: String = "Back to Rooms"

    /** The completion notice (EXPERIENCE.md lexicon: completion). The finished room does not print
     *  this over the board (the deck just leaves and the seal on the time pill is the record, iOS
     *  SolveScreen `.completed`); the line is here so all three clients name completion identically and
     *  a surface that does say it (the facts headline, analysis) reads verbatim. */
    const val completedNotice: String = "Solved together"

    /** The abandoned notice (EXPERIENCE.md lexicon: abandoned), the one line a host-ended room shows
     *  where the deck was (iOS SolveScreen `abandonedZone`): terminal and quiet, nothing else. */
    const val abandonedNotice: String = "The host ended this game"
}

/** Replaces the room after a kick (apps/ios KickedExit): the honest sentence, then the plain way back
 *  to Rooms. A pure function of the ground and the exit intent; the composition root flips to this on
 *  GameStore.onKicked and cancels the driver, so no silent redial runs behind it. */
@Composable
fun KickedExit(ground: GridGround, onExit: () -> Unit, modifier: Modifier = Modifier) {
    val tokens = ground.tokens
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(tokens.canvas.toColor())
            .padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
    ) {
        Text(
            RoomTerminal.kickedNotice,
            color = tokens.ink.toColor(),
            fontSize = 17.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
        Surface(
            color = tokens.cell.toColor(),
            contentColor = tokens.ink.toColor(),
            shape = RoundedCornerShape(23.dp),
            modifier = Modifier.pointerInput(Unit) { detectTapGestures { onExit() } },
        ) {
            Text(
                RoomTerminal.kickedExitWord,
                color = tokens.ink.toColor(),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 28.dp, vertical = 12.dp),
            )
        }
    }
}

/** The abandoned room's one-line notice (iOS SolveScreen `abandonedZone`): a host-ended room freezes
 *  the board with this single quiet sentence where the deck was, terminal and quiet (EXPERIENCE.md).
 *  Unlike the kicked exit, there is still a board to browse, so this replaces only the deck, not the
 *  room. The completed room prints no notice here (the deck just leaves; the time pill's seal is the
 *  record), so this is the abandoned case alone. */
@Composable
fun AbandonedNotice(ground: GridGround, modifier: Modifier = Modifier) {
    val tokens = ground.tokens
    Text(
        RoomTerminal.abandonedNotice,
        color = tokens.number.toColor(),
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
        modifier = modifier
            .fillMaxWidth()
            .background(tokens.canvas.toColor())
            .padding(top = 16.dp, bottom = 18.dp),
    )
}
