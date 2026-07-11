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

    // The time pill is the facts morph's rest (DESIGN.md §4 morph targets; the
    // roster rides a system Menu instead): a capsule pill at rest must hand
    // the panel its own radius, so the interpolation starts from the capsule,
    // not from a conjured shape.
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

    // A panel covers its own pill by right; any OTHER standing glass it
    // eclipses yields for the panel's life (buried glass refracts through the
    // surface — the -stress mockups caught the then-leading pill's name
    // mirrored inside the card). A hairline graze is not an eclipse.
    func test_aPanelEclipsingAStandingPill_handsItOff_section4() {
        let panel = CGRect(x: 40, y: 10, width: 340, height: 120)
        let buried = CGRect(x: 24, y: 10, width: 160, height: 44)
        let abutting = CGRect(x: 378, y: 10, width: 84, height: 44)
        let clear = CGRect(x: 400, y: 10, width: 84, height: 44)
        XCTAssertTrue(PanelEclipse.eclipses(panel: panel, pill: buried))
        XCTAssertFalse(PanelEclipse.eclipses(panel: panel, pill: abutting))
        XCTAssertFalse(PanelEclipse.eclipses(panel: panel, pill: clear))
    }

    // The facts card grows leftward from the time pill and can reach the BACK
    // BUTTON on narrow layouts (owner ruling 2026-07-10): the button hands off
    // exactly as the retired leading pill did, and a card clamped short of it
    // leaves it standing.
    func test_theFactsCardReachingTheBackButton_handsItOff_section4() {
        let backButton = CGRect(
            x: 12, y: 10, width: ChromeLayout.pillHeight, height: ChromeLayout.pillHeight)
        let reachingCard = CGRect(x: 12, y: 10, width: 340, height: 112)
        let clampedCard = CGRect(x: 80, y: 10, width: 280, height: 112)
        XCTAssertTrue(PanelEclipse.eclipses(panel: reachingCard, pill: backButton))
        XCTAssertFalse(PanelEclipse.eclipses(panel: clampedCard, pill: backButton))
    }
}

// The time pill's register (redesign 2026-07-11): the room's vital signs
// while it runs, its record at a terminal status. The mapping is pure so the
// pill renders no policy, and the spoken line follows the register (ID-2: the
// clock freezes at the terminal instant either way; DESIGN.md §8: the weather
// stands down when the room ends).

final class TimePillRegisterTests: XCTestCase {
    func test_ongoingCarriesTheWeather_section8() {
        XCTAssertEqual(TimePillRegister.from(status: .ongoing), .vital)
    }

    // Completion seals the pill: the check beside the frozen clock is the
    // record of the solve, and the tap still summons the stats card (ID-2).
    func test_completionSealsThePill_ID2() {
        XCTAssertEqual(TimePillRegister.from(status: .completed), .sealed)
    }

    // An abandoned room is terminal and quiet (EXPERIENCE.md): no seal, no
    // weather, the frozen clock alone.
    func test_abandonmentLeavesTheQuietClock_ID2() {
        XCTAssertEqual(TimePillRegister.from(status: .abandoned), .quiet)
    }

    // The spoken line follows the register; the weather's words render only
    // while the weather does (ID-5: plain words, controls that say what
    // happens).
    func test_spokenLabels_followTheRegister_ID5() {
        XCTAssertEqual(
            TimePillRegister.vital.accessibilityLabel(weather: "Connected"),
            "Shared time, Connected, show room facts")
        XCTAssertEqual(
            TimePillRegister.sealed.accessibilityLabel(weather: "Connected"),
            "Solved together, show stats")
        XCTAssertEqual(
            TimePillRegister.quiet.accessibilityLabel(weather: "Connected"),
            "Final time, show room facts")
    }
}
