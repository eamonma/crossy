// Phase I1e (apps/ios/ROADMAP.md): the XCTest side of the integration harness.
// apps/ios/scripts/integration.ts boots the real local stack (Testcontainers Postgres,
// migrations, a JWKS issuer, the api and session services), creates a game through the
// real REST api, then runs `swift test` with the CROSSY_IT_* connection facts in the
// environment. Absent those facts every test here skips, so a plain `swift test` (and
// CI, which has no Docker) stays green with no services.
//
// Composition is production pieces only: WebSocketTransport through its production init
// (URL plus token provider), SessionDriver, GameStore. No seams, no scripted sockets,
// and assertions go through the client surface alone; the session service stays the
// single writer of game state. What this pins is the Phase I1 exit: the M1 exit shape
// replayed in Swift against the real wire (PROTOCOL.md sections 2, 7, 8).

import CrossyProtocol
import CrossySession
import CrossyStore
import Foundation
import XCTest

// MARK: - Connection facts (the CROSSY_IT_* namespace the script injects)

struct StackFacts {
    /// `ws://127.0.0.1:{session-port}`, the PROTOCOL.md section 2 endpoint base.
    let wsBase: String
    let gameId: String
    /// Two full-account members of the game: A is the host, B joined by invite code.
    let tokenA: String
    let tokenB: String

    static func fromEnvironment() -> StackFacts? {
        let env = ProcessInfo.processInfo.environment
        guard
            let wsBase = env["CROSSY_IT_WS_BASE"], !wsBase.isEmpty,
            let gameId = env["CROSSY_IT_GAME_ID"], !gameId.isEmpty,
            let tokenA = env["CROSSY_IT_TOKEN_A"], !tokenA.isEmpty,
            let tokenB = env["CROSSY_IT_TOKEN_B"], !tokenB.isEmpty
        else { return nil }
        return StackFacts(wsBase: wsBase, gameId: gameId, tokenA: tokenA, tokenB: tokenB)
    }
}

// MARK: - One scripted client (the app target's composition, in miniature)

/// The production composition for one player: a GameStore, a SessionDriver, and a fresh
/// WebSocketTransport per attempt through the production init. Each transport gets its
/// own URLSession so "kill" is scoped to exactly one connection.
///
/// What "killed" means here: `URLSession.invalidateAndCancel()` cancels the socket task
/// with no WebSocket close handshake. No 1000 close frame, no drain, no goodbye, which
/// is the closest in-process model of a process death; the kernel tears a killed
/// process's sockets down just as abruptly. The transport's receive loop surfaces it as
/// the drop signal (PROTOCOL.md section 7) and the driver redials.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class ScriptedClient {
    let store = GameStore()
    private(set) var sessions: [URLSession] = []
    private var driverTask: Task<Void, Never>?

    func connect(to url: URL, token: String) {
        let driver = SessionDriver(store: store) { [self] in
            let session = URLSession(configuration: .ephemeral)
            sessions.append(session)
            return WebSocketTransport(url: url, tokenProvider: { token }, session: session)
        }
        driverTask = Task { await driver.run() }
    }

    /// The abrupt kill described above; the driver is left running so it reconnects.
    func killConnection() {
        sessions.last?.invalidateAndCancel()
    }

    /// Deliberate teardown: cancel the driver (it closes a live socket with 1000) and
    /// release every URLSession this client minted.
    func shutDown() async {
        driverTask?.cancel()
        await driverTask?.value
        driverTask = nil
        for session in sessions {
            session.invalidateAndCancel()
        }
        sessions.removeAll()
    }
}

// MARK: - Wall-clock polling

/// Poll a condition against the real stack. The unit suites' `waitUntil` spins
/// `Task.yield` and exhausts its budget in microseconds; a real round trip takes
/// milliseconds, so this one sleeps between polls and fails loudly at the deadline.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
func eventually(
    _ what: String,
    within seconds: Double = 10,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ condition: () -> Bool
) async throws {
    let deadline = Date(timeIntervalSinceNow: seconds)
    while Date() < deadline {
        if condition() { return }
        try await Task.sleep(nanoseconds: 20_000_000)
    }
    XCTFail("timed out waiting until \(what)", file: file, line: line)
    throw CancellationError()
}

// MARK: - The suite

