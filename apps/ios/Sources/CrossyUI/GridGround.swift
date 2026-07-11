// Ground selection for the board: Studio and Observatory are two renders of one
// drawing, driven by CrossyDesign tokens, never two code paths (apps/ios/DESIGN.md
// §5, ID-6). This type carries the token set plus the one bit the tokens do not:
// which side of the identity-color pairs this ground reads (roster colors are paired
// per ground, ID-8).

import CrossyDesign

public enum GridGround: String, CaseIterable, Sendable, Equatable {
    case studio
    case observatory

    /// The paper tokens for this ground (CrossyDesign Grounds).
    public var tokens: GroundTokens {
        switch self {
        case .studio: return Ground.studio
        case .observatory: return Ground.observatory
        }
    }

    public var isDark: Bool { self == .observatory }

    /// The roster pair side for this ground (apps/ios/DESIGN.md §3: twelve colors,
    /// paired per ground).
    public func rosterColor(_ identity: IdentityColor) -> RGBColor {
        isDark ? identity.darkGround : identity.lightGround
    }

    /// Grid glyph weight, CSS-axis numeric from TypeScale (600 on Studio, 500 on
    /// Observatory: dark grounds fatten type, apps/ios/DESIGN.md §6). Mapped to
    /// `Font.Weight` at the draw site.
    public var glyphWeight: Int {
        isDark ? TypeScale.gridGlyphWeightDarkGround : TypeScale.gridGlyphWeightLightGround
    }
}
