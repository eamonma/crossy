// Pins the render half of TypeScale.numericChromeRequiresTabularNumerals: the helper turns the flag
// into the OpenType `tnum` feature, so numeric chrome (the OTP field, countdowns, later clocks) never
// jitters in width (apps/ios/DESIGN.md §6).

package crossy.ui

import androidx.compose.ui.text.TextStyle
import crossy.design.TypeScale
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TabularNumeralsTests {

    @Test
    fun `INV-DESIGN6 withTabularNumerals enables the tnum feature`() {
        val styled = TextStyle().withTabularNumerals()
        assertEquals("tnum", styled.fontFeatureSettings)
    }

    @Test
    fun `INV-DESIGN6 the helper preserves the base style it is applied over`() {
        val base = TextStyle(fontFeatureSettings = null)
        val styled = base.copy(letterSpacing = base.letterSpacing).withTabularNumerals()
        // Only the feature string changes; the rest of the style rides through the copy.
        assertEquals(base.copy(fontFeatureSettings = "tnum"), styled)
    }

    @Test
    fun `INV-DESIGN6 the design flag that demands tabular numerals is set`() {
        // The requirement this helper satisfies is the one :design names greppably.
        assertTrue(TypeScale.numericChromeRequiresTabularNumerals)
    }
}
