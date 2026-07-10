//
//  DemoRoom.swift
//  Crossy
//
//  The fixture room the solve screen runs against with no network, wired exactly
//  as the real room will be (ARCHITECTURE.md §7: the store is pure over an
//  injected transport, so the room runs anywhere). The app target is the
//  composition root (AD-2), so the wiring lives here: a welcome fixture, a
//  loopback transport that echoes every mutation as its sequenced cellSet (echo
//  clears the overlay, INV-10), and a GameStore consuming it through the one
//  mailbox. I2c grew the chrome around this shape; I3 swaps only the transport.
//
//  Launch-argument scripts (the SP-i2 precedent; simctl cannot synthesize touch):
//    -i2bScript             type SOL into 1-Across (-i2bRebus opens the field)
//    -i2cScript             Bee's cursor patrols the board (presence, glints)
//    -i2cBrowser            land the clue browser open
//    -i2cMelt 0.5           hold the melt at a progress (intermediate evidence)
//    -i2cRoster             land the roster panel open
//    -i2cWeather resyncing  force the breathing-dot state (a gapped event)
//    -i2cWeather reconnecting  force the dimmed room with the quiet countdown
//    -i2cSpectator          seat the local player as a spectator (Watching)
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
    let clues: ClueBook
    let roomName = "Tuesday evening"
    let selection: SelectionModel
    let chrome = RoomChromeModel()
    private let transport: LoopbackTransport

    init() {
        let spectating = ProcessInfo.processInfo.arguments.contains("-i2cSpectator")
        let fixture = DemoFixture.mini9(selfRole: spectating ? .spectator : .host)
        puzzle = fixture.puzzle
        clues = fixture.clues
        transport = LoopbackTransport(welcome: fixture.welcome)
        selection = SelectionModel(store: store, puzzle: puzzle)
    }

    /// Connect (the welcome arrives through the stream like every other frame) and
    /// run the store's mailbox until the transport closes.
    func run() async {
        try? await transport.connect()
        async let mailbox: Void = store.run(transport)
        await script()
        await mailbox
    }

    private func script() async {
        let arguments = ProcessInfo.processInfo.arguments
        try? await Task.sleep(for: .milliseconds(400))  // let the welcome land

        if arguments.contains("-i2bScript") {
            // The cursor opens on 1-Across (first playable, across); type into it.
            for character in "SOL" {
                selection.press(.letter(character))
                try? await Task.sleep(for: .milliseconds(120))
            }
            if arguments.contains("-i2bRebus") {
                selection.press(.rebus)
                for character in "HEART" {
                    selection.press(.letter(character))
                    try? await Task.sleep(for: .milliseconds(80))
                }
            }
        }

        if let index = arguments.firstIndex(of: "-i2cWeather") {
            let state = arguments.indices.contains(index + 1) ? arguments[index + 1] : ""
            switch state {
            case "resyncing":
                // A gapped seq: the store sends requestSync and holds resyncing
                // (the loopback never answers one, exactly what we want here).
                await transport.deliver(
                    .cellSet(
                        CellSetMessage(
                            seq: store.seq + 5, cell: 44, value: "S",
                            by: "bee", commandId: "demo-gap", at: DemoFixture.isoNow())))
            case "reconnecting":
                // The transport drop path, minus the socket: the store dims the
                // room; the countdown deadline is the composition root's to set
                // (in production the session adapter schedules the dial).
                store.connectionLost()
                chrome.reconnectRetryAt = Date.now.addingTimeInterval(9)
            default:
                break
            }
        }

        if arguments.contains("-i2cBrowser") {
            chrome.presentBrowser()
        }
        if let index = arguments.firstIndex(of: "-i2cMelt"),
            arguments.indices.contains(index + 1),
            let progress = Double(arguments[index + 1])
        {
            // A held mid-melt frame: the SP-i1 evidence pattern (live glass at
            // intermediate geometry), since simctl cannot scrub a finger.
            chrome.meltProgress = min(max(progress, 0), 1)
        }
        if arguments.contains("-i2cRoster") {
            chrome.presentRoster()
        }

        if arguments.contains("-i2cScript") {
            // Bee patrols: down her column, then across the local player's opening
            // word, so presence marks move on the board and her glint crosses the
            // clue bar when she enters the word it shows.
            let patrol = [41, 42, 43, 42, 41, 40, 2, 1, 2, 40, 41]
            for cell in patrol {
                await transport.deliver(
                    .cursor(CursorMessage(userId: "bee", cell: cell, direction: .across)))
                try? await Task.sleep(for: .milliseconds(900))
            }
        }
    }
}

// MARK: - The fixture

