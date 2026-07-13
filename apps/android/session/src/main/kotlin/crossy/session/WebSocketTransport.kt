// The store's Transport port over an OkHttp WebSocket (Ports.kt; PROTOCOL.md §2, §3, §7, §11).
// Kotlin twin of apps/ios/Sources/CrossySession/WebSocketTransport.swift, on OkHttp instead of
// URLSessionWebSocketTask. One value serves one connection attempt: `connect()` resolves a fresh
// token, dials, waits for the socket to open, and sends the mandatory first `hello`; `inbound`
// then yields codec-decoded frames in arrival order (the welcome included) and completes when the
// socket closes, which is the drop signal the store's mailbox consumes (GameStore.run). OkHttp
// runs the listener callbacks on its own dispatcher, so JSON decode and the ignore/drop logging
// happen off the store's confining dispatcher (AAD-2). Behavior mirrors the Swift twin and, where
// PROTOCOL.md leaves room, apps/web/src/net/wsTransport.ts; where they disagree, PROTOCOL.md wins.

package crossy.session

import crossy.protocol.ClientMessage
import crossy.protocol.HelloMessage
import crossy.protocol.ProtocolVersion
import crossy.protocol.ServerMessage
import crossy.protocol.ServerMessageSerializer
import crossy.protocol.WireDecodingException
import crossy.store.Transport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

/**
 * Why an attempt failed before the socket was live. Retryable failures flow through the store's
 * backoff walk (the driver catches and sleeps); [SignedOut] is a deliberate stop.
 */
public sealed class WebSocketTransportException(message: String, cause: Throwable? = null) :
    Exception(message, cause) {
    /**
     * The token provider returned null (or threw): signed out. Dialing would only earn
     * UNAUTHORIZED, so the driver stops rather than redials (the web transport's posture,
     * mirrored: a throwing provider folds to signed-out there too).
     */
    public object SignedOut :
        WebSocketTransportException("signed out; no token, so no dial (PROTOCOL.md §2)") {
        private fun readResolve(): Any = SignedOut
    }

    /**
     * `connect()` on a transport that already dialed or was closed. One value, one attempt
     * (Ports.kt); redialing means a fresh transport.
     */
    public object AlreadyUsed :
        WebSocketTransportException("one Transport value serves one connection attempt (Ports.kt)") {
        private fun readResolve(): Any = AlreadyUsed
    }

    /** The dial or the hello send failed; retryable through the store's backoff walk. */
    public class DialFailed(cause: Throwable) :
        WebSocketTransportException("the dial or the hello send failed (PROTOCOL.md §2, §7)", cause)
}

/**
 * The OkHttp WebSocket transport (AAD-2, AD-6). It moves frames and nothing else: reconnect
 * decisions stay in `crossy.store` (`BackoffSchedule`), and [SessionDriver] executes them.
 */
