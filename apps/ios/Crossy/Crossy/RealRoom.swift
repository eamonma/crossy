//
//  RealRoom.swift
//  Crossy
//
//  The real composition root (Phase I2 exit): the same SolveScreen the demo room
//  drives, wired to the real local stack. When the CROSSY_ROOM_* environment is
//  present (apps/ios/scripts/room.ts injects it via SIMCTL_CHILD_*), ContentView
//  composes this instead of DemoRoom: CrossyAPIClient fetches the game and its
//  solution-stripped ClientPuzzle (INV-6), the mapping below turns it into
//  CrossyUI's render shapes (CrossyUI cannot import CrossyProtocol, AD-2, so the
//  conversion lives here, the gap I2a/I2c deliberately left), and a production
//  GameStore + SessionDriver + WebSocketTransport runs the wire. I3 replaces only
//  the facts' source (Keychain session and a picked game instead of environment
//  variables); the composition is already the production one.
//
//  Launch-argument script (the -i2bScript precedent; simctl cannot synthesize
//  touch):
//    -roomScript    after the room is live, wait until a teammate's letter and a
//                   teammate's cursor are visible (server-to-app proven at the
//                   store that feeds the render), then type APP into the first
//                   across word (app-to-server, asserted by the scripted client
//                   in room.ts). The typing goes through SelectionModel.press,
//                   the exact deck path a finger drives.
//

import CrossyAPI
import CrossyProtocol
import CrossySession
import CrossyStore
import CrossyUI
import Foundation
import SwiftUI

// MARK: - Connection facts (the CROSSY_ROOM_* namespace)

/// The four facts a real room needs, read from the process environment. A distinct
/// namespace from the I1e harness's CROSSY_IT_* on purpose: those select tests
/// inside `swift test`, these select the app's composition root.
struct RealRoomFacts {
    let apiURL: URL
    /// `ws://{host}:{port}`, PROTOCOL.md §2 base. Taken from the environment rather
    /// than the game view's `session.ws` so an explicit override always wins: on a
    /// physical device 127.0.0.1 is the phone, and the launcher must be able to
    /// point both bases at the Mac's LAN address. GET /games/{id} still reports
    /// `session.ws`; I3's production root will prefer it once the bases are real
    /// hostnames instead of loopback.
    let wsBase: String
    let gameId: String
    let token: String

    var wsURL: URL? {
        URL(string: "\(wsBase)/games/\(gameId)/ws")
    }

    static func fromEnvironment() -> RealRoomFacts? {
        let env = ProcessInfo.processInfo.environment
        guard
            let api = env["CROSSY_ROOM_API_URL"], let apiURL = URL(string: api),
            let wsBase = env["CROSSY_ROOM_WS_BASE"], !wsBase.isEmpty,
            let gameId = env["CROSSY_ROOM_GAME_ID"], !gameId.isEmpty,
            let token = env["CROSSY_ROOM_TOKEN"], !token.isEmpty
        else { return nil }
        return RealRoomFacts(apiURL: apiURL, wsBase: wsBase, gameId: gameId, token: token)
    }
}

/// The environment token as CrossyAPI's auth surface. I3a replaces this with the
/// Keychain-backed session; the protocol is the seam.
struct EnvironmentBearerToken: BearerTokenProviding {
    let token: String
    func currentToken() async throws -> String { token }
}

// MARK: - The ClientPuzzle mapping (the composition root's own job, AD-2)

/// ClientPuzzle (CrossyProtocol, the wire) to GridPuzzle + ClueBook (CrossyUI, the
/// render shapes). Pure projection, no invention: cell numbers derive from clue
/// starts via `GridPuzzle.numbering(from:)` (an across and a down clue starting in
/// the same cell agree by construction, ingestion guarantees it); clue text arrives
/// already display-ready (ingestion strips the "N." prefix and decodes entities);
/// absent `shadedCircles` maps to the empty set. No solution-shaped field exists on
/// either side (INV-6 holds structurally through the mapping).
enum RealRoomMapping {
    static func gridPuzzle(from puzzle: ClientPuzzle) -> GridPuzzle {
        let starts = (puzzle.clues.across + puzzle.clues.down).compactMap {
            clue -> (number: Int, cell: Int)? in
            guard let first = clue.cellIndices.first else { return nil }
            return (number: clue.number, cell: first)
        }
        return GridPuzzle(
            rows: puzzle.rows,
            cols: puzzle.cols,
            blocks: Set(puzzle.blocks),
            circles: Set(puzzle.circles),
            shadedCircles: Set(puzzle.shadedCircles ?? []),
            numbers: GridPuzzle.numbering(from: starts))
    }

    static func clueBook(from puzzle: ClientPuzzle) -> ClueBook {
        ClueBook(
            across: puzzle.clues.across.map { entry($0, isAcross: true) },
            down: puzzle.clues.down.map { entry($0, isAcross: false) })
    }

    private static func entry(_ clue: Clue, isAcross: Bool) -> ClueEntry {
        ClueEntry(
            number: clue.number, text: clue.text, cells: clue.cellIndices,
            isAcross: isAcross)
    }
}

