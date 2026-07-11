// CrossySession (AD-2: adapter; imports CrossyStore, CrossyProtocol, Foundation). Two
// pieces, split on AD-6's line. `WebSocketTransport` implements the store's Transport
// port over `URLSessionWebSocketTask`: hello first (PROTOCOL.md §2), typed delivery of
// decoded `ServerMessage`s off the main actor (AD-3), drop-and-log for malformed frames
// (§11) and ignore-and-log for unknown types (§3). `SessionDriver` owns the
// dial-run-sleep-redial loop and the 15 s heartbeat timer, executing exactly the
// numbers the store's policy decides (`BackoffSchedule` delays with the policy's
// injected jitter, `ReconnectPolicy.heartbeatIntervalSeconds`). Reconnect decisions
// live in CrossyStore where the vectors pin them; this target only sleeps, jitters,
// and dials (AD-6).