public class WebSocketTransport(
    url: String,
    private val tokenProvider: suspend () -> String?,
    private val resumeFromSeq: Int? = null,
    private val client: OkHttpClient = sharedClient,
    private val json: Json = crossy.protocol.ProtocolJson,
    private val log: (String) -> Unit = ::defaultLog,
) : Transport {
    private enum class State { IDLE, DIALING, OPEN, CLOSED }

    // Unbounded so an OkHttp listener thread never blocks handing a frame to the store's
    // dispatcher; the AsyncStream on the Swift side is likewise unbounded. Closed (no cause) on a
    // drop or a deliberate close, so `inbound` completes normally: the §7 drop signal.
    private val inboundChannel = Channel<ServerMessage>(Channel.UNLIMITED)

    /** Inbound frames in arrival order; completes when the socket closes (Ports.kt; PROTOCOL.md §7). */
    override val inbound: Flow<ServerMessage> = inboundChannel.receiveAsFlow()

    // Touched by the driver dispatcher (connect/send/close) and OkHttp listener threads
    // (onClosed/onFailure); @Volatile carries the visibility, and every race is benign (a lost
    // send is best-effort by design, Ports.kt).
    @Volatile private var state: State = State.IDLE
    @Volatile private var socket: WebSocket? = null

    private val httpUrl: String = toHttpUrl(url)

    // MARK: - Transport

    /**
     * Dial and open the §2 handshake: resolve a fresh token, connect the socket, and once it is
     * open send `hello` as the first frame. The welcome arrives through `inbound` like every other
     * frame; a handshake the server refuses (fatal error, close 1008) surfaces as the error frame
     * followed by `inbound` completing, exactly the drop path (§7, §11). Throws before opening when
     * the token is absent ([SignedOut]) or the dial fails ([DialFailed]); one value, one attempt.
     */
    override suspend fun connect() {
        if (state != State.IDLE) throw WebSocketTransportException.AlreadyUsed
        state = State.DIALING

        // The web transport folds a throwing provider into signed-out; mirrored (a real cancel
        // still propagates).
        val token =
            try {
                tokenProvider()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                null
            }
        if (token == null) {
            state = State.CLOSED
            inboundChannel.close()
            throw WebSocketTransportException.SignedOut
        }

        val opened = CompletableDeferred<Unit>()
        val request = Request.Builder().url(httpUrl).build()
        val ws =
            client.newWebSocket(
                request,
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        opened.complete(Unit)
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        deliver(text)
                    }

                    // A data frame still carries bytes the decoder can try, so it decodes by
                    // content like a text frame (the web client's JSON.parse of event.data).
                    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                        deliver(bytes.utf8())
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        // The server initiated a close: complete the handshake, then finish the
                        // stream. Finishing IS the drop signal the store turns into reconnecting.
                        state = State.CLOSED
                        webSocket.close(NORMAL_CLOSE, null)
                        inboundChannel.close()
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        state = State.CLOSED
                        inboundChannel.close()
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        // Before open: the dial failed. After open: a mid-connection drop. Either
                        // way the stream finishes and the driver redials through the backoff walk.
                        state = State.CLOSED
                        if (!opened.isCompleted) opened.completeExceptionally(t)
                        inboundChannel.close()
                    }
                },
            )
        socket = ws

        try {
            opened.await()
        } catch (e: CancellationException) {
            ws.cancel()
            throw e
        } catch (t: Throwable) {
            state = State.CLOSED
            ws.cancel()
            inboundChannel.close()
            throw WebSocketTransportException.DialFailed(t)
        }

        // The first frame MUST be hello (PROTOCOL.md §2). Nothing is sent before this because
        // `send` drops frames until the state is OPEN below.
        val hello =
            ClientMessage.Hello(
                HelloMessage(
                    protocolVersion = ProtocolVersion.CURRENT,
                    token = token,
                    resumeFromSeq = resumeFromSeq,
                ),
            )
        if (!ws.send(encodeFrame(hello))) {
            state = State.CLOSED
            ws.cancel()
            inboundChannel.close()
            throw WebSocketTransportException.DialFailed(
                IllegalStateException("the socket refused the hello frame"),
            )
        }
        state = State.OPEN
    }

    /**
     * Best-effort by design (Ports.kt): no open socket, or a send OkHttp refuses, drops the frame;
     * the overlay plus snapshot reconciliation recover any mutation (PROTOCOL.md §8). Encoding
     * happens here, off the store's dispatcher (AAD-2).
     */
    override suspend fun send(message: ClientMessage) {
        if (state != State.OPEN) return
        val ws = socket ?: return
        val text =
            try {
                encodeFrame(message)
            } catch (_: Throwable) {
                // A crossy.protocol message cannot realistically fail to encode; kept honest
                // rather than force-encoded (the CrossyAPI precedent).
                log("CrossySession: dropped an unencodable ${message.type} frame")
                return
            }
        if (!ws.send(text)) {
            log("CrossySession: dropped a ${message.type} frame; the socket refused it")
        }
    }

    /**
     * Deliberate teardown: close code 1000 (PROTOCOL.md §2), stream finished. No reconnect follows
     * because the driver, not this value, owns redialing.
     */
    override suspend fun close() {
        if (state == State.CLOSED) return
        state = State.CLOSED
        socket?.close(NORMAL_CLOSE, null)
        socket = null
        inboundChannel.close()
    }

    // MARK: - Inbound decode (on OkHttp's listener thread: off the store's dispatcher, AAD-2)

    private fun deliver(text: String) {
        val message =
            try {
                json.decodeFromString(ServerMessageSerializer, text)
            } catch (e: WireDecodingException.UnknownType) {
                // A recognizable-but-unknown type (forward compatibility): ignore and log, never
                // crash (PROTOCOL.md §3). Distinct from malformed by the codec's error type.
                log(
                    "CrossySession: ignored a frame of unknown type \"${e.wireType}\" " +
                        "(PROTOCOL.md §3)",
                )
                return
            } catch (_: Throwable) {
                // Not JSON, or no usable `type`, or a known type with a broken body: drop and log
                // (PROTOCOL.md §11); never delivered.
                log("CrossySession: dropped a malformed frame (PROTOCOL.md §11)")
                return
            }
        // trySend never blocks (unbounded) and silently no-ops once the channel is closed.
        inboundChannel.trySend(message)
    }

    private fun encodeFrame(message: ClientMessage): String =
        // One JSON object per text frame, UTF-8 (PROTOCOL.md §2).
        json.encodeToString(crossy.protocol.ClientMessageSerializer, message)

    public companion object {
        private const val NORMAL_CLOSE: Int = 1000

        /** One shared client so redials reuse the connection pool and dispatcher (OkHttp's
         *  documented posture); a caller may inject its own for lifecycle scoping. */
        public val sharedClient: OkHttpClient = OkHttpClient()

        private fun defaultLog(line: String) {
            // The composition root can inject a real logger; the default keeps the adapter from
            // depending on the Android log framework so the module stays JVM-pure (AAD-1).
            System.err.println(line)
        }

        /**
         * OkHttp's request URL is http/https; the protocol's endpoint is ws/wss (PROTOCOL.md §2).
         * Map the scheme so both the production `ws://` and a MockWebServer `http://` dial cleanly.
         */
        private fun toHttpUrl(raw: String): String =
            when {
                raw.startsWith("wss://", ignoreCase = true) -> "https://" + raw.substring(6)
                raw.startsWith("ws://", ignoreCase = true) -> "http://" + raw.substring(5)
                else -> raw
            }
    }
}
