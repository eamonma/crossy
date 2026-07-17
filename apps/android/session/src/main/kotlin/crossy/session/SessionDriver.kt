// The connection driver (AD-6): dial, run the store's mailbox over the socket, sleep the policy's
// delay, redial. Kotlin twin of apps/ios/Sources/CrossySession/SessionDriver.swift. Every number
// it acts on is the store's decision: delays come from `GameStore.nextReconnectDelaySeconds()` (the
// §7 walk with the store's injected jitter), survival is reported back through
// `connectionSurvived(seconds)` so the schedule resets, and the heartbeat interval is
// `ReconnectPolicy.heartbeatIntervalSeconds` (PROTOCOL.md §5, §9). The driver decides nothing the
// policy does not dictate; it only sleeps, jitters, and dials.

package crossy.session

import crossy.store.GameStore
import crossy.store.ReconnectPolicy
import crossy.store.Transport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Owns the retry loop for one game connection. Confined to the store's dispatcher by the
 * composition root (the sleeps are suspensions, never thread blocks, and the socket work happens
 * on OkHttp's own threads, AAD-2).
 *
 * [makeTransport] mints one transport per attempt (Ports.kt: one value, one connection attempt),
 * so every redial is a fresh dial with a fresh token.
 *
 * [onReconnectScheduled] fires as each backoff sleep begins, with the wall-clock instant (epoch
 * millis) the next dial is due (now plus the policy delay the store just decided). The composition
 * root feeds it to the room chrome's reconnect countdown (DESIGN.md §8). The store owns the delay
 * (AD-6); the driver owns the clock, so the deadline is computed here and never in the store, which
 * holds no clock. Null by default: previews and vector tests want no deadline.
 */
public class SessionDriver(
    private val store: GameStore,
    private val clock: SessionClock = MonotonicSessionClock(),
    private val onReconnectScheduled: ((deadlineEpochMillis: Long) -> Unit)? = null,
    private val makeTransport: () -> Transport,
) {
    /**
     * The loop: dial immediately, run the store's mailbox until the inbound flow completes (the
     * drop, PROTOCOL.md §7), report survival, sleep the policy's next delay, redial. Returns on
     * cancellation (deliberate teardown, closing the live socket with 1000) or when the token
     * provider says signed out (the web transport's stop-not-busy-loop posture, mirrored).
     */
    public suspend fun run(): Unit = coroutineScope {
        while (true) {
            val transport = makeTransport()
            try {
                transport.connect()
            } catch (e: CancellationException) {
                throw e
            } catch (_: WebSocketTransportException.SignedOut) {
                // Signed out: stop rather than hammer hellos the server would refuse with
                // UNAUTHORIZED. A fresh sign-in starts a new driver.
                return@coroutineScope
            } catch (_: Throwable) {
                // The attempt never opened, so it never reports survival: a failed dial must not
                // reset the walk, or a long outage would busy-loop at 0 s against a dead server
                // (the web onclose guard, mirrored).
                backoffSleep()
                continue
            }

            val openedAt = clock.now()
            val heartbeat = launch { pumpHeartbeat() }
            try {
                // Returns when the inbound flow completes: the drop signal (Ports.kt).
                store.run(transport)
            } catch (e: CancellationException) {
                // Deliberate teardown mid-connection: close the live socket with 1000 (PROTOCOL.md
                // §2), even though we are unwinding. The heartbeat dies with the connection.
                heartbeat.cancel()
                withContext(NonCancellable) { transport.close() }
                throw e
            }
            heartbeat.cancel()
            // The duration arrives at the store as data; 30 s or more resets the schedule there,
            // never here (PROTOCOL.md §7; AD-6).
            store.connectionSurvived(clock.now() - openedAt)
            backoffSleep()
        }
    }

    /**
     * Consume one policy delay and sleep it. The retry deadline is published as the sleep begins
     * (now plus the delay), so the countdown chrome reads a stable instant, not a shrinking
     * duration. Cancellation propagates out of the sleep and ends the loop (a deliberate stop).
     */
    private suspend fun backoffSleep() {
        val seconds = store.nextReconnectDelaySeconds()
        onReconnectScheduled?.invoke(System.currentTimeMillis() + (seconds * 1000.0).toLong())
        clock.sleep(seconds)
    }

    /**
     * Heartbeat every 15 s while the socket is live (PROTOCOL.md §5, §9). The interval is the
     * policy's number; the frame goes through the store so the one ordered outbound path holds.
     * Cancelled with the connection.
     */
    private suspend fun pumpHeartbeat() {
        while (true) {
            clock.sleep(ReconnectPolicy.heartbeatIntervalSeconds)
            store.heartbeat()
        }
    }
}