// MARK: - The room

/// The real room: REST for the immutable puzzle, the driver for the wire. Same
/// observable shape as DemoRoom from SolveScreen's side; the store, chrome, and
/// selection are the production values the demo scaffolding stands in for.
@MainActor
@Observable
final class RealRoom {
    /// The room's readiness. `connecting` renders a plain line, never a spinner
    /// (DESIGN.md §8); `failed` renders the error's one honest sentence. Both are
    /// pre-room states: SolveScreen composes only once `ready`.
    enum Phase {
        case connecting
        case ready(Ready)
        case failed(String)
    }

    struct Ready {
        let puzzle: GridPuzzle
        let clues: ClueBook
        let roomName: String
        let selection: SelectionModel
    }

    let store = GameStore()
    let chrome = RoomChromeModel()
    private(set) var phase: Phase = .connecting

    private let facts: RealRoomFacts
    private var driverTask: Task<Void, Never>?

    init(facts: RealRoomFacts) {
        self.facts = facts
    }

    /// Fetch the game (REST, §12), map the puzzle, then run the wire until the app
    /// dies. The driver owns redial; this method only composes.
    func run() async {
        let api = CrossyAPIClient(
            baseURL: facts.apiURL,
            tokenProvider: EnvironmentBearerToken(token: facts.token))
        let view: GameView
        do {
            view = try await api.game(facts.gameId)
        } catch {
            phase = .failed("Could not load the game: \(error)")
            return
        }
        guard let wsURL = facts.wsURL else {
            phase = .failed("CROSSY_ROOM_WS_BASE is not a usable URL base")
            return
        }

        let puzzle = RealRoomMapping.gridPuzzle(from: view.puzzle)
        let selection = SelectionModel(store: store, puzzle: puzzle)
        phase = .ready(
            Ready(
                puzzle: puzzle,
                clues: RealRoomMapping.clueBook(from: view.puzzle),
                // An unnamed game shows no room name; the bar owns the empty case.
                roomName: view.name ?? "",
                selection: selection))

        startDriver(wsURL: wsURL)
        await script(selection: selection)
    }

    /// The production wire: one driver, a fresh WebSocketTransport per attempt
    /// through the production init. The countdown wiring is the composition root's:
    /// the driver reports each backoff sleep (its one observational seam) and the
    /// deadline lands in chrome for the RoomBar's "Back in Ns"; minting the next
    /// transport means the dial is happening now, so the deadline clears.
    private func startDriver(wsURL: URL) {
        let token = facts.token
        let driver = SessionDriver(
            store: store,
            onBackoffSleep: { [chrome] seconds in
                chrome.reconnectRetryAt = Date(timeIntervalSinceNow: seconds)
            },
            makeTransport: { [store, chrome] in
                chrome.reconnectRetryAt = nil
                return WebSocketTransport(
                    url: wsURL,
                    tokenProvider: { token },
                    resumeFromSeq: store.seq > 0 ? store.seq : nil)
            })
        driverTask = Task { await driver.run() }
    }

    // MARK: - The -roomScript arg (the two-sided proof's app half)

    private static let scriptWord = "APP"

    private func script(selection: SelectionModel) async {
        guard ProcessInfo.processInfo.arguments.contains("-roomScript") else { return }
        // Server-to-app, observed where the render reads: a teammate's letter in
        // sequenced state and a teammate's cursor in presence. Both survive a race
        // with our own connect because the welcome snapshot carries them too.
        let saw = await poll(within: 90) { [store] in
            let teammateLetter = store.cells.values.contains {
                $0.v != nil && $0.by != nil && $0.by != store.selfUserId
            }
            let teammateCursor = store.cursors.values.contains {
                $0.userId != store.selfUserId
            }
            return store.sync == .live && teammateLetter && teammateCursor
        }
        guard saw else { return }
        // App-to-server: type through the deck's own path. The cursor opens on the
        // first playable across cell; the scripted client asserts these letters (and
        // the cursor relay each keystroke fires) arrive attributed to this user.
        for character in Self.scriptWord {
            selection.press(.letter(character))
            try? await Task.sleep(for: .milliseconds(150))
        }
    }

    /// Wall-clock polling against the real stack (the I1e `eventually` shape).
    private func poll(within seconds: Double, _ condition: () -> Bool) async -> Bool {
        let deadline = Date(timeIntervalSinceNow: seconds)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return false
    }
}

// MARK: - The view

struct RealRoomView: View {
    @State private var room: RealRoom

    init(facts: RealRoomFacts) {
        _room = State(initialValue: RealRoom(facts: facts))
    }

    var body: some View {
        Group {
            switch room.phase {
            case .connecting:
                Text(verbatim: "Connecting")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.secondary)
            case .failed(let why):
                Text(verbatim: why)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .padding()
            case .ready(let ready):
                SolveScreen(
                    store: room.store,
                    puzzle: ready.puzzle,
                    clues: ready.clues,
                    roomName: ready.roomName,
                    model: ready.selection,
                    chrome: room.chrome)
            }
        }
        .task { await room.run() }
    }
}
