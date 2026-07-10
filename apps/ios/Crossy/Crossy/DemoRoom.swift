//
//  DemoRoom.swift
//  Crossy
//
//  The I2b composition: a fixture room the solve screen runs against with no
//  network, wired exactly as the real room will be (ARCHITECTURE.md §7: the store
//  is pure over an injected transport, so the room runs anywhere). The app target
//  is the composition root (AD-2), so the wiring lives here: a welcome fixture, a
//  loopback transport that echoes every mutation as its sequenced cellSet (echo
//  clears the overlay, INV-10), and a GameStore consuming it through the one
//  mailbox. I2c grows the real room from this shape; only the transport swaps.
//

import CrossyProtocol
import CrossyStore
import CrossyUI
import Foundation

// MARK: - The room

@MainActor
final class DemoRoom {
    let store = GameStore()
    let puzzle: GridPuzzle
    private let transport: LoopbackTransport

    init() {
        let fixture = DemoFixture.mini9()
        puzzle = fixture.puzzle
        transport = LoopbackTransport(welcome: fixture.welcome)
    }

    /// Connect (the welcome arrives through the stream like every other frame) and
    /// run the store's mailbox until the transport closes.
    func run() async {
        try? await transport.connect()
        await store.run(transport)
    }
}

// MARK: - The fixture

enum DemoFixture {
    /// A 9x9 mini with a symmetric block lattice, one teammate mid-solve (Bee wrote
    /// the start of 20-Across and parks her cursor there), and everything else open
    /// for typing. Wire colors are roster values (apps/ios/DESIGN.md §3); the wire
    /// is authoritative for slotting.
    static func mini9() -> (puzzle: GridPuzzle, welcome: WelcomeMessage) {
        let rows = 9
        let cols = 9
        let blocks: Set<Int> = [4, 13, 30, 50, 67, 76]  // 180-degree symmetric

        // Standard numbering scan: a playable cell numbers when it starts an
        // across or a down run (the ingested-clue mapping arrives with I3).
        var starts: [(number: Int, cell: Int)] = []
        var next = 1
        for cell in 0..<(rows * cols) where !blocks.contains(cell) {
            let row = cell / cols
            let col = cell % cols
            let startsAcross = col == 0 || blocks.contains(cell - 1)
            let startsDown = row == 0 || blocks.contains(cell - cols)
            if startsAcross || startsDown {
                starts.append((next, cell))
                next += 1
            }
        }

        let puzzle = GridPuzzle(
            rows: rows, cols: cols,
            blocks: blocks,
            circles: [40],
            numbers: GridPuzzle.numbering(from: starts))

        // Bee's opening: the first five letters of the full row-4 across.
        let fills: [Int: String] = [36: "C", 37: "R", 38: "O", 39: "S", 40: "S"]
        let cells: [CrossyProtocol.Cell] = (0..<(rows * cols)).map { cell in
            guard let value = fills[cell] else { return Cell(v: nil, by: nil) }
            return Cell(v: value, by: "bee")
        }

        let welcome = WelcomeMessage(
            protocolVersion: 1,
            selfIdentity: WelcomeMessage.SelfIdentity(userId: "you", role: .solver),
            board: Board(
                seq: fills.count,
                status: .ongoing,
                firstFillAt: "2026-07-10T19:02:11Z",
                completedAt: nil,
                abandonedAt: nil,
                cells: cells,
                participants: [
                    Participant(
                        userId: "you", displayName: "You", color: "#6F66D4",
                        role: .host, connected: true),
                    Participant(
                        userId: "bee", displayName: "Bee", color: "#17917F",
                        role: .solver, connected: true),
                ],
                cursors: [Cursor(userId: "bee", cell: 41, direction: .across)],
                recentCommandIds: [],
                stats: nil))
        return (puzzle, welcome)
    }
}

// MARK: - The loopback transport

/// The scripted transport (ARCHITECTURE.md §7): yields the welcome on connect and
/// echoes every mutation as the next sequenced cellSet, so the optimistic overlay
/// clears through the same path production will use. Ephemeral frames (moveCursor,
/// heartbeat) vanish exactly as a serverless room would swallow them; requestSync
/// never fires because the loopback cannot gap.
actor LoopbackTransport: Transport {
    nonisolated let inbound: AsyncStream<ServerMessage>
    private let deliveries: AsyncStream<ServerMessage>.Continuation

    private let welcome: WelcomeMessage
    private let selfUserId: String
    private var seq: Int
    private var firstFillAt: String?

    init(welcome: WelcomeMessage) {
        self.welcome = welcome
        self.selfUserId = welcome.selfIdentity.userId
        self.seq = welcome.board.seq
        self.firstFillAt = welcome.board.firstFillAt
        (inbound, deliveries) = AsyncStream.makeStream()
    }

    func connect() async throws {
        deliveries.yield(.welcome(welcome))
    }

    func send(_ message: ClientMessage) async {
        switch message {
        case .placeLetter(let place):
            seq += 1
            var establishing: String?
            if firstFillAt == nil {
                firstFillAt = Self.now()
                establishing = firstFillAt
            }
            deliveries.yield(
                .cellSet(
                    CellSetMessage(
                        seq: seq, cell: place.cell, value: place.value,
                        by: selfUserId, commandId: place.commandId, at: Self.now(),
                        firstFillAt: establishing)))
        case .clearCell(let clear):
            seq += 1
            deliveries.yield(
                .cellSet(
                    CellSetMessage(
                        seq: seq, cell: clear.cell, value: nil,
                        by: selfUserId, commandId: clear.commandId, at: Self.now())))
        case .hello, .moveCursor, .checkRequest, .heartbeat, .requestSync:
            break
        }
    }

    func close() async {
        deliveries.finish()
    }

    private static func now() -> String {
        Date().ISO8601Format()
    }
}
