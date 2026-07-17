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
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
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

    // The room check (PROTOCOL.md §5, §10; D27), word-for-word the iOS/web copy so the permanence
    // disclosure reaches every platform the same way. The confirm is the end-game register exactly
    // but non-destructive (a check is a room act, not a teardown): plain tint, no red.
    const val checkAction = "Check puzzle"
    const val checkConfirmTitle = "Check the puzzle for everyone?"
    const val checkConfirmBody = "Wrong letters get marked for the whole room. This is recorded."
    const val checkConfirmAction = "Check puzzle"
    const val checkCancelAction = "Keep solving"
}

/** The header's spoken line (twin of iOS RoomFactsSheet.accessibilityLine): the name, the clock, then
 *  the facts with the visual " · " separator read as a comma pause. */
internal fun factsAccessibilityLine(label: String, clock: String, detail: String?, checkedLine: String? = null): String {
    var line = "$label, $clock"
    if (detail != null) line += ", " + detail.replace(" · ", ", ")
    if (checkedLine != null) line += ", $checkedLine"
    return line
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
data class RoomFactsContent(val label: String, val detail: String?, val checkedLine: String? = null) {
    companion object {
        fun make(
            roomName: String,
            puzzleTitle: String? = null,
            puzzleAuthor: String? = null,
            puzzleDate: String? = null,
            // The room's mid-solve check record (PROTOCOL.md §10, D27; design R10): a quiet, neutral
            // line among the facts, no attribution (the wire event carries no `by`). Nil until the
            // first accepted check.
            checkCount: Int = 0,
            // The sitting count as facts context (owner ruling, D29): appended to the " · " grammar
            // only at two or more; one sitting (or a pre-D29 null) reads exactly as today.
            sittingCount: Int? = null,
        ): RoomFactsContent {
            val facts = buildList {
                addAll(listOfNotNull(puzzleTitle, puzzleAuthor, puzzleDate).filter { it.isNotEmpty() })
                if (sittingCount != null && sittingCount >= 2) add("$sittingCount sittings")
            }
            return RoomFactsContent(
                label = roomName,
                detail = if (facts.isEmpty()) null else facts.joinToString(" · "),
                checkedLine = checkedLine(checkCount),
            )
        }

        /** The R10 wording, natural casing, no zeros: null before the first check. */
        internal fun checkedLine(count: Int): String? = when {
            count < 1 -> null
            count == 1 -> "Checked once"
            else -> "Checked $count times"
        }
    }
}

/** The sheet's operations, derived once so the view renders no policy (twin of iOS FactsOperations).
 *  Two rows can stand: the room check (any host or solver, PROTOCOL.md §5, §10; D27) above the host's
 *  end-game (POST /games/{id}/abandon, host only, §12). A participant offered neither sees facts alone. */
data class FactsOperations(val check: Check?, val canEndGame: Boolean) {
    val hasAny: Boolean get() = check != null || canEndGame

    /** How many operation rows render (the check above end-game), the sheet-height input. */
    val rowCount: Int get() = (if (check != null) 1 else 0) + (if (canEndGame) 1 else 0)

    /** The check row's render facts (design R7): present means the row stands; enabled only when the
     *  grid is full, with the quiet remaining-cells hint teaching the gate below full. */
    data class Check(val emptyCells: Int) {
        // A negative input (a stand-in puzzle racing state) clamps to zero (R9: sequenced state only).
        val clampedEmpty: Int get() = maxOf(0, emptyCells)

        /** The grid-full gate (PROTOCOL.md §5: checkPuzzle requires a full grid). */
        val isEnabled: Boolean get() = clampedEmpty == 0

        /** The quiet trailing hint while the grid is short; null at full. Natural casing, singular at one. */
        val hint: String? get() = when (clampedEmpty) {
            0 -> null
            1 -> "1 empty"
            else -> "$clampedEmpty empty"
        }
    }

    companion object {
        /** `isHost` gates the destructive end-game; the check row needs a live check-capable transport
         *  (R8: the demo's loopback drops the command), a playing seat (spectators never see it,
         *  §5's host|solver), and carries the sequenced empty-cell count for its own enable gate (R9). */
        fun make(
            isHost: Boolean,
            isSpectator: Boolean,
            supportsCheck: Boolean,
            emptyCells: Int,
        ): FactsOperations = FactsOperations(
            check = if (supportsCheck && !isSpectator) Check(emptyCells) else null,
            canEndGame = isHost,
        )

        val none = FactsOperations(check = null, canEndGame = false)
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
    // Check the puzzle for the room (PROTOCOL.md §5, §10; D27). Confirmed here first, then reported;
    // the caller re-derives the grid-full gate at the confirm tap (design R2) and owns the send.
    onCheckPuzzle: () -> Unit = {},
    onEndGame: () -> Unit,
    onDismiss: () -> Unit,
) {
    val tokens = ground.tokens
    val sheetState = rememberModalBottomSheetState()
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    var confirmingCheck by remember { mutableStateOf(false) }
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
            val label = content.label.takeIf { it.isNotBlank() } ?: "Crossy"
            val clock = RoomFactsClock.headline(solveTimeSeconds, firstFillAt, freezeAt, now)
            // The facts read as one element (iOS accessibilityElement children:.ignore +
            // accessibilityLine "label, time, detail"); the End game row below stays its own node.
            Column(
                modifier = Modifier.fillMaxWidth().clearAndSetSemantics {
                    contentDescription = factsAccessibilityLine(label, clock, content.detail, content.checkedLine)
                },
            ) {
                Text(
                    label,
                    color = tokens.number.toColor(),
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    clock,
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
                // The check record (R10): quiet and neutral, no attribution (the wire event carries
                // no `by`, D27). Its own line below the facts detail, tabular so the count sits still.
                content.checkedLine?.let { checkedLine ->
                    Text(
                        checkedLine,
                        color = tokens.number.toColor(),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        style = androidx.compose.ui.text.TextStyle.Default.withTabularNumerals(),
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
            // The operations block (the check above end-game, R7): air, one hairline, air, then the
            // rows, rendered only when at least one stands. The check row's remaining-cells hint sits
            // INSIDE the standard row height at the trailing edge, no extra slot.
            if (operations.hasAny) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 22.dp, bottom = 14.dp)
                        .height(1.dp)
                        .background(tokens.number.toColor().copy(alpha = 0.28f)),
                )
                operations.check?.let { check ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(44.dp)
                            .then(
                                if (check.isEnabled) {
                                    Modifier.pointerInput(Unit) { detectTapGestures { confirmingCheck = true } }
                                } else {
                                    Modifier
                                },
                            ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            RoomFactsCopy.checkAction,
                            // The gate teaches through tone: full is ink, short is the quiet number
                            // color (disabled), never red (a check is non-destructive, D27).
                            color = if (check.isEnabled) tokens.ink.toColor() else tokens.number.toColor(),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                        )
                        check.hint?.let { hint ->
                            Spacer(Modifier.weight(1f))
                            Text(
                                hint,
                                color = tokens.number.toColor(),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                style = androidx.compose.ui.text.TextStyle.Default.withTabularNumerals(),
                            )
                        }
                    }
                }
                if (operations.canEndGame) {
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
    }

    if (confirmingCheck) {
        AlertDialog(
            onDismissRequest = { confirmingCheck = false },
            containerColor = tokens.canvas.toColor(),
            title = { Text(RoomFactsCopy.checkConfirmTitle, color = tokens.ink.toColor()) },
            text = { Text(RoomFactsCopy.checkConfirmBody, color = tokens.number.toColor()) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingCheck = false
                    onCheckPuzzle()
                    onDismiss()
                }) { Text(RoomFactsCopy.checkConfirmAction) }
            },
            dismissButton = {
                TextButton(onClick = { confirmingCheck = false }) { Text(RoomFactsCopy.checkCancelAction) }
            },
        )
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
