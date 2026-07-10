// The raw-socket seam. `WebSocketTransport` speaks this small internal protocol rather
// than `URLSessionWebSocketTask` directly, so unit tests script frames without a
// network (the web transport's `createSocket` injection, mirrored); the real socket
// round trip is Phase I1e's integration harness. The shape is the task's own surface,
// trimmed to what the transport uses: resume, async send/receive, cancel-with-code.

import Foundation

/// One inbound WebSocket frame. The protocol frames one JSON object per text frame
/// (PROTOCOL.md §2); a data frame still carries bytes the decoder can try, so both
/// arrive here and the transport judges them by content, exactly as the web client's
/// `JSON.parse(String(event.data))` does.
enum WebSocketFrame: Sendable, Equatable {
    case text(String)
    case data(Data)
}

/// What the transport needs from a socket. One value per dial, like
/// `URLSessionWebSocketTask` itself.
protocol WebSocketing: Sendable {
    /// Start dialing. Errors surface on the first send/receive, not here.
    func resume()
    /// Send one text frame; throws when the socket is not (or no longer) open.
    func send(text: String) async throws
    /// The next inbound frame; throws when the socket closes or drops.
    func receive() async throws -> WebSocketFrame
    /// Close with a WebSocket close code (PROTOCOL.md §2: 1000 normal).
    func close(code: Int)
}

/// The real socket: a thin wrapper keeping `URLSessionWebSocketTask` behind the seam.
/// `@unchecked Sendable` because `URLSessionTask` is documented thread-safe and the
/// wrapper holds nothing else.
@available(iOS 17.0, macOS 14.0, *)
final class URLSessionWebSocket: WebSocketing, @unchecked Sendable {
    private let task: URLSessionWebSocketTask

    init(_ task: URLSessionWebSocketTask) {
        self.task = task
    }

    func resume() {
        task.resume()
    }

    func send(text: String) async throws {
        try await task.send(.string(text))
    }

    func receive() async throws -> WebSocketFrame {
        while true {
            switch try await task.receive() {
            case .string(let text): return .text(text)
            case .data(let data): return .data(data)
            @unknown default: continue  // a frame kind this SDK build does not name: skip
            }
        }
    }

    func close(code: Int) {
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
        task.cancel(with: closeCode, reason: nil)
    }
}
