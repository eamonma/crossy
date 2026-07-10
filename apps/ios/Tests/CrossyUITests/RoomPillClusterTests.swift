import CoreGraphics
import XCTest

@testable import CrossyUI

// The room bar's pill cluster (apps/ios/DESIGN.md §4, owner ruling 2026-07-10:
// a cluster of glass pills, not one bar). The geometry a view positions by is
// pure math pinned here: the pills' capsule register, and the one number that
// keeps them three separate objects on iOS 26+, the GlassEffectContainer
// spacing held below the metaball fuse (SP-i1, DESIGN.md §10).

final class RoomPillClusterTests: XCTestCase {
    // SP-i1's caution (DESIGN.md §10): container spacing metaball-fuses
    // adjacent glass; 24 melted the deck's keys at 6 pt gaps, and the deck's 6
    // is the hardware-proven discrete value. The cluster's blend must never
    // exceed that proof, and must stay below the cluster's own gap so pills
    // sit farther apart than the blend can reach.
    func test_clusterBlend_staysBelowTheMetaballFuse_SPi1() {
        XCTAssertLessThanOrEqual(ChromeLayout.pillClusterBlend, DeckLayout.keySpacing)
        XCTAssertLessThan(ChromeLayout.pillClusterBlend, ChromeLayout.pillGap)
    }

    // The compact-toolbar register: pills stand smaller than a standing bar,
    // and their corner radius is the capsule's, half the height, so the pill
    // shares the capsule geometry the island condenses into (DESIGN.md §8).
    func test_pillIsACapsuleInTheSmallStandingRegister_section4() {
        XCTAssertEqual(ChromeLayout.pillCornerRadius, ChromeLayout.pillHeight / 2)
        XCTAssertLessThan(ChromeLayout.pillHeight, ChromeLayout.barHeight)
    }

    // The players pill is the roster morph's rest and the time pill the stats
    // morph's rest (DESIGN.md §4 morph targets): a capsule pill at rest must
    // hand the panel its own radius, so the interpolation starts from the
    // capsule, not from a conjured shape.
    func test_pillRestRadius_isTheMorphsRestRadius_section4() {
        let pill = CGRect(x: 300, y: 10, width: 84, height: ChromeLayout.pillHeight)
        let morph = GlassMorph(
            rest: pill,
            open: CGRect(x: 73, y: 62, width: 320, height: 196),
            restCornerRadius: pill.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
        XCTAssertEqual(morph.cornerRadius(at: 0), ChromeLayout.pillCornerRadius)
        XCTAssertEqual(morph.frame(at: 0), pill)
        XCTAssertEqual(morph.cornerRadius(at: 1), ChromeLayout.panelCornerRadius)
    }
}
