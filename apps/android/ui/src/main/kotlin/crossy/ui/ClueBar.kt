// The active-clue bar (DESIGN.md §10: "a tappable active-clue bar"; iOS ClueChrome). Shows the clue
// running through the cursor with prev/next controls that step the word cycle, and grows an expand
// affordance into the clue browser: a tap on the clue opens a scrollable Across/Down list where a tap
// jumps the cursor to a clue. The browser marks the active row and washes the crossing and
// cross-referenced rows (achromatic emphasis, DESIGN.md §3; D26), and de-emphasizes a fully filled
// word. iOS melts the bar into the browser as one glass surface (SP-i1); here the browser is a bottom
// sheet on a solid token surface (the glass melt is a later material pass), with swipe-down to dismiss
// carried by the sheet. A near-pure function of the resolved clue and the browser rows; the room screen
// owns clue selection, the step intents, and the jump.
//
// A COMPLETED room grows the analysis surface (owner ruling 2026-07-13; iOS ClueChrome ~217-284): the
// bar's rest content becomes the gold "Analysis" door, and the browser sheet gains a Clues/Analysis
// segmented pair (AnalysisTabPicker), the Analysis tab showing the post-game AnalysisPanel. The ongoing
// room's bar is untouched (the `completed` branch is the only new path).

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
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
    // The clue browser's rows (ClueBrowser.rows), Across then Down; empty renders no expand affordance
    // (the demo room and previews pass nothing, so the bar stays the plain stepping bar).
    acrossRows: List<ClueBrowserRow> = emptyList(),
    downRows: List<ClueBrowserRow> = emptyList(),
    onPrev: () -> Unit = {},
    onNext: () -> Unit = {},
    // Jump the cursor to a browser row (the room screen sets the selection and closes the browser).
    onJump: (ClueBrowserRow) -> Unit = {},
    // The completed room grows the analysis surface (owner ruling 2026-07-13). False mid-solve, where
    // the bar stays exactly the stepping bar; true swaps the rest content for the gold Analysis door and
    // the sheet for the tabbed Clues/Analysis surface.
    completed: Boolean = false,
    // The analysis fetch's state, shown under the Analysis tab (read only when `completed`).
    analysisPhase: AnalysisModel.Phase = AnalysisModel.Phase.Idle,
    // The room's people, for the legend and moment names/colors (same list the roster reads).
    analysisMembers: List<RosterMember> = emptyList(),
    selfUserId: String? = null,
    // Fired when the completed room's analysis surface is opened, so the room can kick the idempotent
    // fetch on a tab-open as well as on the completion edge.
    onOpenAnalysis: () -> Unit = {},
    // The legend's solver isolation (iOS 877b504): the isolated solver (null = everyone) and the tap
    // intent, forwarded to the panel; the room owns the state on its MosaicMoment. Null intent keeps
    // the legend rows plain (the bloom in flight, previews).
    isolatedSolverId: String? = null,
    onIsolateSolver: ((String) -> Unit)? = null,
    // The completion card share intent (design/post-game/SHARE.md; Wave 14.6), forwarded to the
    // analysis panel's header. Null when the game cannot be shared (the demo room, an unfinished
    // game), where the "Share card" affordance never appears.
    onShareCard: (() -> Unit)? = null,
) {
    val tokens = ground.tokens
    val hasBrowser = acrossRows.isNotEmpty() || downRows.isNotEmpty()
    var expanded by remember { mutableStateOf(false) }
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = tokens.cell.toColor(),
        contentColor = tokens.ink.toColor(),
    ) {
        if (completed) {
            // The finished bar's affordance into the analysis (iOS analysisDoor): the gold ANALYSIS
            // label and a chevron; a tap opens the sheet on the Analysis tab.
            AnalysisDoor(ground) { expanded = true; onOpenAnalysis() }
        } else {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Chevron("‹", "Previous clue", tokens.number.toColor(), onPrev)
                androidx.compose.foundation.layout.Column(
                    modifier = Modifier
                        .weight(1f)
                        // The whole clue is the expand affordance (iOS: the bar row melts open); it opens
                        // the browser when there is one to open (a live room), a no-op otherwise. One merged
                        // element reads the clue label and prose; a button that shows all clues where one opens.
                        .then(
                            if (hasBrowser) {
                                Modifier.semantics(mergeDescendants = true) {
                                    contentDescription = "${clue?.label.orEmpty()}, ${clue?.text.orEmpty()}"
                                    role = Role.Button
                                    stateDescription = "Show all clues"
                                }
                            } else {
                                Modifier.semantics(mergeDescendants = true) {}
                            },
                        )
                        .pointerInput(hasBrowser) {
                            if (hasBrowser) detectTapGestures { expanded = true }
                        },
                ) {
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
                Chevron("›", "Next clue", tokens.number.toColor(), onNext)
            }
        }
    }

    if (expanded && (hasBrowser || completed)) {
        ClueBrowserSheet(
            acrossRows = acrossRows,
            downRows = downRows,
            ground = ground,
            onJump = { row -> onJump(row); expanded = false },
            onDismiss = { expanded = false },
            completed = completed,
            analysisPhase = analysisPhase,
            analysisMembers = analysisMembers,
            selfUserId = selfUserId,
            onOpenAnalysis = onOpenAnalysis,
            isolatedSolverId = isolatedSolverId,
            onIsolateSolver = onIsolateSolver,
            onShareCard = onShareCard,
        )
    }
}

