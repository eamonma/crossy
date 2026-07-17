// Pins the completed-surface gate against apps/ios ClueChrome (`completed && analysisTab == .analysis`):
// the analysis panel shows only in a completed room on the Analysis tab, the tab pair is offered only
// when completed, and a live room never reaches the panel whatever tab is remembered. Pure, so the tab
// routing pins headlessly.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AnalysisTabGatingTests {
    @Test
    fun `the tab pair is offered only in a completed room`() {
        assertTrue(AnalysisChrome.tabbed(completed = true))
        assertFalse(AnalysisChrome.tabbed(completed = false), "a live room shows the plain clue browser")
    }

    @Test
    fun `the analysis panel shows only when completed and on the Analysis tab`() {
        assertTrue(AnalysisChrome.showsAnalysis(completed = true, tab = AnalysisTab.ANALYSIS))
        assertFalse(AnalysisChrome.showsAnalysis(completed = true, tab = AnalysisTab.CLUES))
        assertFalse(
            AnalysisChrome.showsAnalysis(completed = false, tab = AnalysisTab.ANALYSIS),
            "a live room never reaches the analysis surface, whatever tab state is remembered",
        )
        assertFalse(AnalysisChrome.showsAnalysis(completed = false, tab = AnalysisTab.CLUES))
    }
}
