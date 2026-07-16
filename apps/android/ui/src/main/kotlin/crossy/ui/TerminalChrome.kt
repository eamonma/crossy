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
    /** The completion notice, the one lexicon sentence (EXPERIENCE.md §5, verbatim from apps/ios
     *  RoomTerminal.completedNotice): the solved room reads "Solved together" once the moment settles.
     *  Verbatim contract, so the three clients say the same one sentence. */
    const val completedNotice: String = "Solved together"

    /** The kicked notice, the one honest sentence (EXPERIENCE.md lexicon: kicked). */
    const val kickedNotice: String = "The host removed you from this room"

    /** The kicked exit's affordance: home is Rooms, so the way out says so plainly (ID-5). */
    const val kickedExitWord: String = "Back to Rooms"
}

/** The solved room's quiet notice (apps/ios RoomTerminal.completedNotice): once the completion moment
 *  settles the room reads "Solved together" where the retired key deck stood, the lexicon sentence in
 *  the ground's ink. A pure function of the ground; the room decides WHEN to show it (after the mosaic
 *  bloom settles on a live finish, at once on a reconnect into a room already solved). Its own region
 *  here so the sibling that owns the abandoned notice can add its line beside it without a conflict. */
@Composable
fun SolvedNotice(ground: GridGround, modifier: Modifier = Modifier) {
    Text(
        RoomTerminal.completedNotice,
        color = ground.tokens.ink.toColor(),
        fontSize = 16.sp,
        fontWeight = FontWeight.SemiBold,
        textAlign = TextAlign.Center,
        modifier = modifier,
    )
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
