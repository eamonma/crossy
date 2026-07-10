// The store's Transport port over a WebSocket (Ports.swift; PROTOCOL.md §2, §3, §7,
// §11). One value serves one connection attempt: `connect()` resolves a fresh token,
// dials, and sends the mandatory first `hello`; `inbound` then yields codec-decoded
// frames in arrival order (the welcome included) and finishes when the socket closes,
// which is the drop signal the store's mailbox consumes. An actor, so JSON encode and
// decode run on its own executor, never the main actor (AD-3): the stream delivers
// typed values only. Behavior mirrors apps/web/src/net/wsTransport.ts where PROTOCOL.md
// leaves room; where they disagree, PROTOCOL.md wins.

import CrossyProtocol
import CrossyStore
import Foundation

/// Why an attempt failed before the socket was live.
public enum WebSocketTransportError: Error {
    /// The token provider returned nil (or threw): signed out. Dialing would only earn
    /// UNAUTHORIZED, so the caller stops rather than redials (the web transport's
    /// posture, mirrored: a throwing provider folds to signed-out there too).
    case signedOut
    /// `connect()` on a transport that already dialed or was closed. One value, one
    /// attempt (Ports.swift); redialing means a fresh transport.
    case alreadyUsed
    /// The dial or the hello send failed; retryable through the store's backoff walk.
    case dialFailed(underlying: any Error)
}

