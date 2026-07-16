// The room-facts sheet (owner ruling 2026-07-10: the time pill is the room's facts; twin of apps/ios
// RoomFactsSheet.swift). A tap on the time pill mid-solve presents this sheet: the room's name, the
// live clock as the headline, the puzzle's facts when known, and (for the host) the End game action
// under a hairline, one two-beat confirm. A mid-solve surface only: at completion the pill seals and
// stands as the record, and the caller gates the summon to `ongoing`, so a tap on a terminal pill does
// nothing. The words and operations are pure (RoomFactsContent, FactsOperations, RoomFactsClock); the
// clock ticks against `now` on a 1 Hz loop, the bar clock's own arithmetic. A solid token surface (the
// glass register is a later material pass); the behavior is in.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

/** The facts sheet's copy, greppable in one place (ID-5). The End game confirm is the one destructive
 *  two-beat (EXPERIENCE.md: abandon, one confirm, plainly worded). */
object RoomFactsCopy {
    const val endGameAction = "End game"
    const val endGameConfirmTitle = "End this game for everyone?"
    const val endGameConfirmBody = "This ends the game for everyone in the room."
    const val endGameConfirmAction = "End game"
    const val endGameCancelAction = "Keep playing"
}

/** The sheet's headline clock, one pure rule (twin of iOS RoomFactsClock): the server's stat leads
 *  when it exists (stats arrive only with completion, PROTOCOL.md §6); otherwise the ambient clock's
 *  value, which ticks against `now` while the room runs and freezes at the terminal instant (ID-2). */
object RoomFactsClock {
    fun headline(
        solveTimeSeconds: Int?,
        firstFillAt: String?,
        freezeAt: String?,
        nowMillis: Long,
    ): String {
        if (solveTimeSeconds != null) return AmbientClock.display(solveTimeSeconds)
        return AmbientClock.display(firstFillAt, freezeAt, nowMillis)
    }
}

/** The sheet's words, derived once as plain strings (twin of iOS RoomFactsContent). Mid-solve the
 *  label is the room's name and the detail the puzzle's facts (title, byline, date), each dropped when
 *  absent. The wire types carry no puzzle metadata yet, so a live sheet's detail is usually null and
 *  the label alone stands. */
data class RoomFactsContent(val label: String, val detail: String?) {
    companion object {
        fun make(
            roomName: String,
            puzzleTitle: String? = null,
            puzzleAuthor: String? = null,
            puzzleDate: String? = null,
        ): RoomFactsContent {
            val facts = listOfNotNull(puzzleTitle, puzzleAuthor, puzzleDate).filter { it.isNotEmpty() }
            return RoomFactsContent(
                label = roomName,
                detail = if (facts.isEmpty()) null else facts.joinToString(" · "),
            )
        }
    }
}

/** The sheet's operations, derived once so the view renders no policy (twin of iOS FactsOperations).
 *  The only operation is the host's end-game (POST /games/{id}/abandon, host only); a non-host sees
 *  facts alone. */
data class FactsOperations(val canEndGame: Boolean) {
    val hasAny: Boolean get() = canEndGame

    companion object {
        /** `isHost` gates the destructive end-game; the server refuses a non-host abandon anyway, so
         *  the client simply does not show it. */
        fun make(isHost: Boolean): FactsOperations = FactsOperations(canEndGame = isHost)

        val none = FactsOperations(canEndGame = false)
    }
}

/**
 * The facts sheet as pixels. Presented by the composition root off the time pill's tap (gated to
 * ongoing). The 1 Hz loop keeps the headline honest while the room runs; [onEndGame] fires only after
 * the two-beat confirm.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomFactsSheet(
    ground: GridGround,
    content: RoomFactsContent,
    operations: FactsOperations,
    solveTimeSeconds: Int?,
    firstFillAt: String?,
    freezeAt: String?,
    onEndGame: () -> Unit,
    onDismiss: () -> Unit,
) {
    val tokens = ground.tokens
    val sheetState = rememberModalBottomSheetState()
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    var confirmingEnd by remember { mutableStateOf(false) }
    // The 1 Hz headline tick: the room's shared clock ages while the sheet stands (a completed
    // headline reads a fixed stat, so the tick is harmless there).
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = tokens.canvas.toColor(),
        contentColor = tokens.ink.toColor(),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 8.dp, bottom = 32.dp),
        ) {
            Text(
                content.label.takeIf { it.isNotBlank() } ?: "Crossy",
                color = tokens.number.toColor(),
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                RoomFactsClock.headline(solveTimeSeconds, firstFillAt, freezeAt, now),
                color = tokens.ink.toColor(),
                fontSize = 52.sp,
                fontWeight = FontWeight.SemiBold,
                style = androidx.compose.ui.text.TextStyle.Default.withTabularNumerals(),
                modifier = Modifier.padding(top = 10.dp),
            )
            content.detail?.let { detail ->
                Text(
                    detail,
                    color = tokens.number.toColor(),
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
            if (operations.canEndGame) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 22.dp, bottom = 14.dp)
                        .height(1.dp)
                        .background(tokens.number.toColor().copy(alpha = 0.28f)),
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .pointerInput(Unit) { detectTapGestures { confirmingEnd = true } },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        RoomFactsCopy.endGameAction,
                        color = tokens.ink.toColor(),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }
        }
    }

    if (confirmingEnd) {
        AlertDialog(
            onDismissRequest = { confirmingEnd = false },
            containerColor = tokens.canvas.toColor(),
            title = { Text(RoomFactsCopy.endGameConfirmTitle, color = tokens.ink.toColor()) },
            text = { Text(RoomFactsCopy.endGameConfirmBody, color = tokens.number.toColor()) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingEnd = false
                    onEndGame()
                    onDismiss()
                }) { Text(RoomFactsCopy.endGameConfirmAction) }
            },
            dismissButton = {
                TextButton(onClick = { confirmingEnd = false }) { Text(RoomFactsCopy.endGameCancelAction) }
            },
        )
    }
}
