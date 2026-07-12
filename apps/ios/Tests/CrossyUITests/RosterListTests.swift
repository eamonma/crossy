import XCTest

@testable import CrossyUI

// The roster derivations: presence order for the puck cluster and the menu's
// rows (connected first, byte-ordered within a group so nothing shuffles
// between renders, INV-1: no locale-aware collation), the cluster's overflow
// cap, the menu subtitle's state word, the spectator predicate behind the
// Join in affordance (ID-5; EXPERIENCE.md Watching), and the live-cursor
// predicate behind the roster's Go to action (PROTOCOL.md §4, §9).

final class RosterListTests: XCTestCase {
    private func member(
        _ id: String, name: String? = nil, connected: Bool = true,
        host: Bool = false, spectator: Bool = false, cursor: RosterCursor? = nil
    ) -> RosterMember {
        RosterMember(
            userId: id, displayName: name ?? id.capitalized, wireColor: "#17917F",
            avatarUrl: nil,
            isHost: host, isSpectator: spectator, connected: connected, cursor: cursor)
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

    // The cluster shows only the people who are playing (owner ruling
    // 2026-07-10): host or solver, never a spectator. Guests always seat as
    // spectators (PROTOCOL.md §12), so a puck in the pill means "solving". The
    // menu still lists everyone; only the cluster filters.
    func test_cluster_showsSolversNotSpectators() {
        let members = [
            member("you", host: true),
            member("bee"),
            member("watcher", spectator: true),
            member("guest", connected: false, spectator: true),
        ]
        let cluster = RosterList.cluster(members)
        // Presence order holds within the filtered set: both connected, byte
        // order (Bee before You), the spectators dropped entirely.
        XCTAssertEqual(cluster.pucks.map(\.userId), ["bee", "you"])
        XCTAssertEqual(cluster.overflow, 0)
    }

    // The overflow counts only solvers: a room dense with spectators never
    // inflates the pill's +N with people who are not playing.
    func test_cluster_overflowCountsOnlySolvers() {
        let solvers = (1...6).map { member("s\($0)") }
        let watchers = (1...4).map { member("w\($0)", spectator: true) }
        let cluster = RosterList.cluster(solvers + watchers)
        XCTAssertEqual(cluster.pucks.count, RosterList.puckCap)
        // Six solvers, four shown, two collapsed; the four spectators never count.
        XCTAssertEqual(cluster.overflow, 2)
    }

    // The host gate on the roster menu's kick affordance (owner ruling
    // 2026-07-10): the local participant's own role decides what the menu
    // offers; the server enforces host-only regardless.
    func test_selfIsHost_gatesTheKickAffordance() {
        let members = [
            member("you", host: true),
            member("bee"),
        ]
        XCTAssertTrue(RosterList.selfIsHost(members, selfUserId: "you"))
        XCTAssertFalse(RosterList.selfIsHost(members, selfUserId: "bee"))
        XCTAssertFalse(RosterList.selfIsHost(members, selfUserId: "ghost"))
        XCTAssertFalse(RosterList.selfIsHost(members, selfUserId: nil))
    }

    // The host may kick anyone but themselves: the server refuses a self-target
    // with 403, so the menu never offers kick on the host's own row.
    func test_canKick_offersEveryoneButSelf() {
        let host = member("you", host: true)
        let other = member("bee")
        XCTAssertFalse(RosterList.canKick(host, selfUserId: "you"))
        XCTAssertTrue(RosterList.canKick(other, selfUserId: "you"))
        XCTAssertFalse(RosterList.canKick(other, selfUserId: nil))
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

    // The roster's Go to action (PROTOCOL.md §4, §9: `board.cursors` carries
    // `{userId, cell, direction}` for every connected solver) is live only when
    // the member holds a live cursor right now; no cursor yields no jump target,
    // whatever their role or connection state.
    func test_canJump_gatesOnALiveCursorOnly() {
        let solving = member("bee", cursor: RosterCursor(cell: 4, isAcross: true))
        let idle = member("sam")
        XCTAssertTrue(RosterList.canJump(solving))
        XCTAssertFalse(RosterList.canJump(idle))
    }

    // A member with no cursor yields no jump target: the absent-cursor case is
    // the one the enable/disable rule and the composition root's resolution both
    // key on (SolveScreen.onGoTo guards on `member.cursor` before calling
    // `SelectionModel.jump(to:)`).
    func test_canJump_falseForAMemberWithNoCursor() {
        let awayHost = member("h", connected: false, host: true)
        let watcher = member("w", spectator: true)
        XCTAssertFalse(RosterList.canJump(awayHost))
        XCTAssertFalse(RosterList.canJump(watcher))
    }

    // The host and non-host cases the menu's placement rule cares about: a
    // jumpable member always offers Go to (RosterMenu.personRow reads this
    // alongside `canKick`, independent of who is asking).
    func test_canJump_isIndependentOfHostOrSelf() {
        let target = member("bee", host: true, cursor: RosterCursor(cell: 0, isAcross: false))
        XCTAssertTrue(RosterList.canJump(target))
    }

    // The presence split for the roster menu (PROTOCOL.md §4: `connected` on every participant,
    // no wire change). The here section leads, away gathers below; each side keeps `ordered`'s
    // byte order (INV-1), so the split groups without reshuffling.
    func test_sections_hereLeadsAndAwayGathers_orderPreserved() {
        let members = [
            member("ada", connected: false),
            member("you", name: "You"),
            member("zoe", connected: false),
            member("bee", name: "Bee"),
        ]
        let split = RosterList.sections(members, selfUserId: "you")
        // Here: byte order Bee before You; away: byte order Ada before Zoe.
        XCTAssertEqual(split.here.map(\.userId), ["bee", "you"])
        XCTAssertEqual(split.away.map(\.userId), ["ada", "zoe"])
    }

    // The viewer is present by definition: a self row echoing connected:false mid-reconnect still
    // sits in the here section, never the away one. The web twin (partitionRoster) holds the same.
    func test_sections_selfIsAlwaysHereEvenWhenFlaggedAway() {
        let members = [
            member("you", name: "You", connected: false),
            member("bee", name: "Bee"),
        ]
        let split = RosterList.sections(members, selfUserId: "you")
        XCTAssertEqual(split.here.map(\.userId), ["bee", "you"])
        XCTAssertTrue(split.away.isEmpty)
    }

    // Host markers survive the split in either section: the row still carries isHost, so the
    // menu's kick gating and the subtitle read the same before and after grouping.
    func test_sections_hostMarkerPreservedInEitherSection() {
        let members = [
            member("here", name: "Here", host: true),
            member("gone", name: "Gone", connected: false, host: true),
        ]
        let split = RosterList.sections(members, selfUserId: "someone-else")
        XCTAssertTrue(split.here.first?.isHost ?? false)
        XCTAssertTrue(split.away.first?.isHost ?? false)
    }

    // A member moves sections live as their connected flag flips: the same input, one flag apart,
    // lands them here then away. The menu re-derives on every render, so a disconnect moves them.
    func test_sections_memberMovesSectionsAsConnectedFlips() {
        let connected = [member("bee")]
        let disconnected = [member("bee", connected: false)]
        XCTAssertEqual(
            RosterList.sections(connected, selfUserId: "you").here.map(\.userId), ["bee"])
        XCTAssertTrue(RosterList.sections(connected, selfUserId: "you").away.isEmpty)
        XCTAssertEqual(
            RosterList.sections(disconnected, selfUserId: "you").away.map(\.userId), ["bee"])
        XCTAssertTrue(RosterList.sections(disconnected, selfUserId: "you").here.isEmpty)
    }

    // Empty away section when everyone is here: the menu skips the Away header entirely, so no
    // ghost header stands over an empty group.
    func test_sections_awayIsEmptyWhenEveryoneIsHere() {
        let members = [member("you", host: true), member("bee")]
        XCTAssertTrue(RosterList.sections(members, selfUserId: "you").away.isEmpty)
    }

    // A disconnected spectator drops out of both sections (PROTOCOL.md §12: guests seat as
    // spectators): an away guest is neither here nor a lingering away ghost, matching the
    // cluster's playing-only rule. A connected spectator stays in the here section.
    func test_sections_disconnectedSpectatorDropsFromBothSides() {
        let members = [
            member("you", host: true),
            member("guest", connected: false, spectator: true),
        ]
        let split = RosterList.sections(members, selfUserId: "you")
        XCTAssertEqual(split.here.map(\.userId), ["you"])
        XCTAssertTrue(split.away.isEmpty)
    }

    func test_sections_connectedSpectatorStaysHere() {
        let members = [
            member("you", host: true),
            member("watcher", spectator: true),
        ]
        let split = RosterList.sections(members, selfUserId: "you")
        XCTAssertEqual(split.here.map(\.userId), ["watcher", "you"])
        XCTAssertTrue(split.away.isEmpty)
    }
}
