// The store's ports (ARCHITECTURE.md §4): protocols defined here in the inner ring,
// naming exactly what the store needs; adapters implement them outward. Only the
// transport exists yet — further effect ports (haptics, celebration, tokens) land with
// the phases that need them, never speculatively.

import CrossyProtocol

/// The transport port (AD-6): connect, an `AsyncStream` of inbound frames, async send,
/// close. `CrossySession` implements it over `URLSessionWebSocketTask` (Phase I1c).
///
/// One `Transport` value serves one connection attempt. `connect()` dials and completes
/// the hello/welcome handshake; `inbound` then yields codec-decoded frames in arrival
/// order (the welcome included) and finishes when the socket closes, which is the drop
/// signal the store's mailbox turns into `reconnecting` (PROTOCOL.md §7). The adapter
/// decodes JSON off the main actor and delivers typed messages (AD-3); a malformed
/// frame is drop-and-log inside the adapter (PROTOCOL.md §11), never delivered.
///
/// `send` is best-effort by design: an implementation may drop the frame when no socket
/// is open, because a dropped mutation stays in the overlay and snapshot reconciliation
/// re-sends it, and the server drops duplicate `commandId`s silently (PROTOCOL.md §1,
/// §8). Reconnect decisions — which state, which attempt, what delay — are pure store
/// code (`BackoffSchedule`); the adapter only sleeps, jitters, and dials (AD-6).
@available(iOS 17.0, macOS 14.0, *)
public protocol Transport: Sendable {
    /// Dial and complete the handshake; throws when the attempt fails.
    func connect() async throws
    /// Inbound frames in arrival order; finishes when the socket closes.
    var inbound: AsyncStream<ServerMessage> { get }
    /// Best-effort delivery of one client-to-server frame.
    func send(_ message: ClientMessage) async
    /// Deliberate teardown (close code 1000).
    func close() async
}