/** The gold Analysis door, the completed bar's rest content (iOS analysisDoor): the ANALYSIS label in
 *  the text gold, a trailing chevron in the line gold, over a faint gold ground. A tap melts the sheet
 *  open on the Analysis tab. */
@Composable
private fun AnalysisDoor(ground: GridGround, onTap: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(AnalysisPalette.doorWash(ground).toColor())
            .pointerInput(Unit) { detectTapGestures { onTap() } }
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .semantics { contentDescription = "See the analysis" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            "ANALYSIS",
            color = AnalysisPalette.goldText(ground).toColor(),
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.4.sp,
        )
        Text(
            "›",
            color = AnalysisPalette.gold(ground).toColor(),
            fontSize = 22.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** The clue browser: the scrollable Across/Down list the bar opens (iOS ClueChrome.browserList). A
 *  bottom sheet carries the swipe-down dismissal; a tap on a row jumps and closes. The active row wears
 *  a quiet ink wash, the crossing word half of one, a cross-referenced clue a fainter rung, and a
 *  filled word de-emphasizes (achromatic emphasis, DESIGN.md §3). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ClueBrowserSheet(
    acrossRows: List<ClueBrowserRow>,
    downRows: List<ClueBrowserRow>,
    ground: GridGround,
    onJump: (ClueBrowserRow) -> Unit,
    onDismiss: () -> Unit,
    completed: Boolean = false,
    analysisPhase: AnalysisModel.Phase = AnalysisModel.Phase.Idle,
    analysisMembers: List<RosterMember> = emptyList(),
    selfUserId: String? = null,
    onOpenAnalysis: () -> Unit = {},
    isolatedSolverId: String? = null,
    onIsolateSolver: ((String) -> Unit)? = null,
    onShareCard: (() -> Unit)? = null,
) {
    val tokens = ground.tokens
    val sheetState = rememberModalBottomSheetState()
    // A completed room opens on the Analysis tab (the gold door leads there); the picker switches to the
    // clue sections. A live room never carries the tab pair (AnalysisChrome.tabbed), so this is Clues.
    var tab by remember { mutableStateOf(if (completed) AnalysisTab.ANALYSIS else AnalysisTab.CLUES) }
    // Kick the idempotent fetch whenever the Analysis tab is the one showing (the tab-open edge, beside
    // the completion edge the room already drives).
    LaunchedEffect(tab, completed) {
        if (AnalysisChrome.showsAnalysis(completed, tab)) onOpenAnalysis()
    }
    // The sheet's bottom bleed: the ModalBottomSheet draws edge to edge and its default insets
    // (BottomSheetDefaults.windowInsets) pad only the top and sides, so the scroll content bleeds
    // under the system navigation bar, the Android twin of iOS's melt geometry overshooting the
    // safe-area bottom by ChromeLayout.sheetBottomBleed. The completed sheet grows tall enough to
    // scroll, so margin the completed scroll by that same bleed (margin == bleed, iOS commit
    // 78237ad) and its last analysis rows land above the nav bar instead of under it. Mid-solve the
    // clue list is short and anchored, so no margin then, matching iOS's `completed ? bleed : 0`.
    val bleed = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = tokens.canvas.toColor(),
        contentColor = tokens.ink.toColor(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp)
                .padding(bottom = 24.dp + if (completed) bleed else 0.dp),
        ) {
            if (AnalysisChrome.tabbed(completed)) {
                AnalysisTabPicker(
                    selection = tab,
                    onSelect = { tab = it },
                    modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
                )
            }
            if (AnalysisChrome.showsAnalysis(completed, tab)) {
                AnalysisPanel(
                    phase = analysisPhase,
                    members = analysisMembers,
                    selfUserId = selfUserId,
                    ground = ground,
                    isolatedSolverId = isolatedSolverId,
                    onIsolateSolver = onIsolateSolver,
                    onShareCard = onShareCard,
                )
            } else {
                ClueBrowserSection("Across", acrossRows, ground, onJump)
                ClueBrowserSection("Down", downRows, ground, onJump)
            }
        }
    }
}

