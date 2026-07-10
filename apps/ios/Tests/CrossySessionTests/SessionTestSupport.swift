// Shared plumbing for the CrossySession suites: a scripted socket behind the
// WebSocketing seam (frames without a network; real sockets are Phase I1e's
// integration harness), a stepping fake clock for the driver, a scripted Transport,
// and the wire fixtures borrowed from CrossyProtocolTests via #filePath (the
// VectorRunnerTests/RepoLayout pattern) so both twins pin against the same normative
// PROTOCOL.md samples.

import CrossyProtocol
import CrossyStore
import Foundation
import XCTest

@testable import CrossySession

// MARK: - Wire fixtures (Tests/CrossyProtocolTests/Fixtures/wire, via #filePath)

enum WireFixtures {
    static let root: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossySessionTests
        .deletingLastPathComponent()  // Tests
        .appendingPathComponent("CrossyProtocolTests/Fixtures/wire", isDirectory: true)

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent("\(name).json"))
    }

    static func text(_ name: String) throws -> String {
        String(decoding: try data(name), as: UTF8.self)
    }
}

/// Order-insensitive JSON comparison (key order is not part of the contract,
/// PROTOCOL.md §2 frames are objects): parse both sides to Foundation object graphs.
func assertJSONEqual(
    _ actualText: String,
    fixture name: String,
    file: StaticString = #filePath,
    line: UInt = #line
) throws {
    let actual = try JSONSerialization.jsonObject(with: Data(actualText.utf8)) as! NSObject
    let expected = try JSONSerialization.jsonObject(with: WireFixtures.data(name)) as! NSObject
    XCTAssertEqual(
        actual, expected,
        "frame must reproduce Fixtures/wire/\(name).json",
        file: file, line: line)
}

// MARK: - Scripted socket (the WebSocketing seam)

/// A socket the tests drive frame by frame. Lock-guarded rather than an actor so the
/// synchronous seam methods (`resume`, `close(code:)`) stay synchronous.
final class ScriptedSocket: WebSocketing, @unchecked Sendable {
    enum SocketError: Error {
        case dropped
        case refusedSend
    }

    private let lock = NSLock()
    private var queued: [Result<WebSocketFrame, any Error>] = []
    private var waiters: [CheckedContinuation<WebSocketFrame, any Error>] = []
    private var recordedSends: [String] = []
    private var recordedCloses: [Int] = []
    private var resumes = 0
    private var sendFailure: (any Error)?

    var sentTexts: [String] { lock.withLock { recordedSends } }
    var closedWith: [Int] { lock.withLock { recordedCloses } }
    var resumeCount: Int { lock.withLock { resumes } }

    /// Make every subsequent send throw (dial-failure scripting).
    func refuseSends() {
        lock.withLock { sendFailure = SocketError.refusedSend }
    }

    // MARK: WebSocketing

    func resume() {
        lock.withLock { resumes += 1 }
    }

    func send(text: String) async throws {
        let failure: (any Error)? = lock.withLock {
            if let sendFailure { return sendFailure }
            recordedSends.append(text)
            return nil
        }
        if let failure { throw failure }
    }

    func receive() async throws -> WebSocketFrame {
        try await withCheckedThrowingContinuation { continuation in
            let ready: Result<WebSocketFrame, any Error>? = lock.withLock {
                if queued.isEmpty {
                    waiters.append(continuation)
                    return nil
                }
                return queued.removeFirst()
            }
            if let ready { continuation.resume(with: ready) }
        }
    }

    func close(code: Int) {
        lock.withLock { recordedCloses.append(code) }
        settle(.failure(SocketError.dropped))
    }

    // MARK: Scripting

    func feed(text: String) {
        settle(.success(.text(text)))
    }

    func feed(data: Data) {
        settle(.success(.data(data)))
    }

    /// A server-side or transport drop: the pending (or next) receive throws.
    func drop() {
        settle(.failure(SocketError.dropped))
    }

    private func settle(_ result: Result<WebSocketFrame, any Error>) {
        let waiter: CheckedContinuation<WebSocketFrame, any Error>? = lock.withLock {
            if waiters.isEmpty {
                queued.append(result)
                return nil
            }
            return waiters.removeFirst()
        }
        waiter?.resume(with: result)
    }
}

// MARK: - Transport factory helpers

