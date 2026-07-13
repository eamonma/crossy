// Mirrors apps/ios/Sources/CrossyDesign/RGBColor.swift. CrossyDesign carries colors as
// data (apps/ios/ARCHITECTURE.md §2): 8-bit sRGB components plus packed forms, no Compose,
// no android.graphics. Compose `Color` construction belongs to :ui; the same values feed
// any future widget surface.
package crossy.design

/// An opaque sRGB color value. Components are 8-bit, matching the `#RRGGBB` notation
/// every token table in apps/ios/DESIGN.md uses.
data class RGBColor(val red: Int, val green: Int, val blue: Int) {

    /// From a 24-bit `0xRRGGBB` literal, the form the token tables are written in.
    /// Bits above the low 24 are ignored.
    constructor(rgb24: Int) : this(
        red = (rgb24 shr 16) and 0xFF,
        green = (rgb24 shr 8) and 0xFF,
        blue = rgb24 and 0xFF,
    )

    /// The packed 24-bit value, `0xRRGGBB`.
    val rgb24: Int
        get() = (red shl 16) or (green shl 8) or blue

    /// The packed 32-bit opaque `0xAARRGGBB`, the ARGB int :ui feeds to Compose
    /// `Color(argb)`. Alpha is fixed at 0xFF; tokens are opaque paper.
    val argb: Int
        get() = (0xFF shl 24) or rgb24

    /// Uppercase `#RRGGBB`, the notation used across DESIGN.md and the wire
    /// (PROTOCOL.md participant `color`). ASCII by construction (INV-1).
    val hexString: String
        get() = "#" + rgb24.toString(16).uppercase().padStart(6, '0')

    /// Unit-interval components for later Compose `Color(red, green, blue)` construction
    /// in :ui. Kept here so the conversion is defined once.
    val unitRed: Double get() = red / 255.0
    val unitGreen: Double get() = green / 255.0
    val unitBlue: Double get() = blue / 255.0
}
