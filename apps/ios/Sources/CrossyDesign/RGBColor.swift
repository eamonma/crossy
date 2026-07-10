// CrossyDesign carries colors as data (apps/ios/ARCHITECTURE.md §2): 8-bit sRGB
// components plus hex forms, no SwiftUI, no UIKit. `Color` construction belongs to
// CrossyUI; the widget extension reads the same values.

/// An opaque sRGB color value. Components are 8-bit, matching the `#RRGGBB` notation
/// every token table in apps/ios/DESIGN.md uses.
public struct RGBColor: Hashable, Sendable {
    public let red: UInt8
    public let green: UInt8
    public let blue: UInt8

    public init(red: UInt8, green: UInt8, blue: UInt8) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    /// From a 24-bit `0xRRGGBB` literal, the form the token tables are written in.
    /// Bits above the low 24 are ignored.
    public init(_ rgb24: UInt32) {
        self.init(
            red: UInt8((rgb24 >> 16) & 0xFF),
            green: UInt8((rgb24 >> 8) & 0xFF),
            blue: UInt8(rgb24 & 0xFF)
        )
    }

    /// The packed 24-bit value, `0xRRGGBB`.
    public var rgb24: UInt32 {
        UInt32(red) << 16 | UInt32(green) << 8 | UInt32(blue)
    }

    /// Uppercase `#RRGGBB`, the notation used across DESIGN.md and the wire
    /// (PROTOCOL.md participant `color`). ASCII by construction (INV-1).
    public var hexString: String {
        let digits = String(rgb24, radix: 16, uppercase: true)
        return "#" + String(repeating: "0", count: 6 - digits.count) + digits
    }

    /// Unit-interval components for later `Color(red:green:blue:)` construction in
    /// CrossyUI. Kept here so the conversion is defined once.
    public var unitRed: Double { Double(red) / 255 }
    public var unitGreen: Double { Double(green) / 255 }
    public var unitBlue: Double { Double(blue) / 255 }
}
