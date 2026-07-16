// The active-clue bar (DESIGN.md §10: "a tappable active-clue bar"; iOS ClueChrome). Shows the clue
// running through the cursor with prev/next controls that step the word cycle, and grows an expand
// affordance into the clue browser: a tap on the clue opens a scrollable Across/Down list where a tap
// jumps the cursor to a clue. The browser marks the active row and washes the crossing and
// cross-referenced rows (achromatic emphasis, DESIGN.md §3; D26), and de-emphasizes a fully filled
// word. iOS melts the bar into the browser as one glass surface (SP-i1); here the browser is a bottom
// sheet on a solid token surface (the glass melt is a later material pass), with swipe-down to dismiss
// carried by the sheet. A near-pure function of the resolved clue and the browser rows; the room screen
// owns clue selection, the step intents, and the jump.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
) {
    val tokens = ground.tokens
    val hasBrowser = acrossRows.isNotEmpty() || downRows.isNotEmpty()
    var expanded by remember { mutableStateOf(false) }
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

    if (expanded && hasBrowser) {
        ClueBrowserSheet(
            acrossRows = acrossRows,
            downRows = downRows,
            ground = ground,
            onJump = { row -> onJump(row); expanded = false },
            onDismiss = { expanded = false },
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
) {
    val tokens = ground.tokens
    val sheetState = rememberModalBottomSheetState()
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
                .padding(bottom = 24.dp),
        ) {
            ClueBrowserSection("Across", acrossRows, ground, onJump)
            ClueBrowserSection("Down", downRows, ground, onJump)
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
