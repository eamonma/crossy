// The connection driver (AD-6): dial, run the store's mailbox over the socket, sleep
// the policy's delay, redial. Every number it acts on is the store's decision: delays
// come from `GameStore.nextReconnectDelaySeconds()` (the §7 walk with the policy's
// injected jitter), survival is reported back through `connectionSurvived(seconds:)`
// so the schedule resets, and the heartbeat interval is
// `ReconnectPolicy.heartbeatIntervalSeconds` (PROTOCOL.md §5, §9). The driver decides
// nothing the policy does not dictate; it only sleeps, jitters, and dials.

import CrossyStore
import Foundation

/// Owns the retry loop for one game connection. `@MainActor` because everything it
/// coordinates with (the store's policy and mailbox) is; the sleeps are suspensions,
/// never main-thread blocks, and the socket work happens inside the transport's own
/// actor (AD-3).
@available(iOS 17.0, macOS 14.0, *)
@MainActor
public final class SessionDriver {
    private let store: GameStore
    private let clock: any SessionClock
    private let onBackoffSleep: ((Double) -> Void)?
    private let makeTransport: () -> any Transport

    /// `makeTransport` mints one transport per attempt (Ports.swift: one value, one
    /// connection attempt), so every redial is a fresh dial with a fresh token.
    ///
    /// `onBackoffSleep` fires with each backoff delay just before the driver sleeps
    /// it, so a composition root can surface the next-dial deadline (the DESIGN.md §8
    /// quiet countdown, `RoomChromeModel.reconnectRetryAt`). Purely observational:
    /// the delay is still the store's decision, and the driver still only sleeps and
    /// dials (AD-6). This parameter is the minimal I2-exit surface the countdown
    /// wiring needed; nothing else in this class changed.
    public init(
        store: GameStore,
        clock: any SessionClock = ContinuousSessionClock(),
        onBackoffSleep: ((Double) -> Void)? = nil,
        makeTransport: @escaping () -> any Transport
    ) {
        self.store = store
        self.clock = clock
        self.onBackoffSleep = onBackoffSleep
        self.makeTransport = makeTransport
    }

    /// The loop: dial immediately, run the store's mailbox until the inbound stream
    /// finishes (the drop, PROTOCOL.md §7), report survival, sleep the policy's next
    /// delay, redial. Returns on task cancellation (deliberate teardown, closing the
    /// live socket with 1000) or when the token provider says signed out (the web
    /// transport's stop-not-busy-loop posture, mirrored).
    public func run() async {
        while !Task.isCancelled {
            let transport = makeTransport()
            do {
                try await transport.connect()
            } catch is CancellationError {
                return
            } catch WebSocketTransportError.signedOut {
                // Signed out: stop rather than hammer hellos the server would refuse
                // with UNAUTHORIZED. A fresh sign-in starts a new driver.
                return
            } catch {
                // The attempt never opened, so it never reports survival: a failed
                // dial must not reset the walk, or a long outage would busy-loop at
                // 0 s against a dead server (the web onclose guard, mirrored).
                guard await backoffSleep() else { return }
                continue
            }

            let openedAt = clock.now()
            let heartbeat = Task { await self.pumpHeartbeat() }
            // Returns when the inbound stream finishes: the drop signal (Ports.swift).
            await store.run(transport)
            heartbeat.cancel()
            // The duration arrives at the store as data; 30 s or more resets the
            // schedule there, never here (PROTOCOL.md §7; AD-6).
            store.connectionSurvived(seconds: clock.now() - openedAt)

            if Task.isCancelled {
                await transport.close()  // deliberate teardown: 1000 (PROTOCOL.md §2)
                return
            }
            guard await backoffSleep() else { return }
        }
    }

    /// Consume one policy delay and sleep it. False means the sleep was cancelled:
    /// a deliberate stop, so the caller returns instead of redialing.
    private func backoffSleep() async -> Bool {
        let seconds = store.nextReconnectDelaySeconds()
        onBackoffSleep?(seconds)
        do {
            try await clock.sleep(seconds: seconds)
            return true
        } catch {
            return false
        }
    }

    /// Heartbeat every 15 s while the socket is live (PROTOCOL.md §5, §9). The
    /// interval is the policy's number; the frame goes through the store so the one
    /// ordered outbound path holds. Cancelled with the connection.
    private func pumpHeartbeat() async {
        while !Task.isCancelled {
            do {
                try await clock.sleep(seconds: ReconnectPolicy.heartbeatIntervalSeconds)
            } catch {
                return
            }
            store.heartbeat()
        }
    }
}
