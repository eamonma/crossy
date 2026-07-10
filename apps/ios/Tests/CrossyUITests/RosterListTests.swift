import XCTest

@testable import CrossyUI

// The roster derivations: presence order for the puck cluster and the menu's
// rows (connected first, byte-ordered within a group so nothing shuffles
// between renders, INV-1: no locale-aware collation), the cluster's overflow
// cap, the menu subtitle's state word, and the spectator predicate behind the
// Join in affordance (ID-5; EXPERIENCE.md Watching).

final class RosterListTests: XCTestCase {
    private func member(
        _ id: String, name: String? = nil, connected: Bool = true,
        host: Bool = false, spectator: Bool = false
    ) -> RosterMember {
        RosterMember(
            userId: id, displayName: name ?? id.capitalized, wireColor: "#17917F",
            isHost: host, isSpectator: spectator, connected: connected)
    }

    func test_ordered_connectedComeFirstThenByteOrder_inv1() {
        let members = [
            member("zoe", connected: false),
            member("you", name: "You"),
            member("ada", connected: false),
            member("bee", name: "Bee"),
        ]
        let ordered = RosterList.ordered(members).map(\.userId)
        // Connected: Bee before You (B < Y bytewise); away: Ada before Zoe.
        XCTAssertEqual(ordered, ["bee", "you", "ada", "zoe"])
    }

    func test_ordered_tiesOnNameFallToUserId() {
        let members = [
            member("b", name: "Sam"),
            member("a", name: "Sam"),
        ]
        XCTAssertEqual(RosterList.ordered(members).map(\.userId), ["a", "b"])
    }

    func test_cluster_capsPucksAndCountsOverflow() {
        let members = (1...6).map { member("u\($0)") }
        let cluster = RosterList.cluster(members)
        XCTAssertEqual(cluster.pucks.count, RosterList.puckCap)
        XCTAssertEqual(cluster.overflow, 2)
    }

    func test_cluster_smallRoomHasNoOverflow() {
        let cluster = RosterList.cluster([member("bee"), member("you")])
        XCTAssertEqual(cluster.pucks.count, 2)
        XCTAssertEqual(cluster.overflow, 0)
    }

    func test_selfIsSpectator_gatesTheJoinInAffordance_id5() {
        let members = [
            member("you", spectator: true),
            member("bee", host: true),
        ]
        XCTAssertTrue(RosterList.selfIsSpectator(members, selfUserId: "you"))
        XCTAssertFalse(RosterList.selfIsSpectator(members, selfUserId: "bee"))
        // Unknown or absent selves are never spectators: the room does not guess
        // someone out of a seat.
        XCTAssertFalse(RosterList.selfIsSpectator(members, selfUserId: "ghost"))
        XCTAssertFalse(RosterList.selfIsSpectator(members, selfUserId: nil))
    }

    func test_initial_isASCIIUppercased_inv1() {
        XCTAssertEqual(member("bee", name: "bee").initial, "B")
        XCTAssertEqual(member("x", name: "").initial, "")
    }

    // The menu row's quiet subtitle (ID-5 lexicon): Away beats the role because
    // presence is what the room asks first; a connected solver needs no word.
    func test_stateWord_awayBeatsRoleAndSolversStayQuiet_id5() {
        XCTAssertEqual(RosterList.stateWord(member("z", connected: false, host: true)), "Away")
        XCTAssertEqual(RosterList.stateWord(member("w", spectator: true)), "Watching")
        XCTAssertEqual(RosterList.stateWord(member("h", host: true)), "Host")
        XCTAssertNil(RosterList.stateWord(member("s")))
    }
}