/// Lock-guarded capture of the transport's observable side effects: sockets minted
/// and log lines emitted (ignore-and-log must be assertable, PROTOCOL.md §3, §11).
final class TransportProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var made = 0
    private var lines: [String] = []
    /// Whether the log closure ever ran on the main thread (AD-3: it must not; the
    /// pump decodes on the transport actor's executor).
    private(set) var loggedOnMainThread = false

    var socketsMade: Int { lock.withLock { made } }
    var logged: [String] { lock.withLock { lines } }

    func recordSocket() {
        lock.withLock { made += 1 }
    }

    func recordLog(_ line: String) {
        let onMain = Thread.isMainThread
        lock.withLock {
            lines.append(line)
            if onMain { loggedOnMainThread = true }
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
struct TransportHarness {
    let transport: WebSocketTransport
    let socket: ScriptedSocket
    let probe: TransportProbe
}

/// A transport wired to one scripted socket with a captured log.
@available(iOS 17.0, macOS 14.0, *)
func makeTransport(
    token: String? = "jwt",
    tokenThrows: Bool = false,
    resumeFromSeq: Int? = nil
) -> TransportHarness {
    let socket = ScriptedSocket()
    let probe = TransportProbe()
    let transport = WebSocketTransport(
        tokenProvider: {
            if tokenThrows { throw ScriptedSocket.SocketError.refusedSend }
            return token
        },
        resumeFromSeq: resumeFromSeq,
        makeSocket: {
            probe.recordSocket()
            return socket
        },
        log: { probe.recordLog($0) })
    return TransportHarness(transport: transport, socket: socket, probe: probe)
}

// MARK: - Stepping fake clock (driver tests)

/// A clock the tests advance by hand. Sleeps suspend until `resumeNext()`, so loops
/// driven by timers (backoff, heartbeat) step deterministically instead of spinning;
/// every requested duration is recorded for assertion. Cancellation-safe: a cancelled
/// sleeper resumes throwing `CancellationError`, like the real clock.
final class FakeClock: SessionClock, @unchecked Sendable {
    private let lock = NSLock()
    private var time: Double = 0
    private var requested: [Double] = []
    private var waiters: [(id: Int, continuation: CheckedContinuation<Void, any Error>)] = []
    private var cancelledIds: Set<Int> = []
    private var nextId = 0

    /// Every sleep duration ever requested, in request order.
    var sleeps: [Double] { lock.withLock { requested } }
    /// How many sleepers are currently suspended.
    var waiterCount: Int { lock.withLock { waiters.count } }

    func advance(by seconds: Double) {
        lock.withLock { time += seconds }
    }

    /// Resume the oldest suspended sleeper.
    func resumeNext() {
        let waiter: CheckedContinuation<Void, any Error>? = lock.withLock {
            waiters.isEmpty ? nil : waiters.removeFirst().continuation
        }
        waiter?.resume(returning: ())
    }

    // MARK: SessionClock

    func now() -> Double {
        lock.withLock { time }
    }

    func sleep(seconds: Double) async throws {
        let id: Int = lock.withLock {
            nextId += 1
            requested.append(seconds)
            return nextId
        }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                let alreadyCancelled: Bool = lock.withLock {
                    if cancelledIds.contains(id) { return true }
                    waiters.append((id, continuation))
                    return false
                }
                if alreadyCancelled { continuation.resume(throwing: CancellationError()) }
            }
        } onCancel: {
            let waiter: CheckedContinuation<Void, any Error>? = lock.withLock {
                cancelledIds.insert(id)
                guard let index = waiters.firstIndex(where: { $0.id == id }) else { return nil }
                return waiters.remove(at: index).continuation
            }
            waiter?.resume(throwing: CancellationError())
        }
    }
}

// MARK: - Scripted Transport (driver tests exercise the port, not the socket)

/// A Transport whose connect outcome and inbound frames are scripted; records sends
/// and closes. An actor, so recording is data-race free under Swift 6 (the
/// GameStoreTests RecordingTransport pattern, plus connect scripting).
@available(iOS 17.0, macOS 14.0, *)
actor ScriptedTransport: Transport {
    enum ConnectOutcome {
        case succeed
        case fail(any Error)
    }

    nonisolated let inbound: AsyncStream<ServerMessage>
    private nonisolated let continuation: AsyncStream<ServerMessage>.Continuation
    private let outcome: ConnectOutcome
    private(set) var sent: [ClientMessage] = []
    private(set) var closeCalls = 0
    private(set) var connectCalls = 0

    var sentCount: Int { sent.count }

    init(connect outcome: ConnectOutcome = .succeed) {
        let (stream, continuation) = AsyncStream<ServerMessage>.makeStream()
        self.inbound = stream
        self.continuation = continuation
        self.outcome = outcome
    }

    func connect() async throws {
        connectCalls += 1
        if case .fail(let error) = outcome {
            continuation.finish()
            throw error
        }
    }

    func send(_ message: ClientMessage) async {
        sent.append(message)
    }

    func close() async {
        closeCalls += 1
        continuation.finish()
    }

    nonisolated func deliver(_ message: ServerMessage) {
        continuation.yield(message)
    }

    nonisolated func finish() {
        continuation.finish()
    }
}

/// Hands the driver one scripted transport per dial; once the script is exhausted,
/// every further attempt throws signed-out so the loop ends deterministically.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class TransportScript {
    private var queue: [ScriptedTransport]
    private(set) var made: [ScriptedTransport] = []

    init(_ transports: [ScriptedTransport]) {
        queue = transports
    }

    func next() -> any Transport {
        let transport =
            queue.isEmpty
            ? ScriptedTransport(connect: .fail(WebSocketTransportError.signedOut))
            : queue.removeFirst()
        made.append(transport)
        return transport
    }
}

// MARK: - Cooperative waiting (the GameStoreTests pattern)

/// Cooperatively wait for a condition driven by the suites' own tasks. The bound only
/// exists to fail loudly instead of hanging. MainActor because its callers (the driver
/// suite) and everything they poll share the main actor.
@MainActor
func waitUntil(
    _ what: String,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ condition: () async -> Bool
) async throws {
    for _ in 0..<10_000 {
        if await condition() { return }
        await Task.yield()
    }
    XCTFail("timed out waiting until \(what)", file: file, line: line)
    throw CancellationError()
}