enum DemoFixture {
    /// A 9x9 mini with a symmetric block lattice, one teammate mid-solve (Bee wrote
    /// the start of the row-4 across and parks her cursor there), one away member
    /// so the roster shows presence, and everything else open for typing. Wire
    /// colors are roster values (apps/ios/DESIGN.md §3); the wire is authoritative
    /// for slotting.
    static func mini9(selfRole: Role = .host) -> (puzzle: GridPuzzle, clues: ClueBook, welcome: WelcomeMessage) {
        let rows = 9
        let cols = 9
        let blocks: Set<Int> = [4, 13, 30, 50, 67, 76]  // 180-degree symmetric

        // Standard numbering scan: a playable cell numbers when it starts an
        // across or a down run (the ingested-clue mapping arrives with I3).
        var starts: [(number: Int, cell: Int)] = []
        var acrossRuns: [(number: Int, cells: [Int])] = []
        var downRuns: [(number: Int, cells: [Int])] = []
        var next = 1
        for cell in 0..<(rows * cols) where !blocks.contains(cell) {
            let row = cell / cols
            let col = cell % cols
            let startsAcross = col == 0 || blocks.contains(cell - 1)
            let startsDown = row == 0 || blocks.contains(cell - cols)
            guard startsAcross || startsDown else { continue }
            starts.append((next, cell))
            if startsAcross {
                var run: [Int] = []
                var cursor = cell
                while cursor / cols == row, !blocks.contains(cursor) {
                    run.append(cursor)
                    cursor += 1
                    if cursor % cols == 0 { break }
                }
                acrossRuns.append((next, run))
            }
            if startsDown {
                var run: [Int] = []
                var cursor = cell
                while cursor < rows * cols, !blocks.contains(cursor) {
                    run.append(cursor)
                    cursor += cols
                }
                downRuns.append((next, run))
            }
            next += 1
        }

        let puzzle = GridPuzzle(
            rows: rows, cols: cols,
            blocks: blocks,
            circles: [40],
            numbers: GridPuzzle.numbering(from: starts))

        let clues = ClueBook(
            across: zip(acrossRuns, acrossTexts).map { run, text in
                ClueEntry(number: run.number, text: text, cells: run.cells, isAcross: true)
            },
            down: zip(downRuns, downTexts).map { run, text in
                ClueEntry(number: run.number, text: text, cells: run.cells, isAcross: false)
            })

        // Bee's opening: the first five letters of the full row-4 across.
        let fills: [Int: String] = [36: "C", 37: "R", 38: "O", 39: "S", 40: "S"]
        let cells: [CrossyProtocol.Cell] = (0..<(rows * cols)).map { cell in
            guard let value = fills[cell] else { return Cell(v: nil, by: nil) }
            return Cell(v: value, by: "bee")
        }

        let welcome = WelcomeMessage(
            protocolVersion: 1,
            selfIdentity: WelcomeMessage.SelfIdentity(userId: "you", role: selfRole),
            board: Board(
                seq: fills.count,
                status: .ongoing,
                // A believable ambient clock (ID-2): the room's first fill landed
                // a little over twelve minutes ago.
                firstFillAt: iso(secondsAgo: 754),
                completedAt: nil,
                abandonedAt: nil,
                cells: cells,
                participants: [
                    Participant(
                        userId: "you", displayName: "You", color: "#6F66D4",
                        role: selfRole, connected: true),
                    Participant(
                        userId: "bee", displayName: "Bee", color: "#17917F",
                        role: selfRole == .host ? .solver : .host, connected: true),
                    Participant(
                        userId: "ada", displayName: "Ada", color: "#DE5722",
                        role: .solver, connected: false),
                ],
                cursors: [Cursor(userId: "bee", cell: 41, direction: .across)],
                recentCommandIds: [],
                stats: nil))
        return (puzzle, clues, welcome)
    }

    static func isoNow() -> String {
        Date().ISO8601Format()
    }

    private static func iso(secondsAgo: TimeInterval) -> String {
        Date(timeIntervalSinceNow: -secondsAgo).ISO8601Format()
    }

    /// Fixture clue prose, warm and plain (ID-5), one per run in scan order.
    private static let acrossTexts = [
        "Sunrise direction",
        "Kettle's whisper",
        "Pocket-sized garden",
        "Half a laugh",
        "Letters between friends",
        "Slow river bend",
        "It crosses words, together",
        "Morning window light",
        "Tea gone cold, alas",
        "A door left ajar",
        "Small victory sound",
        "Corner of a quilt",
        "Last bite saved",
        "Rain on a tin roof",
        "Goodnight, almost",
    ]

    private static let downTexts = [
        "Evening call ritual",
        "Bee's favorite letter run",
        "Walk taken slowly",
        "Borrowed pencil, returned",
        "The quiet between clues",
        "Shared umbrella weather",
        "Postcard with no stamp",
        "Hum of a full room",
        "Sock drawer surprise",
        "Lamp left on for you",
        "One more before bed",
    ]
}

// MARK: - The loopback transport

/// The scripted transport (ARCHITECTURE.md §7): yields the welcome on connect and
/// echoes every mutation as the next sequenced cellSet, so the optimistic overlay
/// clears through the same path production will use. Ephemeral frames (moveCursor,
/// heartbeat) vanish exactly as a serverless room would swallow them; requestSync
/// never fires because the loopback cannot gap, except when a demo script gaps it
/// on purpose. `deliver` lets scripts speak as the room (teammate cursors, forced
/// gaps).
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

    /// A scripted frame from "the room": teammate cursors, forced gaps.
    func deliver(_ message: ServerMessage) {
        deliveries.yield(message)
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
