// The frame is the renderer's whole world: a snapshot of the store's render surface
// and nothing else (INV-10: sequenced state painted with the overlay, via
// GameStore.renderValue; the renderer computes no gameplay). The store here is a
// real GameStore fed through its real inbound path, so the pin covers the exact
// composite the view will draw, overlay entries included.

import CoreGraphics
import CrossyDesign
import CrossyProtocol
import CrossyStore
import XCTest

@testable import CrossyUI

@MainActor
final class GridFrameTests: XCTestCase {
    private let mini = GridPuzzle(rows: 5, cols: 5, blocks: [4, 20])

    /// A live store: 5x5 board, one sequenced letter, one teammate cursor, self "ana".
    private func liveStore() -> GameStore {
        let store = GameStore()
        var cells = Array(repeating: Cell(v: nil, by: nil), count: 25)
        cells[0] = Cell(v: "S", by: "ana")
        cells[6] = Cell(v: "A", by: "bee")
        store.receive(
            .welcome(
                WelcomeMessage(
                    protocolVersion: 1,
                    selfIdentity: .init(userId: "ana", role: .solver),
                    board: Board(
                        seq: 3, status: .ongoing,
                        firstFillAt: nil, completedAt: nil, abandonedAt: nil,
                        cells: cells,
                        participants: [
                            Participant(
                                userId: "ana", displayName: "Ana", color: "#7F77DD",
                                role: .host, connected: true),
                            Participant(
                                userId: "bee", displayName: "Bee", color: "#2B9C8F",
                                role: .solver, connected: true),
                        ],
                        cursors: [Cursor(userId: "bee", cell: 12, direction: .down)],
                        recentCommandIds: [], stats: nil))))
        return store
    }

    // INV-10: the frame's values are exactly the store's rendered composite for
    // every cell, pending overlay entries winning over sequenced state.
    func test_frameValuesEqualTheStoreComposite_overlayIncluded_INV10() {
        let store = liveStore()
        store.placeLetter(cell: 1, value: "o")  // optimistic, normalized to "O"
        let frame = GridFrame(store: store, puzzle: mini, selection: nil, ground: .studio)
        for cell in 0..<mini.cellCount {
            XCTAssertEqual(frame.values[cell], store.renderValue(cell), "cell \(cell)")
        }
        XCTAssertEqual(frame.values[1], "O")
        XCTAssertEqual(frame.values[0], "S")
        XCTAssertNil(frame.values[2])
    }

    func test_framePresenceComesFromTheStoreCursors() {
        let frame = GridFrame(
            store: liveStore(), puzzle: mini, selection: nil, ground: .studio)
        XCTAssertEqual(frame.presence.keys.sorted(), [12])
        XCTAssertEqual(frame.presence[12]?.first?.userId, "bee")
        XCTAssertEqual(frame.presence[12]?.first?.isAcross, false)
    }

    func test_activeWordFollowsTheSelectionAxis() {
        let store = liveStore()
        let across = GridFrame(
            store: store, puzzle: mini,
            selection: GridSelection(cell: 6, isAcross: true), ground: .studio)
        XCTAssertEqual(across.activeWord, [5, 6, 7, 8, 9])
        let down = GridFrame(
            store: store, puzzle: mini,
            selection: GridSelection(cell: 6, isAcross: false), ground: .studio)
        XCTAssertEqual(down.activeWord, [1, 6, 11, 16, 21])
    }

    // Background precedence through the frame (root DESIGN.md §10): the current
    // cell beats its own word, the word beats a teammate underneath it.
    func test_fillResolvesThePinnedPrecedence_rootDesignSection10() {
        let frame = GridFrame(
            store: liveStore(), puzzle: mini,
            selection: GridSelection(cell: 10, isAcross: false), ground: .studio)
        XCTAssertEqual(frame.fill(4), .block)
        XCTAssertEqual(frame.fill(10), .current)
        XCTAssertEqual(frame.fill(15), .activeWord)
        XCTAssertEqual(frame.fill(12), .teammate)
        XCTAssertEqual(frame.fill(24), .base)
    }

