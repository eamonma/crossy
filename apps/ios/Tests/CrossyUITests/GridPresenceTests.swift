import XCTest

import CrossyDesign

@testable import CrossyUI

// Presence marks: who renders, in which roster slot, on which ground side. The wire
// color string is authoritative for slotting (root DESIGN.md §8; the server derives
// it in apps/session/src/color.ts); spectator cursors never render (root DESIGN.md
// §15); your own cursor is the selection, not presence.

final class GridPresenceTests: XCTestCase {
    private func cursor(_ userId: String, cell: Int = 7, isAcross: Bool = true)
        -> GridPresence.CursorInput
    {
        .init(userId: userId, cell: cell, isAcross: isAcross)
    }

    private func participant(
        _ userId: String, name: String = "Bee", color: String = "#2B9C8F",
        isSpectator: Bool = false
    ) -> GridPresence.ParticipantInput {
        .init(userId: userId, displayName: name, color: color, isSpectator: isSpectator)
    }

    func test_wireColorStringDecidesTheRosterSlot_serverAuthoritative() {
        let wire = "#2B9C8F"
        let marks = GridPresence.marks(
            cursors: [cursor("bee")],
            participants: [participant("bee", color: wire)],
            selfUserId: "ana", ground: .studio)
        let expected = IdentityRoster.color(forWireColor: wire)!.lightGround
        XCTAssertEqual(marks[7]?.first?.color, expected)
        // The wire slot must win even where the local user-id hash disagrees.
        let localFallback = IdentityRoster.color(for: "bee").lightGround
        if localFallback != expected {
            XCTAssertNotEqual(marks[7]?.first?.color, localFallback)
        }
    }

    func test_groundPicksThePairSide_ID8() {
        let inputs = (
            cursors: [cursor("bee")],
            participants: [participant("bee")])
        let identity = IdentityRoster.color(forWireColor: "#2B9C8F")!
        let studio = GridPresence.marks(
            cursors: inputs.cursors, participants: inputs.participants,
            selfUserId: nil, ground: .studio)
        let observatory = GridPresence.marks(
            cursors: inputs.cursors, participants: inputs.participants,
            selfUserId: nil, ground: .observatory)
        XCTAssertEqual(studio[7]?.first?.color, identity.lightGround)
        XCTAssertEqual(observatory[7]?.first?.color, identity.darkGround)
    }

    func test_selfCursorIsNotPresence() {
        let marks = GridPresence.marks(
            cursors: [cursor("ana")],
            participants: [participant("ana", name: "Ana")],
            selfUserId: "ana", ground: .studio)
        XCTAssertTrue(marks.isEmpty)
    }

    func test_spectatorCursorsNeverRender_rootDesignSection15() {
        let marks = GridPresence.marks(
            cursors: [cursor("sam")],
            participants: [participant("sam", name: "Sam", isSpectator: true)],
            selfUserId: "ana", ground: .studio)
        XCTAssertTrue(marks.isEmpty)
    }

    func test_unknownParticipantFallsBackToUserIdSlot() {
        // A cursor may arrive before its roster entry; it renders with the
        // deterministic user-id fallback rather than blanking.
        let marks = GridPresence.marks(
            cursors: [cursor("ghost")], participants: [],
            selfUserId: "ana", ground: .studio)
        XCTAssertEqual(marks[7]?.first?.color, IdentityRoster.color(for: "ghost").lightGround)
        XCTAssertEqual(marks[7]?.first?.initial, "")
    }

    func test_malformedWireColorFallsBackToUserIdSlot() {
        let marks = GridPresence.marks(
            cursors: [cursor("bee")],
            participants: [participant("bee", color: "teal")],
            selfUserId: nil, ground: .studio)
        XCTAssertEqual(marks[7]?.first?.color, IdentityRoster.color(for: "bee").lightGround)
    }

    func test_sharedCellStacksDeterministicallyByUserId() {
        let marks = GridPresence.marks(
            cursors: [cursor("zoe"), cursor("bee"), cursor("kit")],
            participants: [
                participant("zoe", name: "Zoe"), participant("bee"),
                participant("kit", name: "Kit"),
            ],
            selfUserId: "ana", ground: .studio)
        XCTAssertEqual(marks[7]?.map(\.userId), ["bee", "kit", "zoe"])
    }

    func test_directionRidesTheMark_wave21dArrow() {
        let marks = GridPresence.marks(
            cursors: [cursor("bee", isAcross: false)],
            participants: [participant("bee")],
            selfUserId: nil, ground: .studio)
        XCTAssertEqual(marks[7]?.first?.isAcross, false)
    }

    // INV-1: the avatar initial folds ASCII-only; a non-ASCII initial passes verbatim.
    func test_initialIsAsciiUppercased_INV1() {
        XCTAssertEqual(GridPresence.initial(of: "ana"), "A")
        XCTAssertEqual(GridPresence.initial(of: "Bee"), "B")
        XCTAssertEqual(GridPresence.initial(of: "émile"), "é")
        XCTAssertEqual(GridPresence.initial(of: ""), "")
    }
}
