import XCTest

@testable import CrossyUI

// The arrival seed (apps/ios/DESIGN.md §4, the live-data birth rule): the facts a
// tapped room card carries into the room composition so the trailing cluster is BORN
// with the #132 zoom push instead of popping at REST-mount. The count is honest from
// the list row (placeholder pucks stand at true width); the identity is not yet, so a
// placeholder puck renders the achromatic floor rather than a hash color that would
// flip when the real id lands. These pin the pure seam the composition root reads: the
// count arithmetic, the placeholder id contract shared across the ring seam (the app
// target mints ids, SolveScreen reads them back), and the placeholder member's honest
// rendering through the cluster.

final class RoomArrivalSeedTests: XCTestCase {
    // The seed is the card's whole knowledge in one value (DESIGN.md §4): the member
    // count and the room name, carried beside the path so the route stays Hashable.
    func test_seedCarriesTheCardsFacts_section4() {
        let seed = RoomArrivalSeed(memberCount: 3, name: "Tuesday evening")
        XCTAssertEqual(seed.memberCount, 3)
        XCTAssertEqual(seed.name, "Tuesday evening")
    }

    // The width is count-driven (DESIGN.md §4): the seed stands as many placeholder
    // pucks as the list row's member count, clamped non-negative so a malformed row
    // never asks for negative pucks.
    func test_placeholderCount_isTheMemberCountClampedNonNegative_section4() {
        XCTAssertEqual(RoomArrivalSeed.placeholderPuckCount(3), 3)
        XCTAssertEqual(RoomArrivalSeed.placeholderPuckCount(0), 0)
        XCTAssertEqual(RoomArrivalSeed.placeholderPuckCount(-2), 0)
    }

    // The placeholder id contract (DESIGN.md §4): a pre-REST seeded participant carries
    // a synthetic id under the reserved prefix, distinct from every server-minted member
    // id, so the roster tells a placeholder from an identified member with one predicate.
    func test_placeholderIDs_areRecognizedByThePrefix_section4() {
        XCTAssertTrue(RoomArrivalSeed.isPlaceholderID(RoomArrivalSeed.placeholderID(0)))
        XCTAssertTrue(RoomArrivalSeed.isPlaceholderID(RoomArrivalSeed.placeholderID(7)))
        // A real member id never takes the placeholder shape.
        XCTAssertFalse(RoomArrivalSeed.isPlaceholderID("you"))
        XCTAssertFalse(RoomArrivalSeed.isPlaceholderID("user-abc-123"))
        XCTAssertFalse(RoomArrivalSeed.isPlaceholderID(""))
    }

    // The placeholder ids are stable and distinct per index (DESIGN.md §4), so the
    // seed's ForEach is stable across the few renders it lives through and no two pucks
    // collide on one id (which would drop a puck from the count-true width).
    func test_placeholderIDs_areStableAndDistinctPerIndex_section4() {
        XCTAssertEqual(RoomArrivalSeed.placeholderID(0), RoomArrivalSeed.placeholderID(0))
        XCTAssertNotEqual(RoomArrivalSeed.placeholderID(0), RoomArrivalSeed.placeholderID(1))
        let ids = (0..<5).map(RoomArrivalSeed.placeholderID)
        XCTAssertEqual(Set(ids).count, 5)
    }

    // A placeholder member renders the achromatic floor (DESIGN.md §4): the seeded
    // member carries the placeholder flag when its id is a placeholder id, so the puck
    // knows to stand hollow (RosterPuckBody) instead of a hash color that would flip at
    // REST. The RoomOpeningRoster helper is the ONE place the rule lives, shared with
    // SolveScreen's live mapping so the seeded pill and the live pill read the same.
    func test_seededMemberIsAPlaceholder_liveMemberIsNot_section4() {
        let placeholder = RoomOpeningRoster.member(
            userId: RoomArrivalSeed.placeholderID(0), displayName: "", wireColor: "",
            avatarUrl: nil, isHost: false, isSpectator: false, connected: false)
        XCTAssertTrue(placeholder.placeholder)

        let live = RoomOpeningRoster.member(
            userId: "bee", displayName: "Bee", wireColor: "#17917F",
            avatarUrl: nil, isHost: false, isSpectator: false, connected: true)
        XCTAssertFalse(live.placeholder)
    }

    // The cluster counts placeholder pucks toward the width exactly as it counts live
    // ones (DESIGN.md §4, §2: the width is count-driven, constant-built): a seed of N
    // members shows the same puck count and overflow a live roster of N would, so the
    // pill never resizes across the pre-REST→REST beat unless membership genuinely
    // moved. Placeholders are not spectators, so the cluster keeps them all.
    func test_placeholderClusterWidth_matchesALiveRosterOfTheSameCount_section2() {
        let seeded = (0..<6).map { index in
            RoomOpeningRoster.member(
                userId: RoomArrivalSeed.placeholderID(index), displayName: "",
                wireColor: "", avatarUrl: nil, isHost: false, isSpectator: false,
                connected: false)
        }
        let cluster = RosterList.cluster(seeded)
        // Six members: four pucks shown, two collapsed to +2 (RosterList.puckCap).
        XCTAssertEqual(cluster.pucks.count, RosterList.puckCap)
        XCTAssertEqual(cluster.overflow, 6 - RosterList.puckCap)
    }

    // The default member is never a placeholder (DESIGN.md §4): every existing
    // construction site (SolveScreen, Settings, the island) omits the flag, so it stays
    // an identified member untouched; only the seed sets it true.
    func test_defaultMemberIsNotAPlaceholder_section4() {
        let member = RosterMember(
            userId: "you", displayName: "You", wireColor: "#6F66D4", avatarUrl: nil,
            isHost: true, isSpectator: false, connected: true)
        XCTAssertFalse(member.placeholder)
    }
}

// The timer's self-owned glass carve-out (apps/ios/DESIGN.md §4, the SLICE 2 redesign):
// the time pill's item PERMANENTLY suppresses the system capsule so its content can
// carry its own glass and the arrival rides the chrome spring. The back button and the
// Menus keep the #149 arrangement (system glass, suppressed only on the yield), so the
// two rules are distinct and pinned separately.

final class TimePillSelfGlassTests: XCTestCase {
    // The time pill's system capsule hides ALWAYS (DESIGN.md §4): the pill carries its
    // own glass, so the shared background is suppressed permanently, never gated on the
    // yield. Without this the nav bar would draw a capsule from the item's presence a
    // beat before the content materializes (the empty-glass frame the carve-out closes).
    func test_theTimePillSuppressesTheSystemCapsulePermanently_section4() {
        XCTAssertTrue(BarItemGlass.timePillBackgroundHidden)
    }

    // The system-glass items (the back button, the Menus) keep the #149 rule
    // (DESIGN.md §4): their capsule is the bar's, visible at rest, suppressed only while
    // handed off so a yielded item leaves no hollow capsule.
    func test_systemGlassItemsSuppressOnlyOnTheYield_section4() {
        XCTAssertFalse(BarItemGlass.backgroundHidden(handedOff: false))
        XCTAssertTrue(BarItemGlass.backgroundHidden(handedOff: true))
    }
}