    // The cross-reference set threads through the frame: a cell in it, not otherwise
    // claimed by a higher level, resolves to .crossReference, and the active word
    // still outranks a bare teammate below it. The set defaults empty, so the
    // convenience init and every existing call site keep resolving as before.
    func test_crossReferenceSetResolvesBelowCheckAndAboveActiveWord() {
        let frame = GridFrame(
            puzzle: mini,
            values: [:],
            selection: GridSelection(cell: 10, isAcross: false),
            cursors: [],
            participants: [],
            selfUserId: "ana",
            ground: .studio,
            crossReference: [7, 10, 15])
        // Cell 10 is current: current outranks a cross-reference on the same cell.
        XCTAssertEqual(frame.fill(10), .current)
        // Cell 15 is in the active word (down through 10) AND cross-referenced:
        // cross-reference outranks the active word.
        XCTAssertEqual(frame.fill(15), .crossReference)
        // Cell 7 is cross-referenced and nothing higher claims it.
        XCTAssertEqual(frame.fill(7), .crossReference)
        // Cell 8 is neither: base.
        XCTAssertEqual(frame.fill(8), .base)
    }

    func test_crossReferenceDefaultsEmpty_soExistingFramesNeverTint() {
        let frame = GridFrame(
            store: liveStore(), puzzle: mini,
            selection: GridSelection(cell: 10, isAcross: false), ground: .studio)
        for cell in 0..<mini.cellCount {
            XCTAssertNotEqual(frame.fill(cell), .crossReference, "cell \(cell)")
        }
    }

    // The local cursor and active word render in the local player's color, slotted
    // from the wire color string (the server's string is authoritative).
    func test_cursorTintIsTheLocalPlayersRosterColor() {
        let frame = GridFrame(
            store: liveStore(), puzzle: mini, selection: nil, ground: .studio)
        let expected = IdentityRoster.color(forWireColor: "#7F77DD")!.lightGround
        XCTAssertEqual(frame.cursorTint, expected)
    }

    // ID-1: the cursor is color in motion; muting the switch drops the tint to ink
    // while the presence pucks (at-rest markers) keep their color.
    func test_cursorTintFallsBackToInkWhenColorInMotionIsMuted_ID1() {
        let store = liveStore()
        let frame = GridFrame(
            puzzle: mini,
            values: [:],
            selection: nil,
            cursors: [.init(userId: "bee", cell: 12, isAcross: false)],
            participants: store.participants.map {
                GridPresence.ParticipantInput(
                    userId: $0.userId, displayName: $0.displayName, color: $0.color,
                    isSpectator: $0.role == .spectator)
            },
            selfUserId: "ana",
            ground: .studio,
            colorInMotionEnabled: false)
        XCTAssertEqual(frame.cursorTint, Ground.studio.ink)
        XCTAssertEqual(
            frame.presence[12]?.first?.color,
            IdentityRoster.color(forWireColor: "#2B9C8F")!.lightGround)
    }

    // Before any welcome names us, the tint is the deterministic mock default
    // (violet, apps/ios/DESIGN.md §3); with an identity but no roster entry it is
    // the user-id hash slot.
    func test_selfIdentityFallbacks() {
        XCTAssertEqual(
            GridFrame.selfIdentity(participants: [], selfUserId: nil).name, "violet")
        XCTAssertEqual(
            GridFrame.selfIdentity(participants: [], selfUserId: "ana").name,
            IdentityRoster.color(for: "ana").name)
    }

