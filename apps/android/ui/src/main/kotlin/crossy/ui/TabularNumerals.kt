// Tabular numerals for numeric chrome. Timers, invite codes, and seq-like values must not jitter in
// width as their digits change (apps/ios/DESIGN.md §6; :design names the requirement in the greppable
// flag TypeScale.numericChromeRequiresTabularNumerals). This is the render half of that flag: a small
// TextStyle helper that turns on the OpenType `tnum` feature, so every figure takes the same advance.
// Kept next to the theme so the clocks and timers a later track builds reuse it rather than re-deriving
// the feature string.

package crossy.ui

import androidx.compose.ui.text.TextStyle

/** The OpenType tabular-figures feature tag. One place, so a call site can never mistype it. */
const val TABULAR_NUMERALS_FEATURE = "tnum"

/**
 * Return this style with tabular figures enabled, satisfying
 * [crossy.design.TypeScale.numericChromeRequiresTabularNumerals]. Applied wherever a value's digits
 * vary in place (the OTP field, a countdown, later a clock), so the text never shifts as figures
 * change. A plain `copy` so it composes over any base style the caller already carries.
 */
fun TextStyle.withTabularNumerals(): TextStyle = copy(fontFeatureSettings = TABULAR_NUMERALS_FEATURE)