/// Each test claims its own cells of the 5x5 fixture so order never matters, and the
/// letters placed are arbitrary; nothing here knows or wants the solution (INV-6: it
/// never reaches a client payload to begin with).
@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class StackIntegrationTests: XCTestCase {
    /// The env guard: without the script's facts, every test skips (the integration
    /// tag is this guard, not an Xcode test plan).
    private func stackFacts() throws -> StackFacts {
        guard let facts = StackFacts.fromEnvironment() else {
            throw XCTSkip(
                "CROSSY_IT_* connection facts absent; run `corepack pnpm test:ios-integration` "
                    + "(apps/ios/scripts/integration.ts boots the stack and re-runs this suite)")
        }
        return facts
    }

    /// A connected client whose teardown is registered up front, so a mid-test failure
    /// still cancels the driver and releases its sessions.
    private func makeClient(_ facts: StackFacts, token: String) throws -> ScriptedClient {
        let url = try XCTUnwrap(URL(string: "\(facts.wsBase)/games/\(facts.gameId)/ws"))
        let client = ScriptedClient()
        client.connect(to: url, token: token)
        addTeardownBlock { @MainActor in
            await client.shutDown()
        }
        return client
    }

    // The real handshake (PROTOCOL.md section 2) and the echo path (section 8): a
    // letter placed through the store's command path paints as overlay, and the
    // server's cellSet echo clears it, leaving sequenced state to carry the render.
    func test_realHandshakeLandsWelcomeAndEchoClearsOverlay_INV10() async throws {
        let facts = try stackFacts()
        let client = try makeClient(facts, token: facts.tokenA)
        let store = client.store

        try await eventually("the welcome flips the store live") {
            store.sync == .live && store.selfUserId != nil
        }
        let seqBefore = store.seq

        store.placeLetter(cell: 0, value: "Q")
        XCTAssertEqual(store.overlay.count, 1, "the optimistic entry lives until the echo")
        XCTAssertEqual(store.renderValue(0), "Q", "the overlay paints immediately (INV-10)")

        try await eventually("the echo clears the overlay") {
            store.overlay.isEmpty && store.cells[0]?.v == "Q"
        }
        XCTAssertGreaterThan(store.seq, seqBefore, "the cellSet advanced sequenced state")
        XCTAssertEqual(store.cells[0]?.by, store.selfUserId, "the echo names this writer")
        XCTAssertEqual(store.renderValue(0), "Q", "the render now reads sequenced state alone")
    }

    // The Phase I1 exit shape (apps/ios/ROADMAP.md; the M1 exit replayed in Swift): a
    // client places a letter, is killed mid-word, reconnects, and converges, and a
    // second client observes the same board. Reconnect is a fresh hello answered by a
    // welcome snapshot (PROTOCOL.md section 7); convergence is snapshot reconciliation
    // against recentCommandIds (section 8). Both fates of the un-acked command are
    // legal and converge: applied server-side (its id in recentCommandIds drops the
    // entry) or lost with the socket (reconciliation re-sends it, MUST not MAY). The
    // server deduplicates by commandId, so neither fate can double-apply.
    func test_killedMidWordClientReconnectsAndConverges_INV10() async throws {
        let facts = try stackFacts()
        let clientA = try makeClient(facts, token: facts.tokenA)
        let a = clientA.store
        try await eventually("client A is live") { a.sync == .live }

        // First letter of the word, confirmed: its echo lands and clears the entry.
        a.placeLetter(cell: 5, value: "V")
        try await eventually("the first letter is confirmed") {
            a.overlay.isEmpty && a.cells[5]?.v == "V"
        }

        // Mid-word: the second letter is un-acked by construction. Everything from
        // placeLetter to the kill runs synchronously on the main actor, so the
        // store's mailbox cannot interleave an echo before the connection dies.
        a.placeLetter(cell: 6, value: "W")
        XCTAssertFalse(a.overlay.isEmpty, "one command is in flight at the kill")
        clientA.killConnection()

        try await eventually("A reconnects and converges") {
            a.sync == .live && a.overlay.isEmpty
                && a.cells[5]?.v == "V" && a.cells[6]?.v == "W"
        }
        XCTAssertGreaterThanOrEqual(
            clientA.sessions.count, 2, "the driver redialed with a fresh transport")
        XCTAssertEqual(a.renderValue(5), "V", "no lost letter (INV-10)")
        XCTAssertEqual(a.renderValue(6), "W", "no lost or duplicated letter (INV-10)")

        // The collaborative round trip: the second identity in the same game reads the
        // same converged board out of its own welcome snapshot.
        let clientB = try makeClient(facts, token: facts.tokenB)
        let b = clientB.store
        try await eventually("client B is live") { b.sync == .live }
        try await eventually("B observes A's converged word") {
            b.renderValue(5) == "V" && b.renderValue(6) == "W"
        }
        XCTAssertNotEqual(b.selfUserId, a.selfUserId, "two identities, one game")
        XCTAssertTrue(b.overlay.isEmpty, "B wrote nothing, so B pends nothing")
    }
}
