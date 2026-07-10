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

    /// The grid glyph legibility floor, in points: "never below legibility at the
    /// 25x25 zoom floor" (apps/ios/DESIGN.md §6). Grid glyphs are single uppercase
    /// A-Z0-9 at weight 600/500, caps-only forms with no x-height to lose; on the 3x
    /// displays of supported iPhones, 10 pt is 30 physical pixels, the size below
    /// which the counters of 0, 8, and B close up and the board blurs into noise.
    /// The glyph is 24/36 of the cell module, so this floor puts the cell edge at
    /// 15 pt and the 25x25 ingestion cap at 375 pt, still whole on the narrowest
    /// supported iPhone width. CrossyUI derives the zoom-out clamp from this value.
    public static let gridGlyphLegibilityFloorPoints: Double = 10
}
