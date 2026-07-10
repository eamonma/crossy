// The twelve-color identity roster (apps/ios/DESIGN.md §3, ID-8): the only color in
// the system. Each color is a light-ground/dark-ground pair, tuned to hold on bone
// and on void, distinct at 12 px in the corner of a cell. Values are a starting set
// pending the on-device contrast pass; the structure (12, paired per ground,
// hash-indexed) does not move.
//
// Ratification status: the hash (IdentityHash.fnv1a32) is the ratified cross-client
// contract (root DESIGN.md §8; canonical code apps/session/src/color.ts). The roster
// and the mod-12 slot mapping below are PROPOSED by apps/ios/DESIGN.md §3 and await
// ratification with the web workstream: today the server derives the wire color
// directly as `hash & 0xffffff` formatted `#RRGGBB` (colorForUser in color.ts) and
// clients render that string; no palette exists on the web side yet. Once ratified,
// the roster moves to shared ground and both clients index it the same way.

/// One roster entry: a name and its ground pair.
public struct IdentityColor: Hashable, Sendable {
    public let name: String
    public let lightGround: RGBColor
    public let darkGround: RGBColor

    public init(name: String, lightGround: RGBColor, darkGround: RGBColor) {
        self.name = name
        self.lightGround = lightGround
        self.darkGround = darkGround
    }
}

public enum IdentityRoster {
    public static let violet = IdentityColor(name: "violet", lightGround: RGBColor(0x6F66D4), darkGround: RGBColor(0x9D95FF))
    public static let poppy = IdentityColor(name: "poppy", lightGround: RGBColor(0xDE5722), darkGround: RGBColor(0xFF7A50))
    public static let teal = IdentityColor(name: "teal", lightGround: RGBColor(0x17917F), darkGround: RGBColor(0x3BC7B4))
    public static let magenta = IdentityColor(name: "magenta", lightGround: RGBColor(0xC2497D), darkGround: RGBColor(0xE06B9E))
    public static let ochre = IdentityColor(name: "ochre", lightGround: RGBColor(0xC98A1B), darkGround: RGBColor(0xE0A93E))
    public static let cobalt = IdentityColor(name: "cobalt", lightGround: RGBColor(0x3D6BD6), darkGround: RGBColor(0x6E93E8))
    public static let moss = IdentityColor(name: "moss", lightGround: RGBColor(0x6B8F3C), darkGround: RGBColor(0x90B45E))
    public static let rust = IdentityColor(name: "rust", lightGround: RGBColor(0xB0503C), darkGround: RGBColor(0xD97862))
    public static let plum = IdentityColor(name: "plum", lightGround: RGBColor(0x8A4E9E), darkGround: RGBColor(0xB278C6))
    public static let cyan = IdentityColor(name: "cyan", lightGround: RGBColor(0x2596A8), darkGround: RGBColor(0x4FBCCE))
    public static let coral = IdentityColor(name: "coral", lightGround: RGBColor(0xE06A5A), darkGround: RGBColor(0xF4917F))
    public static let slate = IdentityColor(name: "slate", lightGround: RGBColor(0x5E6B8C), darkGround: RGBColor(0x8C99BA))

    /// The roster in slot order, exactly the apps/ios/DESIGN.md §3 table order.
    /// Slot order is part of the (proposed) cross-client contract: reordering
    /// reassigns everyone's color.
    public static let colors: [IdentityColor] = [
        violet, poppy, teal, magenta, ochre, cobalt,
        moss, rust, plum, cyan, coral, slate,
    ]

    /// Roster slot for a user: `fnv1a32(user_id) mod 12`. Deterministic and
    /// device-independent, so the same user resolves to the same slot everywhere
    /// (root DESIGN.md §8). PROPOSED mapping, pending ratification (header note).
    public static func slot(for userId: String) -> Int {
        Int(IdentityHash.fnv1a32(userId) % UInt32(colors.count))
    }

    /// The roster color for a user, via `slot(for:)`.
    public static func color(for userId: String) -> IdentityColor {
        colors[slot(for: userId)]
    }
}
