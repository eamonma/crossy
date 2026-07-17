// The store's ports (ARCHITECTURE.md AAD-1, mirrors AD-6/§4): interfaces defined here in the
// inner ring, naming exactly what the store needs; adapters implement them outward. Kotlin twin
// of apps/ios/Sources/CrossyStore/Ports.swift. INV-9's ethos applied one ring out: nothing here
// names an Android type, a socket, or a clock, so the store stays JVM-pure and headlessly
// testable (AAD-2). The composition root wires the concrete adapters into a store and owns
// nothing else of substance.

package crossy.store

import crossy.protocol.ClientMessage
import crossy.protocol.ServerMessage
import kotlinx.coroutines.flow.Flow

/**
 * The transport port (AD-6, AAD-2): connect, a Flow of inbound frames, suspend send, close.
 * `CrossySession`'s OkHttp adapter (:session) implements it over a WebSocket.
 *
 * One `Transport` value serves one connection attempt. `connect()` dials and completes the
 * hello/welcome handshake; `inbound` then yields codec-decoded frames in arrival order (the
 * welcome included) and completes when the socket closes, which is the drop signal the store's
 * mailbox turns into `reconnecting` (PROTOCOL.md §7). The adapter decodes JSON off the confining
 * dispatcher and delivers typed messages (AAD-2); a malformed frame is drop-and-log inside the
 * adapter (PROTOCOL.md §11), never delivered.
 *
 * `send` is best-effort by design: an implementation may drop the frame when no socket is open,
 * because a dropped mutation stays in the overlay and snapshot reconciliation re-sends it, and the
 * server drops duplicate `commandId`s silently (PROTOCOL.md §1, §8). Reconnect decisions (which
 * state, which attempt, what delay) are pure store code (`BackoffSchedule`); the adapter only
 * sleeps, jitters, and dials (AD-6).
 */
interface Transport {
    /** Dial and complete the handshake; throws when the attempt fails. */
    suspend fun connect()

    /** Inbound frames in arrival order; completes when the socket closes. */
    val inbound: Flow<ServerMessage>

    /** Best-effort delivery of one client-to-server frame. */
    suspend fun send(message: ClientMessage)

    /** Deliberate teardown (close code 1000). */
    suspend fun close()
}

/**
 * The token port (§4): an async current-token accessor, the Android analog of the iOS
 * `TokenProvider`. `CrossyAPI` (:api) implements it over the Keystore session, honoring the
 * pinned ref-domain issuer (deploy/README.md). The socket dial is the adapter's job, so the store
 * itself does not read a token in v1; the port is declared here (the inner ring names what the
 * adapters need) so the composition root can wire it where the connect path needs it, exactly as
 * the iOS Ports comment records it landing with the phase that needs it.
 */
interface TokenProvider {
    /** The current bearer token, or null when the session is signed out. */
    suspend fun currentToken(): String?
}

/**
 * Effect requests behind a thin port (§4) so the store can ask for a haptic tick or a celebration
 * without importing the Android framework, and tests can assert the request without a device. The
 * store detects the triggers the vectors deliberately exclude as ephemeral view concerns (the
 * conflict flash, PROTOCOL.md §8/D02; completion); the composition root routes those triggers to
 * this port. Keeping it an interface here keeps the store JVM-pure (AAD-2).
 */
interface Effects {
    /** A one-shot haptic; the adapter maps `kind` to the platform generator. */
    fun haptic(kind: Haptic)
}

/** The haptic vocabulary the store speaks in plain values (no Android type crosses the fence). */
enum class Haptic {
    SELECTION,
    SUCCESS,
    WARNING,
}
