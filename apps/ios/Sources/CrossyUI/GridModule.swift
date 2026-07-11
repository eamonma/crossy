// The 36-unit cell module (root DESIGN.md §10, Wave 2.1d): clue number top-left
// (+2,+10), teammate presence anchored bottom-right, direction arrow top-right
// (+27,+3, a 7-unit glyph), avatar circle bottom-right (center +30,+30, radius 5,
// 8 px initial), count badge in the same bottom-right slot (center +29,+29, radius 7,
// 9 px count). Those constants are the cross-client module contract; everything here
// is in module units, scaled to points by the camera (GridCamera). Positions written
// as baselines in the spec are converted for Canvas anchor drawing by capCenterY.

import CoreGraphics

public enum GridModule {
    /// The cell module edge, in module units (root DESIGN.md §10: "a 36-unit cell
    /// module scaled to fit").
    public static let unit: CGFloat = 36

    // MARK: Clue number, top-left (Wave 2.1d: +2,+10 baseline, 10-unit type)

    public static let numberLeading: CGFloat = 2
    public static let numberBaseline: CGFloat = 10
    public static let numberFontSize: CGFloat = 10

    // MARK: Entry glyph, centered (web baseline parity: 24-unit type, baseline +32)

    public static let glyphFontSize: CGFloat = 24
    public static let glyphCenterX: CGFloat = unit / 2
    public static let glyphBaseline: CGFloat = 32
    /// The glyph steps 3 units left of center when a presence mark shares the cell,
    /// clearing the bottom-right stack (the web renderer's letterX rule).
    public static let glyphPresenceShift: CGFloat = -3

    // MARK: Circles (root DESIGN.md §10: inset rings)

    public static let circleRadius: CGFloat = unit / 2.1
    public static let circleStroke: CGFloat = 0.8
    /// Shaded circles are a render variant of circles (CrossyProtocol ClientPuzzle):
    /// a soft achromatic wash instead of a ring, alpha over the cell fill.
    public static let shadeAlpha: Double = 0.18

    // MARK: Presence, bottom-right stack (Wave 2.1d)

    public static let arrowOrigin = CGPoint(x: 27, y: 3)
    public static let arrowSize: CGFloat = 7
    public static let avatarCenter = CGPoint(x: 30, y: 30)
    public static let avatarRadius: CGFloat = 5
    public static let avatarInitialFontSize: CGFloat = 8
    public static let badgeCenter = CGPoint(x: 29, y: 29)
    public static let badgeRadius: CGFloat = 7
    public static let badgeCountFontSize: CGFloat = 9

    // MARK: Lines

    /// Cell hairline (web parity: 0.6 stroke) and the closing outer frame (2 units).
    public static let hairline: CGFloat = 0.6
    public static let frameStroke: CGFloat = 2

    // MARK: Cell geometry

    public static func cellOrigin(_ cell: Int, cols: Int) -> CGPoint {
        CGPoint(x: CGFloat(cell % cols) * unit, y: CGFloat(cell / cols) * unit)
    }

    public static func cellRect(_ cell: Int, cols: Int) -> CGRect {
        let origin = cellOrigin(cell, cols: cols)
        return CGRect(x: origin.x, y: origin.y, width: unit, height: unit)
    }

    // MARK: Text placement

    /// The vertical center of a capital glyph drawn on `baseline`. The spec writes
    /// text positions as SVG baselines; Canvas draws anchored text, so the cap-height
    /// midpoint (SF Pro cap height is ~0.72 em) converts one to the other.
    public static func capCenterY(baseline: CGFloat, fontSize: CGFloat) -> CGFloat {
        baseline - fontSize * 0.36
    }

    // MARK: Rebus scaling

    /// The ink width a rebus string may fill, and the SF Pro caps average advance
    /// (~0.62 em) used to fit it. Below `rebusMinimumFontSize` a string stops
    /// shrinking and simply runs tight; a 10-glyph rebus is the charset cap
    /// (PROTOCOL.md §3) and is unreadable at any size in a 36-unit module.
    public static let rebusInkWidth: CGFloat = 32
    public static let rebusCapAdvance: CGFloat = 0.62
    public static let rebusMinimumFontSize: CGFloat = 5

    /// Entry glyph size for a value of `length` characters: 24 units for a single
    /// glyph, longer (rebus) strings scaled to fit the ink width, floored.
    public static func glyphSize(forLength length: Int) -> CGFloat {
        guard length > 1 else { return glyphFontSize }
        let fitted = rebusInkWidth / (rebusCapAdvance * CGFloat(length))
        return min(glyphFontSize, max(rebusMinimumFontSize, fitted))
    }
}
