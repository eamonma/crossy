// Type (apps/ios/DESIGN.md §6): SF Pro everywhere; New York appears nowhere. These
// are the data half of the type system; font construction and feature settings are
// render decisions in CrossyUI.

public enum TypeScale {
    /// Grid glyph weight on the light ground (Studio): 600, CSS-axis numeric
    /// (CrossyUI maps it to `Font.Weight.semibold`).
    public static let gridGlyphWeightLightGround = 600

    /// Grid glyph weight on the dark ground (Observatory): 500, one step lighter
    /// because dark grounds fatten type (CrossyUI maps it to `Font.Weight.medium`).
    public static let gridGlyphWeightDarkGround = 500

    /// Timers, invite codes, and seq-like values require tabular numerals so the
    /// shared clock never jitters in width (apps/ios/DESIGN.md §6). Foundation
    /// cannot carry a font feature; this constant names the requirement so it is
    /// greppable, and CrossyUI satisfies it with SF Mono or SF Pro tabular figures.
    public static let numericChromeRequiresTabularNumerals = true
}
