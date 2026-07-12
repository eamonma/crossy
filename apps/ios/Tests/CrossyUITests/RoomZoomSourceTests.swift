import XCTest

@testable import CrossyUI

// The room push's zoom vocabulary (native continuity, DESIGN.md §4). A tapped room
// card is the surface its room grows from, and the room pours back into that card
// on the pop. The stamp on the card and the room destination must name the SAME
// source, so the id is derived once, purely, from the gameId; this pins that one
// contract the way the repo pins shared vocabulary (ArrivalCopyTests).

final class RoomZoomSourceTests: XCTestCase {
    func test_theSourceIDIsDerivedPurelyFromTheGameId() {
        // The card stamp and the destination both build the id this way, so a
        // stable derivation is the whole contract: same gameId, same source.
        XCTAssertEqual(RoomZoomSource.sourceID(for: "g-42"), "crossy.room.g-42")
        XCTAssertEqual(
            RoomZoomSource.sourceID(for: "g-42"),
            RoomZoomSource.sourceID(for: "g-42"),
            "the derivation is pure: the same gameId always names the same source")
    }

    func test_distinctRoomsGetDistinctSources() {
        // Many cards ride one namespace, so two rooms must never collide on one
        // source or the zoom would pair the wrong card to the wrong room.
        XCTAssertNotEqual(
            RoomZoomSource.sourceID(for: "g-1"),
            RoomZoomSource.sourceID(for: "g-2"))
    }

    func test_theJoinCapsuleSourceIsDistinctFromEveryRoomAndTheSheet() {
        // The Join capsule wears the room push's source too (slice 2), so a
        // code-join grows the room from the capsule. That id must not collide with
        // any room card's id, nor with the join sheet's own source, or the two
        // stamps on the one capsule would fight over one geometry.
        XCTAssertNotEqual(
            RoomZoomSource.joinCapsuleID, RoomZoomSource.sourceID(for: "joinCapsule"),
            "the capsule id is a reserved constant, never a gameId's derivation")
        XCTAssertNotEqual(
            RoomZoomSource.joinCapsuleID, JoinSheetSource.id,
            "the capsule carries two distinct stamps: the sheet's and the room push's")
    }
}
