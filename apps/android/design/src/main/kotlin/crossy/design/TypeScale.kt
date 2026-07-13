// Mirrors apps/ios/Sources/CrossyDesign/TypeScale.swift. Type (apps/ios/DESIGN.md §6): SF
// Pro on iOS, its Android counterpart on this side; the display face appears nowhere. These
// are the data half of the type system; font construction and feature settings are render
// decisions in :ui. iOS point sizes are density-independent, so they carry over as sp
// scalars (Compose text units).
package crossy.design

object TypeScale {
    /// Grid glyph weight on the light ground (Studio): 600, CSS-axis numeric (:ui maps it
    /// to `FontWeight(600)`).
    const val gridGlyphWeightLightGround: Int = 600

    /// Grid glyph weight on the dark ground (Observatory): 500, one step lighter because
    /// dark grounds fatten type (:ui maps it to `FontWeight(500)`).
    const val gridGlyphWeightDarkGround: Int = 500

    /// Timers, invite codes, and seq-like values require tabular numerals so the shared
    /// clock never jitters in width (apps/ios/DESIGN.md §6). A plain value cannot carry a
    /// font feature; this flag names the requirement so it is greppable, and :ui satisfies
    /// it with a monospaced face or tabular figures.
    const val numericChromeRequiresTabularNumerals: Boolean = true

    /// The grid glyph legibility floor, in sp: "never below legibility at the 25x25 zoom
    /// floor" (apps/ios/DESIGN.md §6). Grid glyphs are single uppercase A-Z0-9 at weight
    /// 600/500, caps-only forms with no x-height to lose; below roughly 10 sp the counters
    /// of 0, 8, and B close up and the board blurs into noise. The glyph is 24/36 of the
    /// cell module, so this floor puts the cell edge at 15 sp. :ui derives the zoom-out
    /// clamp from this value. iOS pins the same number in points.
    const val gridGlyphLegibilityFloorSp: Double = 10.0
}
