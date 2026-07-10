import XCTest

@testable import CrossyDesign

// Pins the roster structure and values against the apps/ios/DESIGN.md §3 table
// (ID-8: twelve paired colors, hash-indexed; values tune on device, structure is
// fixed). Order is part of the proposed cross-client contract: reordering
// reassigns every user's color.

final class IdentityRosterTests: XCTestCase {
    /// The DESIGN.md §3 table, verbatim: name, light ground, dark ground.
    private static let table: [(name: String, light: UInt32, dark: UInt32)] = [
        ("violet", 0x6F66D4, 0x9D95FF),
        ("poppy", 0xDE5722, 0xFF7A50),
        ("teal", 0x17917F, 0x3BC7B4),
        ("magenta", 0xC2497D, 0xE06B9E),
        ("ochre", 0xC98A1B, 0xE0A93E),
        ("cobalt", 0x3D6BD6, 0x6E93E8),
        ("moss", 0x6B8F3C, 0x90B45E),
        ("rust", 0xB0503C, 0xD97862),
        ("plum", 0x8A4E9E, 0xB278C6),
        ("cyan", 0x2596A8, 0x4FBCCE),
        ("coral", 0xE06A5A, 0xF4917F),
        ("slate", 0x5E6B8C, 0x8C99BA),
    ]

    // ID-8: the structure is fixed at twelve.
    func test_rosterHasTwelveColors_ID8() {
        XCTAssertEqual(IdentityRoster.colors.count, 12)
    }

    // Every entry matches the DESIGN.md §3 table exactly, in table order.
    func test_rosterMatchesDesignTable_namesOrderAndValues_ID8() {
        XCTAssertEqual(IdentityRoster.colors.count, Self.table.count)
        for (index, expected) in Self.table.enumerated() {
            let color = IdentityRoster.colors[index]
            XCTAssertEqual(color.name, expected.name, "slot \(index) name")
            XCTAssertEqual(color.lightGround.rgb24, expected.light, "\(expected.name) light ground")
            XCTAssertEqual(color.darkGround.rgb24, expected.dark, "\(expected.name) dark ground")
        }
    }

    // Paired per ground: every entry carries a distinct light and dark value, and
    // no two entries collide on either ground (distinctness is what makes the
    // roster legible at 12 px).
    func test_rosterPairsAreDistinctPerGround_ID8() {
        for color in IdentityRoster.colors {
            XCTAssertNotEqual(color.lightGround, color.darkGround, "\(color.name) pair collapsed")
        }
        XCTAssertEqual(Set(IdentityRoster.colors.map(\.lightGround)).count, 12)
        XCTAssertEqual(Set(IdentityRoster.colors.map(\.darkGround)).count, 12)
        XCTAssertEqual(Set(IdentityRoster.colors.map(\.name)).count, 12)
    }

    // Every hash lands in a valid slot (root DESIGN.md §8: total function of
    // user_id, no fallback color path).
    func test_slotIsAlwaysInRange_rootDESIGN8() {
        for userId in ["", "a", "9f46807f-c1c5-4b8d-8302-2e1dfb51e30f", String(repeating: "z", count: 64)] {
            let slot = IdentityRoster.slot(for: userId)
            XCTAssertTrue((0..<12).contains(slot), "slot \(slot) out of range for \(userId)")
        }
    }

    // Hex round-trip sanity for the value type the roster is built from.
    func test_rgbColorHexFormatting() {
        XCTAssertEqual(RGBColor(0x6F66D4).hexString, "#6F66D4")
        XCTAssertEqual(RGBColor(0x000000).hexString, "#000000")
        XCTAssertEqual(RGBColor(0x00000F).hexString, "#00000F")
        XCTAssertEqual(RGBColor(0xFFFFFF).hexString, "#FFFFFF")
        XCTAssertEqual(RGBColor(red: 0x9D, green: 0x95, blue: 0xFF).rgb24, 0x9D95FF)
    }
}
