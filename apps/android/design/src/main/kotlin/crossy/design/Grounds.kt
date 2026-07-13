// Mirrors apps/ios/Sources/CrossyDesign/Grounds.swift. The two grounds (apps/ios/DESIGN.md
// §5, ID-6): one identity with a light ground and a dark ground, not two directions. Studio
// is the chassis, Observatory is the night. Paper tokens only; glass materials and their
// fallbacks are render decisions in :ui.
package crossy.design

/// The paper token set for one ground: everything the board is drawn with.
data class GroundTokens(
    val canvas: RGBColor,
    val cell: RGBColor,
    val ink: RGBColor,
    val block: RGBColor,
    val gridLine: RGBColor,
    val number: RGBColor,
)

object Ground {
    /// Studio (light): bone paper, ink glyphs, chrome that barely exists
    /// (apps/ios/DESIGN.md §5 table).
    val studio = GroundTokens(
        canvas = RGBColor(0xF2F1EC),
        cell = RGBColor(0xFFFFFF),
        ink = RGBColor(0x1D1B18),
        block = RGBColor(0x1B1A17),
        gridLine = RGBColor(0xD9D6CD),
        number = RGBColor(0x8B877D),
    )

    /// Observatory (dark): the grid as an illuminated instrument panel, blocks recessed
    /// darker than the canvas, letters as bone light (apps/ios/DESIGN.md §5 table).
    val observatory = GroundTokens(
        canvas = RGBColor(0x121118),
        cell = RGBColor(0x201F27),
        ink = RGBColor(0xEDEAE2),
        block = RGBColor(0x0A0910),
        gridLine = RGBColor(0x2C2B34),
        number = RGBColor(0x77747F),
    )
}
