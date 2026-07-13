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

// The trailing pieces' presence in the bar (DESIGN.md §4 toolbar amendment, §12,
// the seeded-birth rule). Two arrival shapes, chosen by whether the room was born
// with a seed: a card-tap arrival records the row's true member stack, so the
// players and share pills STAND from the push's first frame and the goo plays on
// live data; a deep link or a code-join has no card, so it keeps the one-beat
// fallback (the whole trailing cluster on the welcome's beat). The timer is
// welcome-gated on BOTH paths (its clock needs the welcome). Every decision is pure
// on the store's honest sync state (the RoomWeather.from(sync:) discipline) and the
// seeded fact; share keeps its own payload gate on top (tested at the bar).

final class ClusterPresenceTests: XCTestCase {
    // Before the first welcome the store is `connecting` (no board truth yet):
    // `isLive` is false, so the timer and the unseeded whole cluster are absent.
    func test_beforeTheWelcome_isLiveIsFalse_section4() {
        XCTAssertFalse(ClusterPresence.isLive(sync: .connecting))
    }

    // The welcome flips sync off `connecting`. Every post-welcome state has a board,
    // so `isLive` holds through live, resyncing, and a reconnect alike (a terminal
    // room's sealed cluster arrives the same way, on its welcome's beat).
    func test_onceLive_isLiveIsTrue_section4() {
        XCTAssertTrue(ClusterPresence.isLive(sync: .live))
        XCTAssertTrue(ClusterPresence.isLive(sync: .resyncing))
        XCTAssertTrue(ClusterPresence.isLive(sync: .reconnecting))
    }

    // The TIMER waits for the welcome on both paths: its clock genuinely needs the
    // welcome, so a seed cannot stand it early. showsTimer is exactly isLive.
    func test_theTimerIsWelcomeGated_onBothPaths_section4() {
        XCTAssertFalse(ClusterPresence.showsTimer(sync: .connecting))
        XCTAssertTrue(ClusterPresence.showsTimer(sync: .live))
    }

    // The UNSEEDED path (deep links, code-joins): players and share wait for the
    // welcome too, so pre-welcome the withholding bar is back-only (the one-beat
    // fallback, no card to seed from).
    func test_unseeded_playersAndShareWaitForTheWelcome_section4() {
        XCTAssertFalse(ClusterPresence.showsPlayers(sync: .connecting, seeded: false))
        XCTAssertFalse(ClusterPresence.showsShare(sync: .connecting, seeded: false))
        XCTAssertTrue(ClusterPresence.showsPlayers(sync: .live, seeded: false))
        XCTAssertTrue(ClusterPresence.showsShare(sync: .live, seeded: false))
    }

    // The SEEDED path (a card-tap arrival, §12): players and share STAND pre-welcome,
    // from the push's first frame, so the room is born identity-true and the goo plays
    // on live data. The timer still waits (above), so only the two pills stand early.
    func test_seeded_playersAndShareStandPreWelcome_section4() {
        XCTAssertTrue(ClusterPresence.showsPlayers(sync: .connecting, seeded: true))
        XCTAssertTrue(ClusterPresence.showsShare(sync: .connecting, seeded: true))
        // The timer is not seeded early: it needs the welcome even here.
        XCTAssertFalse(ClusterPresence.showsTimer(sync: .connecting))
    }

    // Once live, a seeded room's pills stand exactly as an unseeded room's do: the
    // seed only advanced their arrival to pre-welcome, it never changes the live
    // state, so the withheld→ready→live progression is monotone (nothing re-inserts).
    func test_seeded_convergesWithLive_section4() {
        XCTAssertTrue(ClusterPresence.showsPlayers(sync: .live, seeded: true))
        XCTAssertTrue(ClusterPresence.showsShare(sync: .live, seeded: true))
        XCTAssertTrue(ClusterPresence.showsTimer(sync: .live))
    }
}

// The solvers-only pill filter applies to a SEEDED roster identically to a live one
// (DESIGN.md §4, owner ruling 2026-07-10; §12). A card-tap arrival seeds the store
// with the row's full member stack, roles included, and the players pill renders
// through the SAME RosterList.cluster path the live pill uses, so a seeded spectator
// seeds the store but never widens the pill. Pinned here on RosterMember (the shape
// both the seeded withholding bar and the live bar feed RosterMenu), so the parity is
// one filter, not two.

final class SeededRosterFilterTests: XCTestCase {
    // A seeded roster: everyone not-yet-heard-from (`connected: false`, the seed's
    // liveness), a host, a solver, and a guest-spectator. The cluster shows the host
    // and the solver, never the spectator, exactly as it would for a live roster.
    func test_seededSpectatorNeverWidensThePill_section4() {
        let seeded = [
            RosterMember(
                userId: "host", displayName: "Ana", wireColor: "",
                avatarUrl: nil, isHost: true, isSpectator: false, connected: false),
            RosterMember(
                userId: "solver", displayName: "Bee", wireColor: "",
                avatarUrl: nil, isHost: false, isSpectator: false, connected: false),
            RosterMember(
                userId: "guest", displayName: "Guest", wireColor: "",
                avatarUrl: nil, isHost: false, isSpectator: true, connected: false),
        ]
        let cluster = RosterList.cluster(seeded)
        XCTAssertEqual(cluster.pucks.map(\.userId), ["host", "solver"])
        XCTAssertEqual(cluster.overflow, 0)
        XCTAssertFalse(
            cluster.pucks.contains { $0.isSpectator },
            "a seeded spectator seeds the store but never widens the pill")
    }

    // The parity is that ONE filter: the seeded roster (connected: false) and the same
    // people live (connected: true) yield the identical solver set, because the cluster
    // filters on the seat (isSpectator), never on liveness. So the withheld→ready swap
    // shows the same pucks and nothing re-inserts.
    func test_seededAndLive_yieldTheSameSolvers_section4() {
        func roster(connected: Bool) -> [RosterMember] {
            [
                RosterMember(
                    userId: "host", displayName: "Ana", wireColor: "",
                    avatarUrl: nil, isHost: true, isSpectator: false, connected: connected),
                RosterMember(
                    userId: "guest", displayName: "Guest", wireColor: "",
                    avatarUrl: nil, isHost: false, isSpectator: true, connected: connected),
            ]
        }
        let seeded = RosterList.cluster(roster(connected: false)).pucks.map(\.userId)
        let live = RosterList.cluster(roster(connected: true)).pucks.map(\.userId)
        XCTAssertEqual(seeded, live)
        XCTAssertEqual(seeded, ["host"])
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

    // The time pill owns its glass (the self-owned materialize, 2026-07-13): its
    // system capsule is suppressed ALWAYS, not just on handoff, so the pill's own
    // ChromeGlassSurface is the only glass and the arrival can materialize with it.
    // A content-only fade over a live system capsule would flash empty glass a beat
    // early (the empty-capsule finding, DESIGN.md §4).
    func test_timePill_alwaysHidesItsSystemCapsule_section4() {
        XCTAssertTrue(BarItemGlass.timePillBackgroundHidden)
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
