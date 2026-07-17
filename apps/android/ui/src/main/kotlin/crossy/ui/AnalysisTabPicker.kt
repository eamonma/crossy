// The completed clue chrome's Clues/Analysis segmented control (owner ruling 2026-07-13; twin of apps/
// ios AnalysisTabPicker.swift). iOS reaches for the SYSTEM segmented Picker so it wears whatever the
// platform gives a segmented control; the Android twin uses Material3's SingleChoiceSegmentedButtonRow
// for the same reason: the platform control, no hand-rolled material to drift from the system's. The
// active tab writes the caller's state. Mid-solve the clue browser never carries a picker (there is no
// analysis until the room completes); AnalysisChrome.showsAnalysis gates the whole surface on that.

package crossy.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/** The two faces of the completed room's clue chrome (twin of the iOS AnalysisTab): the clue browser
 *  the live room already carried, and the post-game panel. */
enum class AnalysisTab { CLUES, ANALYSIS }

/** The completed-surface gate, pure so tab routing pins headlessly (twin of the iOS ClueChrome
 *  `completed && analysisTab == .analysis` guard). The analysis panel shows only in a completed room on
 *  the Analysis tab; a live room never reaches it, whatever tab state is remembered, and the picker
 *  itself is only drawn when completed. */
object AnalysisChrome {
    /** Whether the browser sheet should render the analysis panel rather than the clue sections. */
    fun showsAnalysis(completed: Boolean, tab: AnalysisTab): Boolean =
        completed && tab == AnalysisTab.ANALYSIS

    /** Whether the completed room's tab pair is offered at all. A live room shows the plain browser. */
    fun tabbed(completed: Boolean): Boolean = completed
}

/** The Clues/Analysis segmented control shown at the head of the completed room's browser sheet. The
 *  active tab writes back through [onSelect]; the platform control owns its own selection slide. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalysisTabPicker(
    selection: AnalysisTab,
    onSelect: (AnalysisTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tabs = listOf(AnalysisTab.CLUES to "Clues", AnalysisTab.ANALYSIS to "Analysis")
    SingleChoiceSegmentedButtonRow(
        modifier = modifier
            .fillMaxWidth()
            .semantics { contentDescription = "Clues or Analysis" },
    ) {
        tabs.forEachIndexed { index, (tab, label) ->
            SegmentedButton(
                selected = selection == tab,
                onClick = { onSelect(tab) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = tabs.size),
            ) {
                Text(label)
            }
        }
    }
}