/// The `URLSessionWebSocketTask` transport (AD-2, AD-6). It moves frames and nothing
/// else: reconnect decisions stay in `CrossyStore` (`BackoffSchedule`), and the
/// `SessionDriver` executes them.
@available(iOS 17.0, macOS 14.0, *)
public actor WebSocketTransport: Transport {
    private enum State: Equatable {
        case idle
        case dialing
        case open
        case closed
    }

    /// Inbound frames in arrival order; finishes when the socket closes (the drop
    /// signal, PROTOCOL.md §7).
    public nonisolated let inbound: AsyncStream<ServerMessage>
    private nonisolated let deliveries: AsyncStream<ServerMessage>.Continuation

    private let tokenProvider: @Sendable () async throws -> String?
    private let resumeFromSeq: Int?
    private let makeSocket: @Sendable () -> any WebSocketing
    private let log: @Sendable (String) -> Void

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var state: State = .idle
    private var socket: (any WebSocketing)?
    private var pumpTask: Task<Void, Never>?

    /// The production entry point: dial `wss://{session-host}/games/{gameId}/ws`
    /// (PROTOCOL.md §2). `tokenProvider` is resolved fresh inside `connect()`, so a
    /// reconnect's transport never reuses an expired token; nil means signed out.
    /// `resumeFromSeq` is optional and informational (§2): the caller passes the
    /// store's last applied seq, or nothing.
    public init(
        url: URL,
        tokenProvider: @escaping @Sendable () async throws -> String?,
        resumeFromSeq: Int? = nil,
        session: URLSession = .shared
    ) {
        self.init(
            tokenProvider: tokenProvider,
            resumeFromSeq: resumeFromSeq,
            makeSocket: { URLSessionWebSocket(session.webSocketTask(with: url)) },
            log: { NSLog("%@", $0) })
    }

    /// The seam init: tests inject a scripted socket and capture the log
    /// (ignore-and-log must be observable, PROTOCOL.md §3).
    init(
        tokenProvider: @escaping @Sendable () async throws -> String?,
        resumeFromSeq: Int?,
        makeSocket: @escaping @Sendable () -> any WebSocketing,
        log: @escaping @Sendable (String) -> Void
    ) {
        let (stream, continuation) = AsyncStream<ServerMessage>.makeStream()
        self.inbound = stream
        self.deliveries = continuation
        self.tokenProvider = tokenProvider
        self.resumeFromSeq = resumeFromSeq
        self.makeSocket = makeSocket
        self.log = log
    }

    // MARK: - Transport

    /// Dial and open the §2 handshake: resolve a fresh token, resume the socket, send
    /// `hello` as the first frame, then start delivering everything inbound through
    /// `inbound`. The welcome arrives through the stream like every other frame; a
    /// handshake the server refuses (fatal error, close 1008) surfaces as the error
    /// frame followed by the stream finishing, exactly the drop path (§7, §11).
    public func connect() async throws {
        guard state == .idle else { throw WebSocketTransportError.alreadyUsed }
        state = .dialing

        // The web transport folds a throwing provider into signed-out; mirrored.
        let token = try? await tokenProvider()
        guard let token else {
            state = .closed
            deliveries.finish()
            throw WebSocketTransportError.signedOut
        }
        guard state == .dialing else { throw WebSocketTransportError.alreadyUsed }

        let socket = makeSocket()
        socket.resume()
        let hello = ClientMessage.hello(
            HelloMessage(
                protocolVersion: ProtocolVersion.current,
                token: token,
                resumeFromSeq: resumeFromSeq))
        do {
            // The first frame MUST be hello (PROTOCOL.md §2). `send(_:)` drops frames
            // until `self.socket` is set below, so nothing can overtake it.
            try await socket.send(text: encodeFrame(hello))
        } catch {
            state = .closed
            socket.close(code: 1000)
            deliveries.finish()
            throw WebSocketTransportError.dialFailed(underlying: error)
        }

        self.socket = socket
        state = .open
        pumpTask = Task { await self.pump(socket) }
    }

    /// Best-effort by design (Ports.swift): no open socket, or a mid-flight send
    /// failure, drops the frame; the overlay plus snapshot reconciliation recover any
    /// mutation (PROTOCOL.md §8). Encoding happens here on the actor, off-main (AD-3).
    public func send(_ message: ClientMessage) async {
        guard state == .open, let socket else { return }
        let text: String
        do {
            text = try encodeFrame(message)
        } catch {
            // A CrossyProtocol message cannot realistically fail to encode; kept
            // honest rather than force-tried (the CrossyAPI precedent).
            log("CrossySession: dropped an unencodable \(message.type) frame")
            return
        }
        do {
            try await socket.send(text: text)
        } catch {
            log("CrossySession: dropped a \(message.type) frame; the socket refused it")
        }
    }

    /// Deliberate teardown: close code 1000 (PROTOCOL.md §2), stream finished. No
    /// reconnect follows because the driver, not this value, owns redialing.
    public func close() async {
        guard state != .closed else { return }
        state = .closed
        socket?.close(code: 1000)
        socket = nil
        deliveries.finish()
        pumpTask?.cancel()
        pumpTask = nil
    }

    // MARK: - Inbound pump (the adapter's own task: decode off-main, AD-3)

    private func pump(_ socket: any WebSocketing) async {
        while true {
            let frame: WebSocketFrame
            do {
                frame = try await socket.receive()
            } catch {
                break  // closed or dropped either way: the finish below is the signal
            }
            deliver(frame)
        }
        // The stream finishing IS the drop signal the store turns into reconnecting
        // (Ports.swift; PROTOCOL.md §7). Idempotent when close() already finished it.
        deliveries.finish()
    }

    private func deliver(_ frame: WebSocketFrame) {
        let data: Data
        switch frame {
        case .text(let text): data = Data(text.utf8)
        case .data(let bytes): data = bytes
        }
        do {
            deliveries.yield(try decoder.decode(ServerMessage.self, from: data))
        } catch WireDecodingError.unknownType(let type) {
            // A recognizable-but-unknown type: ignore and log, never crash
            // (PROTOCOL.md §3). Distinct from malformed below by construction.
            log("CrossySession: ignored a frame of unknown type \"\(type)\" (PROTOCOL.md section 3)")
        } catch {
            // Not JSON, or no usable `type`, or a known type with a broken body:
            // drop and log (PROTOCOL.md §11); never delivered.
            log("CrossySession: dropped a malformed frame (PROTOCOL.md section 11)")
        }
    }

    private func encodeFrame(_ message: ClientMessage) throws -> String {
        // One JSON object per text frame, UTF-8 (PROTOCOL.md §2).
        String(decoding: try encoder.encode(message), as: UTF8.self)
    }
}
