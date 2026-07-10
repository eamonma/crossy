//
//  RealRoom.swift
//  Crossy
//
//  The room against a live stack (roadmap I2 exit): the same composition DemoRoom
//  builds, with the loopback transport swapped for the real REST fetch plus WebSocket
//  (ARCHITECTURE.md §7: the store is pure over an injected transport, so only the
//  transport changes between the demo and here). The app target is the composition
//  root (AD-2), so the wiring lives HERE: the REST puzzle fetch through CrossyAPI, the
//  solution-stripped ClientPuzzle-to-GridPuzzle mapping (RoomMapping, per the pinned
//  ruling that keeps CrossyUI importing only CrossyStore + CrossyDesign), and the real
//  GameStore + SessionDriver + WebSocketTransport (AD-1, AD-6).
//
//  I2 wires this against the LOCAL stack with an injected token (the CROSSY_IT_*
//  pattern the I1e harness already speaks). I3 replaces exactly the token source with
//  the Keychain session and the base URLs with production config; the composition and
//  the mapping do not move.
//

import CrossyAPI
import CrossyProtocol
import CrossySession
import CrossyStore
import CrossyUI
import Foundation

@available(iOS 18.0, *)
@MainActor
final class RealRoom {
    let store = GameStore()
    let chrome = RoomChromeModel()

    /// The render shapes, placeholder until the REST view lands: until then the store
    /// stays `connecting`, so nothing renders as playable truth and input is refused
    /// (the store's own pre-welcome gate). `onReady` in `run` rebuilds the view against
    /// the real geometry once the fetch returns.
    private(set) var puzzle: GridPuzzle
    private(set) var clues: ClueBook
    private(set) var roomName: String
    private(set) var selection: SelectionModel

    /// A fatal wiring failure (no room, the view fetch refused, an unusable endpoint),
    /// surfaced plainly rather than papered over. Nil on the happy path.
    private(set) var fatal: String?

    private let config: RoomConfig
    private let api: CrossyAPIClient

    init(config: RoomConfig) {
        self.config = config
        let placeholder = GridPuzzle(rows: 1, cols: 1, blocks: [])
        puzzle = placeholder
        clues = .empty
        roomName = ""
        api = CrossyAPIClient(
            baseURL: config.apiBaseURL,
            tokenProvider: FixedBearerToken(token: config.token))
        selection = SelectionModel(store: store, puzzle: placeholder)

        // The kicked terminal is the composition root's flag (I2d): the store hands the
        // notice off here (it carries no seq, PROTOCOL.md §6), and the root raises the
        // exit. Wired at construction so a kick that lands before any redial still
        // reaches the chrome.
        let chrome = chrome
        store.onKicked = { _ in chrome.kicked = true }
    }

    /// Fetch the game view over REST (solution-stripped, INV-6), map it to the render
    /// shapes, then run the store's mailbox over the real socket through the driver's
    /// dial-run-sleep-redial loop (AD-6). `onReady` fires once the puzzle is mapped so
    /// the view rebuilds against the real geometry; the store's `connecting` state
    /// governs the board until the welcome lands.
    func run(onReady: @MainActor @escaping () -> Void) async {
        let view: GameView
        do {
            view = try await api.game(config.gameId)
        } catch {
            fatal = "Could not open this room (\(describe(error)))."
            onReady()
            return
        }

        let mapped = RoomMapping.map(view)
        puzzle = mapped.puzzle
        clues = mapped.clues
        roomName = view.name ?? ""
        selection = SelectionModel(store: store, puzzle: mapped.puzzle)
        onReady()

        guard let wsURL = RoomMapping.socketURL(from: view, sessionBaseURL: config.sessionBaseURL)
        else {
            fatal = "This room's session endpoint is unusable."
            return
        }

        let store = store
        let chrome = chrome
        let token = config.token
        let driver = SessionDriver(
            store: store,
            // The reconnect countdown deadline (DESIGN.md §8): the driver owns the clock
            // and hands the root the instant the next dial is due. The room bar shows it
            // as the quiet countdown only while the weather is reconnecting (gated on
            // store.sync), so a deadline left stale after the socket returns live is
            // never rendered; no clear step is needed.
            onReconnectScheduled: { deadline in chrome.reconnectRetryAt = deadline },
            makeTransport: {
                // One transport per attempt (Ports.swift), token resolved fresh inside
                // connect(). For the local stack the token is the injected fact; I3
                // swaps this closure for the Keychain session's current token.
                WebSocketTransport(
                    url: wsURL,
                    tokenProvider: { token },
                    resumeFromSeq: store.seq == 0 ? nil : store.seq)
            })
        // Run the driver's loop inline, exactly as DemoRoom awaits its mailbox. The
        // ContentView `.task` owns this task's lifetime: when the room leaves the
        // screen the task is cancelled, driver.run() returns, and the live socket
        // closes with 1000 (SessionDriver teardown; PROTOCOL.md §2).
        await driver.run()
    }

    private func describe(_ error: any Error) -> String {
        if let apiError = error as? CrossyAPIError, let code = apiError.apiCodeString {
            return code
        }
        return "\(error)"
    }
}

/// The BearerTokenProviding adapter for I2: a fixed injected token (the CROSSY_IT_*
/// pattern). I3 replaces this with the Keychain session's current-token accessor; the
/// REST client's port does not change.
struct FixedBearerToken: BearerTokenProviding {
    let token: String
    func currentToken() async throws -> String { token }
}