@Composable
private fun ClueBrowserSection(
    title: String,
    rows: List<ClueBrowserRow>,
    ground: GridGround,
    onJump: (ClueBrowserRow) -> Unit,
) {
    if (rows.isEmpty()) return
    val tokens = ground.tokens
    Text(
        title.uppercase(),
        color = tokens.number.toColor(),
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .padding(start = 6.dp, top = 12.dp, bottom = 4.dp)
            .semantics { heading() },
    )
    for (row in rows) {
        ClueBrowserRowItem(row, ground, onJump)
    }
}

@Composable
private fun ClueBrowserRowItem(row: ClueBrowserRow, ground: GridGround, onJump: (ClueBrowserRow) -> Unit) {
    val tokens = ground.tokens
    // Achromatic emphasis (DESIGN.md §3): the current word leans on a quiet ink wash, the crossing word
    // on half of one, a referenced clue on a fainter rung, everything else nothing.
    val wash = when {
        row.isCurrent -> 0.10f
        row.isCrossing -> 0.05f
        row.isReferenced -> 0.03f
        else -> 0f
    }
    // One spoken row (iOS browserList row label "tag, text"): the number and prose merge, and the
    // active/filled state rides as a state word.
    val rowState = when {
        row.isCurrent -> "current"
        row.isDimmed -> "filled"
        else -> null
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(tokens.ink.toColor().copy(alpha = wash))
            .semantics(mergeDescendants = true) {
                contentDescription = "${row.number}, ${row.text}"
                role = Role.Button
                if (rowState != null) stateDescription = rowState
            }
            .pointerInput(row) { detectTapGestures { onJump(row) } }
            .padding(horizontal = 8.dp, vertical = 8.dp)
            .alpha(if (row.isDimmed) 0.4f else 1f),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "${row.number}",
            color = tokens.number.toColor(),
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            style = TextStyle.Default.withTabularNumerals(),
            modifier = Modifier.size(width = 26.dp, height = 20.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
        Text(
            row.text,
            color = tokens.ink.toColor(),
            fontSize = 14.sp,
            fontWeight = if (row.isCurrent) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun Chevron(glyph: String, label: String, color: androidx.compose.ui.graphics.Color, onTap: () -> Unit) {
    Text(
        glyph,
        color = color,
        fontSize = 26.sp,
        modifier = Modifier
            .size(36.dp)
            .semantics { contentDescription = label; role = Role.Button }
            .pointerInput(Unit) { detectTapGestures { onTap() } }
            .padding(top = 2.dp),
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    )
}