    // Selecting a cell must not shift its own content: the glyph draw point the
    // renderer computes for a cell (CrossyGridView.drawCellContent) comes only from
    // the cell index and its value length, never from frame.fill(cell). Selecting
    // cell 6 changes its fill to .current but must leave the same cell's glyph
    // origin exactly where an unselected frame would draw it.
    func test_selectingACell_neverMovesItsOwnGlyphOrigin() {
        let store = liveStore()
        let unselected = GridFrame(store: store, puzzle: mini, selection: nil, ground: .studio)
        let selected = GridFrame(
            store: store, puzzle: mini,
            selection: GridSelection(cell: 6, isAcross: true), ground: .studio)
        XCTAssertEqual(unselected.fill(6), .base)
        XCTAssertEqual(selected.fill(6), .current)

        func glyphOrigin(_ frame: GridFrame, cell: Int) -> CGPoint {
            let value = frame.values[cell] ?? ""
            let marks = frame.presence[cell] ?? []
            let origin = GridModule.cellOrigin(cell, cols: mini.cols)
            let size = GridModule.glyphSize(forLength: max(value.count, 1))
            let shift = marks.isEmpty ? 0 : GridModule.glyphPresenceShift
            return CGPoint(
                x: origin.x + GridModule.glyphCenterX + shift,
                y: origin.y + GridModule.capCenterY(
                    baseline: GridModule.glyphBaseline, fontSize: GridModule.glyphFontSize))
        }

        XCTAssertEqual(glyphOrigin(unselected, cell: 6), glyphOrigin(selected, cell: 6))
    }

    // I3f (grid prehydration): the puzzle geometry the room paints before any
    // snapshot lands (a fresh store, still `connecting`, PROTOCOL.md §12's `GET
    // /games/{id}` puzzle.rows/cols/mask already in hand) must be the exact shape the
    // room paints once the WebSocket `welcome` hydrates cell contents. The frame is
    // constructed from one GridPuzzle instance both times, exactly as RealRoom does
    // (RoomMapping maps the REST view's geometry once and never remaps it), so this
    // pins that the two frames disagree only on `values`, never on `puzzle`, `rows`,
    // `cols`, or `cellCount`: no reflow between the empty paint and the hydrated one.
    func test_preSnapshotFrameGeometryMatchesPostSnapshotFrameGeometry() {
        let store = GameStore()
        let beforeSnapshot = GridFrame(
            store: store, puzzle: mini, selection: nil, ground: .studio)
        XCTAssertEqual(store.sync, .connecting)
        for cell in 0..<mini.cellCount {
            XCTAssertNil(beforeSnapshot.values[cell], "cell \(cell) empty before welcome")
        }

        store.receive(
            .welcome(
                WelcomeMessage(
                    protocolVersion: 1,
                    selfIdentity: .init(userId: "ana", role: .solver),
                    board: Board(
                        seq: 1, status: .ongoing,
                        firstFillAt: nil, completedAt: nil, abandonedAt: nil,
                        cells: {
                            var cells = Array(repeating: Cell(v: nil, by: nil), count: 25)
                            cells[0] = Cell(v: "S", by: "ana")
                            return cells
                        }(),
                        participants: [
                            Participant(
                                userId: "ana", displayName: "Ana", color: "#7F77DD",
                                role: .host, connected: true)
                        ],
                        cursors: [], recentCommandIds: [], stats: nil))))
        let afterSnapshot = GridFrame(
            store: store, puzzle: mini, selection: nil, ground: .studio)

        // Same instance in this test, exactly as the composition root threads one
        // mapped GridPuzzle through both the pre- and post-welcome paints.
        XCTAssertEqual(beforeSnapshot.puzzle, afterSnapshot.puzzle)
        XCTAssertEqual(beforeSnapshot.puzzle.rows, afterSnapshot.puzzle.rows)
        XCTAssertEqual(beforeSnapshot.puzzle.cols, afterSnapshot.puzzle.cols)
        XCTAssertEqual(beforeSnapshot.puzzle.cellCount, afterSnapshot.puzzle.cellCount)
        // Only the cell contents differ: the shape never moved.
        XCTAssertEqual(afterSnapshot.values[0], "S")
        XCTAssertNil(beforeSnapshot.values[0])
    }

    // INV-6: nothing solution-shaped can ride the frame into the renderer.
    func test_frameCarriesNoSolutionShapedMember_INV6() {
        let frame = GridFrame(
            store: liveStore(), puzzle: mini, selection: nil, ground: .studio)
        let labels = Mirror(reflecting: frame).children.compactMap(\.label)
        XCTAssertFalse(labels.isEmpty)
        for label in labels {
            let folded = String(
                decoding: label.utf8.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 },
                as: UTF8.self)
            XCTAssertFalse(folded.contains("solution"), "GridFrame.\(label) (INV-6)")
        }
    }
}
