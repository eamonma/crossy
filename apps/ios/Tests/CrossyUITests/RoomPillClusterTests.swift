import CoreGraphics
import CrossyStore
import XCTest

@testable import CrossyUI

// The room bar's pill cluster (apps/ios/DESIGN.md §4, owner ruling 2026-07-10:
// a cluster of glass pills, not one bar). Since the toolbar-adoption ruling
// (2026-07-11, SP-i6, Route 1) the cluster IS the system nav bar's item set on
// the Rooms→room seam, so the hand-drawn container's blend spacing retired (the
// system owns item spacing, a ToolbarSpacer splits the pill from the Menus).
// What remains pure and pinned is the register the fallback labels still keep,
// the facts card's morph rest, and the eclipse geometry.

final class RoomPillClusterTests: XCTestCase {
    // The compact-toolbar register: pills stand smaller than a standing bar,
    // and their corner radius is the capsule's, half the height, so the pill
    // shares the capsule geometry the island condenses into (DESIGN.md §8).
    // Still the register the below-26 Menu labels render in (the §4 fallback);
    // on 26 the system bar shapes its own items.
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

// The time pill's presence in the bar (DESIGN.md §4 toolbar amendment): the pill
// ARRIVES when the room is live, so the open frame's trailing cluster is share +
// players only (both width-stable) and the pill's arrival is an honest bar-item
// insertion, not the slot settling after the #132 zoom push. Pure on the store's
// sync state (the honest existing fact, GameStore's SyncState), the
// RoomWeather.from(sync:) discipline.

final class TimePillPresenceTests: XCTestCase {
    // Before the first welcome the store is `connecting` (no board truth yet):
    // the pill is absent, so the open cluster is share + players only and no slot
    // resolves its width after the zoom push.
    func test_beforeTheWelcome_theTimePillIsAbsent_section4() {
        XCTAssertFalse(TimePillPresence.isLive(sync: .connecting))
    }

    // The welcome flips sync off `connecting` and the pill materializes into the
    // bar as its own insertion. Every post-welcome state has a board, so the pill
    // stands through live, resyncing, and a reconnect alike (a terminal room's
    // sealed pill arrives the same way, on its welcome's beat).
    func test_onceLive_theTimePillArrives_section4() {
        XCTAssertTrue(TimePillPresence.isLive(sync: .live))
        XCTAssertTrue(TimePillPresence.isLive(sync: .resyncing))
        XCTAssertTrue(TimePillPresence.isLive(sync: .reconnecting))
    }
}

// A bar item's system glass capsule is never conjured empty (DESIGN.md §4). The
// nav bar draws the capsule from the item's PRESENCE, not its content (the
// empty-capsule finding, rig 2026-07-12), so a handed-off item whose content
// sits at opacity 0 would stand a hollow capsule. BarItemGlass hides the item's
// shared background exactly while it is handed off, so the pill yields with no
// floating empty glass and the item stays present for its frame to keep reporting.

final class BarItemGlassTests: XCTestCase {
    // Standing (not handed off): the capsule shows, the pill is whole.
    func test_standingPill_keepsItsCapsule_section4() {
        XCTAssertFalse(BarItemGlass.backgroundHidden(handedOff: false))
    }

    // Handed off (the facts card open, or an eclipse): the content is invisible,
    // so the capsule's shared background hides and no empty glass floats where
    // the pill stood (glass is never conjured empty, DESIGN.md §4).
    func test_handedOffPill_hidesItsCapsule_section4() {
        XCTAssertTrue(BarItemGlass.backgroundHidden(handedOff: true))
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
