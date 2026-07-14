// Reactions through the store (PROTOCOL.md §5, §9; D24): a stateless send beside
// moveCursor and a pure fan-out beside onKicked/onConflictFlash. The store holds
// NOTHING for a reaction, and these tests pin that: an inbound reaction changes no
// observable store state, and the snapshot path cannot carry one because the Board
// payload has no reactions field (there is no `board.reactions`, §9).

import CrossyProtocol
import CrossyStore
import XCTest

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class ReactionRelayTests: XCTestCase {
    private func board(seq: Int = 0, status: GameStatus = .ongoing) -> Board {
        Board(
            seq: seq,
            status: status,
            firstFillAt: nil,
            completedAt: nil,
            abandonedAt: nil,
            cells: Array(repeating: Cell(v: nil, by: nil), count: 20),
            participants: [],
            cursors: [],
            recentCommandIds: [],
            stats: nil)
    }

    private func welcome(_ board: Board) -> ServerMessage {
        .welcome(
            WelcomeMessage(
                protocolVersion: 1,
                selfIdentity: WelcomeMessage.SelfIdentity(userId: "me", role: .solver),
                board: board))
    }

    // MARK: - The send (PROTOCOL.md §5, §9)

    func test_reactEmitsTheWireFrameAndNothingElse_PROTOCOL9() async {
        let store = GameStore()
        store.receive(welcome(board()))
        let overlayBefore = store.overlay

        store.react(emoji: "🎉", cell: 7)

        XCTAssertEqual(store.outbox, [.react(ReactMessage(emoji: "🎉", cell: 7))])
        XCTAssertEqual(store.overlay, overlayBefore, "a reaction never enters the overlay (§8 is mutations only)")
    }

    func test_reactIsRefusedBeforeTheFirstWelcome_PROTOCOL7() async {
        // The moveCursor gate, mirrored: no authoritative game exists while connecting.
        let store = GameStore()
        store.react(emoji: "🎉", cell: 0)
        XCTAssertEqual(store.outbox, [])
    }

    func test_reactIsLegalInATerminalStatus_PROTOCOL9() async {
        // §9: react mutates nothing, so completion does not gate it the way it gates
        // placeLetter; reactions on the finished grid are intended.
        let store = GameStore()
        store.receive(welcome(board(status: .completed)))
        store.react(emoji: "🫡", cell: 3)
        XCTAssertEqual(store.outbox, [.react(ReactMessage(emoji: "🫡", cell: 3))])
    }

    // MARK: - The fan-out (PROTOCOL.md §6, §9)

    func test_inboundReactionHandsTheNoticeToTheSink_PROTOCOL9() async {
        let store = GameStore()
        var received: [ReactionMessage] = []
        store.onReaction = { received.append($0) }
        store.receive(welcome(board()))

        store.receive(.reaction(ReactionMessage(userId: "u2", emoji: "🔥", cell: 5)))

        // Receive-any (§9): an emoji outside the v1 send set still fans out.
        XCTAssertEqual(received, [ReactionMessage(userId: "u2", emoji: "🔥", cell: 5)])
    }

    func test_inboundReactionChangesNoStoreState_D24() async {
        let store = GameStore()
        store.onReaction = { _ in }
        store.receive(welcome(board(seq: 3)))
        store.placeLetter(cell: 1, value: "A")  // a pending overlay entry to guard

        let seq = store.seq
        let sync = store.sync
        let status = store.status
        let cells = store.cells
        let overlay = store.overlay
        let participants = store.participants
        let cursors = store.cursors
        let outbox = store.outbox

        store.receive(.reaction(ReactionMessage(userId: "u2", emoji: "🎉", cell: 5)))

        XCTAssertEqual(store.seq, seq)
        XCTAssertEqual(store.sync, sync)
        XCTAssertEqual(store.status, status)
        XCTAssertEqual(store.cells, cells)
        XCTAssertEqual(store.overlay, overlay)
        XCTAssertEqual(store.participants, participants)
        XCTAssertEqual(store.cursors, cursors)
        XCTAssertEqual(store.outbox, outbox, "a notice never emits a frame")
    }

    func test_snapshotsCannotReplayReactions_D24() async {
        // The server records nothing for a reaction, so no snapshot carries one (§9:
        // there is no board.reactions, unlike board.cursors). Pinned behaviorally: a
        // resync after a reaction fans nothing out again.
        let store = GameStore()
        var received: [ReactionMessage] = []
        store.onReaction = { received.append($0) }
        store.receive(welcome(board()))
        store.receive(.reaction(ReactionMessage(userId: "u2", emoji: "🎉", cell: 5)))
        XCTAssertEqual(received.count, 1)

        store.receive(.sync(SyncMessage(board: board(seq: 9))))

        XCTAssertEqual(received.count, 1, "a snapshot must not resurrect a reaction")
        XCTAssertEqual(store.seq, 9)
    }
}
