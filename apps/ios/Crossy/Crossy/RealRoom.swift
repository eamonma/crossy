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
//  I2 wired this against the LOCAL stack with an injected token (the CROSSY_IT_*
//  pattern the I1e harness already speaks). I3 swapped exactly the token source: the
//  room takes any BearerTokenProviding (the Keychain-backed AuthSession in production,
//  FixedBearerToken for the harness facts), resolved fresh on every REST call and
//  every socket dial; the composition and the mapping did not move.
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

    /// The render shapes. `puzzle` starts as a 1x1 stand-in that exists only to give
    /// this non-optional property a value before the REST fetch returns; ContentView's
    /// `RealRoomView` never renders a board against it (I3f: a board painted from the
    /// stand-in would show the wrong dimensions for one frame and then reflow the
    /// instant `ready` flips), so the stand-in is never playable truth on screen. Once
    /// `run()`'s `GET /games/{id}` lands, `puzzle` becomes the real `rows`/`cols`/mask
    /// geometry (RoomMapping) and `onReady` fires; the store itself stays `connecting`
    /// until the WebSocket `welcome`, so the first board paint is the correct empty
    /// shape and cell contents hydrate in afterward with no dimensional change.
    private(set) var puzzle: GridPuzzle
    private(set) var clues: ClueBook
    private(set) var roomName: String
    private(set) var selection: SelectionModel
    /// The room's invite code, held from the game view (PROTOCOL.md §12: `GET
    /// /games/{id}` returns it to any member). The facts popover's copy row
    /// reads it; nil until the fetch lands.
    private(set) var inviteCode: String?

    /// A fatal wiring failure (no room, the view fetch refused, an unusable endpoint),
    /// surfaced plainly rather than papered over. Nil on the happy path.
    private(set) var fatal: String?

    private let gameId: String
    private let sessionBaseURL: URL
    private let tokenProvider: any BearerTokenProviding
    private let api: CrossyAPIClient

    /// The harness composition: every fact including the token is injected
    /// (RoomConfig, the CROSSY_IT_* pattern).
    convenience init(config: RoomConfig) {
        self.init(
            apiBaseURL: config.apiBaseURL,
            sessionBaseURL: config.sessionBaseURL,
            gameId: config.gameId,
            tokenProvider: FixedBearerToken(token: config.token))
    }

    /// The arrival composition (I3): the token rides a provider so REST and every
    /// socket redial resolve it fresh (a silent refresh mid-solve just works).
    init(
        apiBaseURL: URL,
        sessionBaseURL: URL,
        gameId: String,
        tokenProvider: any BearerTokenProviding
    ) {
        self.gameId = gameId
        self.sessionBaseURL = sessionBaseURL
        self.tokenProvider = tokenProvider
        let placeholder = GridPuzzle(rows: 1, cols: 1, blocks: [])
        puzzle = placeholder
        clues = .empty
        roomName = ""
        api = CrossyAPIClient(baseURL: apiBaseURL, tokenProvider: tokenProvider)
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
            view = try await api.game(gameId)
        } catch {
            fatal = "Could not open this room (\(describe(error)))."
            onReady()
            return
        }

        let mapped = RoomMapping.map(view)
        puzzle = mapped.puzzle
        clues = mapped.clues
        roomName = view.name ?? ""
        inviteCode = view.inviteCode
        selection = SelectionModel(store: store, puzzle: mapped.puzzle)
        onReady()

        guard let wsURL = RoomMapping.socketURL(from: view, sessionBaseURL: sessionBaseURL)
        else {
            fatal = "This room's session endpoint is unusable."
            return
        }

        let store = store
        let chrome = chrome
        let tokenProvider = tokenProvider
        let driver = SessionDriver(
            store: store,
            // The reconnect countdown deadline (DESIGN.md §8): the driver owns the clock
            // and hands the root the instant the next dial is due. The room bar shows it
            // as the quiet countdown only while the weather is reconnecting (gated on
            // store.sync), so a deadline left stale after the socket returns live is
            // never rendered; no clear step is needed.
            onReconnectScheduled: { deadline in chrome.reconnectRetryAt = deadline },
            makeTransport: {
                // One transport per attempt (Ports.swift), token resolved fresh
                // inside connect() through the same seam REST rides: the Keychain
                // session refreshes silently in production, the harness answers its
                // injected fact.
                WebSocketTransport(
                    url: wsURL,
                    tokenProvider: { try await tokenProvider.currentToken() },
                    resumeFromSeq: store.seq == 0 ? nil : store.seq)
            })
        // Run the driver's loop inline, exactly as DemoRoom awaits its mailbox. The
        // ContentView `.task` owns this task's lifetime: when the room leaves the
        // screen the task is cancelled, driver.run() returns, and the live socket
        // closes with 1000 (SessionDriver teardown; PROTOCOL.md §2).
        await driver.run()
    }

    /// End the game (host abandon, `POST /games/{id}/abandon`; PROTOCOL.md §12).
    /// The server settles the terminal state via the session service and the
    /// `gameAbandoned` event reaches the store over the live socket, so the room
    /// freezes through the same path a peer's abandon would. Host-only is the
    /// server's to enforce; the facts popover only offers this to the host. A
    /// failure is swallowed with a log: the room has no REST error surface yet
    /// (a reported gap for this slice), and the board state is unchanged.
    func endGame() {
        Task { @MainActor in
            do {
                _ = try await api.abandonGame(gameId: gameId)
            } catch {
                logRESTGap("abandon", error)
            }
        }
    }

    /// Kick a member (host, `DELETE /games/{id}/members/{userId}`; PROTOCOL.md
    /// §12). The server removes membership, writes the denylist, and disconnects
    /// the kicked user's live sockets; host-only and self-target refusal are the
    /// server's (the roster menu offers this only on other people's rows for a
    /// host). Failure is swallowed with a log, the same reported gap as abandon.
    func kick(userId: String) {
        Task { @MainActor in
            do {
                _ = try await api.kickMember(gameId: gameId, userId: userId)
                // The kick removed the membership server-side, but no frame tells this
                // host's socket (the `kicked` frame is the kicked user's; their socket
                // dropping would only grey the row). Reflect the confirmed removal so
                // the roster drops them at once instead of at the next snapshot
                // (PROTOCOL.md §12).
                store.removeParticipant(userId: userId)
            } catch {
                logRESTGap("kick", error)
            }
        }
    }

    /// The push-token registration the island binds to (§12a): this room's game id and
    /// itself as the REST sink. The island threads it through `.solveActivity`, so the
    /// controller reaches the two token endpoints without a singleton or an ambient URL.
    var liveActivityRegistration: LiveActivityRegistration {
        LiveActivityRegistration(gameId: gameId, sink: self)
    }

    /// The room has no surfaced REST error path yet (a reported gap for this
    /// slice; EXPERIENCE.md §4 wants one sentence per code). Until it lands, a
    /// failed operation logs and no-ops rather than papering the board.
    private func logRESTGap(_ operation: String, _ error: any Error) {
        print("[RealRoom] \(operation) failed: \(describe(error))")
    }

    private func describe(_ error: any Error) -> String {
        if let apiError = error as? CrossyAPIError, let code = apiError.apiCodeString {
            return code
        }
        return "\(error)"
    }
}

/// The live push-token sink (§12a): RealRoom forwards the island's register and
/// unregister to the same bearer-authed REST client kick and abandon ride. The registrar
/// (CrossyProtocol) owns the paths and body; this is the thin binding to the real client.
@available(iOS 18.0, *)
extension RealRoom: LiveActivityTokenSink {
    func registerLiveActivityToken(
        path: [String], _ body: LiveActivityTokenRegistration
    ) async throws {
        try await api.registerLiveActivityToken(path: path, body)
    }

    func unregisterLiveActivityToken(path: [String]) async throws {
        try await api.unregisterLiveActivityToken(path: path)
    }
}

/// The injected-token side of the I3 auth seam: a fixed bearer (the CROSSY_IT_*
/// pattern the harness and the fixture walk speak). Production rooms ride the
/// Keychain-backed AuthSession through the same BearerTokenProviding port.
struct FixedBearerToken: BearerTokenProviding {
    let token: String
    func currentToken() async throws -> String { token }
}
