// Shared plumbing for the CrossySession suites, the Kotlin twin of
// apps/ios/Tests/CrossySessionTests/SessionTestSupport.swift: a MockWebServer endpoint the
// transport tests dial for real (a genuine socket round trip in-process, where the Swift twin
// scripts a fake socket behind a seam), a stepping FakeClock and a scripted Transport for the
// driver tests, and the wire fixtures borrowed from the :protocol module's checked-in copies so
// both twins pin against the same normative PROTOCOL.md samples.

package crossy.session

import crossy.protocol.Board
import crossy.protocol.Cell
import crossy.protocol.ClientMessage
import crossy.protocol.GameStatus
import crossy.protocol.ProtocolJson
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.WelcomeMessage
import crossy.store.Transport
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString
import org.junit.jupiter.api.Assertions.assertTrue
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.coroutines.resume

// MARK: - Wire fixtures (the :protocol module's checked-in copies, read from the source tree)

/**
 * The wire fixtures live in the :protocol test resources; the session tests read them straight off
 * disk, the JVM stand-in for the Swift twin's `#filePath` borrow. Walk up from the test working
 * directory (the `:session` project dir under Gradle) to the repo root (the directory holding
 * `vectors/v1`), mirroring RepoLayout in the engine vector runner.
 */
object WireFixtures {
    private val repoRoot: File = run {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            if (File(dir, "vectors/v1").isDirectory) return@run dir
            dir = dir.parentFile
        }
        error("could not locate the repo root (a directory containing vectors/v1)")
    }

    private val wireDir =
        File(repoRoot, "apps/android/protocol/src/test/resources/fixtures/wire")

    fun text(name: String): String = File(wireDir, "$name.json").readText()
}

/**
 * Semantic JSON equality: object key order is not part of the contract (§2 frames are objects) and
 * numbers compare by value. Twin of FixtureSupport.jsonSemanticEquals in the :protocol suite, so a
 * frame the transport encodes pins against the fixture the codec tests pin.
 */
fun assertJsonEquivalent(expected: String, actual: String, message: String) {
    val equal =
        jsonSemanticEquals(
            ProtocolJson.parseToJsonElement(expected),
            ProtocolJson.parseToJsonElement(actual),
        )
    assertTrue(equal, "$message\n expected: $expected\n actual:   $actual")
}

private fun jsonSemanticEquals(a: JsonElement, b: JsonElement): Boolean =
    when {
        a is JsonObject && b is JsonObject ->
            a.keys == b.keys && a.all { (key, value) -> jsonSemanticEquals(value, b.getValue(key)) }
        a is JsonArray && b is JsonArray ->
            a.size == b.size && a.indices.all { jsonSemanticEquals(a[it], b[it]) }
        a is JsonPrimitive && b is JsonPrimitive -> primitiveSemanticEquals(a, b)
        else -> false
    }

private fun primitiveSemanticEquals(a: JsonPrimitive, b: JsonPrimitive): Boolean {
    val aNull = a is JsonNull
    val bNull = b is JsonNull
    if (aNull || bNull) return aNull && bNull
    if (a.isString != b.isString) return false
    if (a.isString) return a.content == b.content
    val an = a.content.toBigDecimalOrNull()
    val bn = b.content.toBigDecimalOrNull()
    return if (an != null && bn != null) an.compareTo(bn) == 0 else a.content == b.content
}

// MARK: - MockWebServer endpoint (a real socket for the transport tests)

/**
 * One MockWebServer serving a single WebSocket upgrade. Captures every text frame the client sends
 * (the hello and any commands) and hands back the server-side socket so a test can push frames to
 * the client and close the connection. Everything the server callbacks touch is thread-safe: OkHttp
 * runs them off the test thread (which is exactly AAD-2's off-dispatcher decode).
 */
class StackServer {
    private val server = MockWebServer()
    private val serverSocketBox = Channel<WebSocket>(Channel.CONFLATED)

    /** Text frames received from the client, in arrival order (hello first). */
    val received: CopyOnWriteArrayList<String> = CopyOnWriteArrayList()

    init {
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        serverSocketBox.trySend(webSocket)
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        received.add(text)
                    }

                    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                        received.add(bytes.utf8())
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        // Complete the close handshake so the read loop ends; otherwise a lingering
                        // half-open socket stalls MockWebServer.shutdown().
                        webSocket.close(1000, null)
                    }
                },
            ),
        )
        server.start()
    }

    /** A `ws://` URL, so the transport exercises its own ws->http scheme mapping (PROTOCOL.md §2). */
    val wsUrl: String
        get() = server.url("/games/g/ws").toString().replaceFirst("http://", "ws://")

    /** The server-side socket, once the client has connected. */
    suspend fun serverSocket(timeoutMs: Long = 2000): WebSocket =
        withTimeoutOrNull(timeoutMs) { serverSocketBox.receive() }
            ?: error("the client never opened the socket")

    /** Poll until the server has received at least [count] frames, or fail at the deadline. */
    suspend fun awaitReceived(count: Int, timeoutMs: Long = 2000): List<String> {
        val ok =
            withTimeoutOrNull(timeoutMs) {
                while (received.size < count) delay(10)
                true
            }
        assertTrue(ok == true, "expected $count frames, saw ${received.size}: $received")
        return received.toList()
    }

    fun shutdown() {
        // The client transport is closed before this runs and the server completes the close
        // handshake (onClosing above), so the read loop has ended and shutdown drains cleanly.
        server.shutdown()
    }
}

/**
 * Collects a transport's `inbound` flow off the test thread into a channel the test can pull from,
 * and records when the flow completes (the §7 drop signal). One collection per transport, matching
 * the store's single mailbox consumption. Owns its own scope so `runBlocking` never waits on it;
 * a test cancels it in a finally.
 */
class InboundReader(transport: Transport) {
    private val scope = CoroutineScope(Dispatchers.Default)
    private val out = Channel<ServerMessage>(Channel.UNLIMITED)

    @Volatile var completed = false
        private set

    private val job =
        scope.launch {
            transport.inbound.collect { out.send(it) }
            completed = true
            out.close()
        }

    /** The next inbound frame, or null on timeout or once the stream has completed. */
    suspend fun next(timeoutMs: Long = 2000): ServerMessage? =
        withTimeoutOrNull(timeoutMs) { out.receiveCatching().getOrNull() }

    /** True once the inbound flow has completed (the drop signal), waiting up to the deadline. */
    suspend fun awaitCompletion(timeoutMs: Long = 2000): Boolean =
        withTimeoutOrNull(timeoutMs) {
            job.join()
            true
        } ?: false

    fun cancel() {
        scope.cancel()
    }
}

// MARK: - Log capture (ignore-and-log / drop-and-log must be assertable, PROTOCOL.md §3, §11)

class LogProbe {
    private val lines = CopyOnWriteArrayList<String>()
    val logged: List<String> get() = lines.toList()

    fun record(line: String) {
        lines.add(line)
    }

    /** Poll until at least [count] lines are logged (the decode runs on OkHttp's thread). */
    suspend fun awaitLogged(count: Int, timeoutMs: Long = 2000): List<String> {
        withTimeoutOrNull(timeoutMs) {
            while (lines.size < count) delay(10)
        }
        return logged
    }
}

// MARK: - Stepping FakeClock (driver tests)

/**
 * A clock the tests advance by hand. Sleeps suspend until [resumeNext], so loops driven by timers
 * (backoff, heartbeat) step deterministically instead of spinning; every requested duration is
 * recorded for assertion. Cancellation-safe: a cancelled sleeper resumes with CancellationException,
 * like the real clock. Twin of the Swift FakeClock.
 */
class FakeClock : SessionClock {
    private val lock = ReentrantLock()
    private var time: Double = 0.0
    private val requested = mutableListOf<Double>()
    private data class Waiter(val id: Int, val cont: CancellableContinuation<Unit>)
    private val waiters = mutableListOf<Waiter>()
    private val cancelledIds = mutableSetOf<Int>()
    private var nextId = 0

    /** Every sleep duration ever requested, in request order. */
    val sleeps: List<Double> get() = lock.withLock { requested.toList() }

    /** How many sleepers are currently suspended. */
    val waiterCount: Int get() = lock.withLock { waiters.size }

    override fun now(): Double = lock.withLock { time }

    fun advance(seconds: Double) {
        lock.withLock { time += seconds }
    }

    /** Resume the oldest suspended sleeper. */
    fun resumeNext() {
        val cont = lock.withLock { if (waiters.isEmpty()) null else waiters.removeAt(0).cont }
        cont?.resume(Unit)
    }

    override suspend fun sleep(seconds: Double) {
        val id =
            lock.withLock {
                requested.add(seconds)
                nextId++
            }
        suspendCancellableCoroutine { cont ->
            val alreadyCancelled =
                lock.withLock {
                    if (cancelledIds.contains(id)) {
                        true
                    } else {
                        waiters.add(Waiter(id, cont))
                        false
                    }
                }
            if (alreadyCancelled) cont.cancel()
            cont.invokeOnCancellation {
                lock.withLock {
                    cancelledIds.add(id)
                    waiters.removeAll { it.id == id }
                }
            }
        }
    }
}

// MARK: - Scripted Transport (driver tests exercise the port, not the socket)

/**
 * A Transport whose connect outcome and inbound frames are scripted; records sends and closes.
 * Everything runs on the one test dispatcher, so the recording is race-free (the store's
 * single-dispatcher confinement, AAD-2). Twin of the Swift ScriptedTransport.
 */
class ScriptedTransport(private val connectOutcome: ConnectOutcome = ConnectOutcome.Succeed) :
    Transport {
    sealed class ConnectOutcome {
        object Succeed : ConnectOutcome()
        data class Fail(val error: Throwable) : ConnectOutcome()
    }

    private val channel = Channel<ServerMessage>(Channel.UNLIMITED)
    override val inbound: Flow<ServerMessage> = channel.receiveAsFlow()

    val sent = mutableListOf<ClientMessage>()
    var closeCalls = 0
        private set
    var connectCalls = 0
        private set

    override suspend fun connect() {
        connectCalls += 1
        val outcome = connectOutcome
        if (outcome is ConnectOutcome.Fail) {
            channel.close()
            throw outcome.error
        }
    }

    override suspend fun send(message: ClientMessage) {
        sent.add(message)
    }

    override suspend fun close() {
        closeCalls += 1
        channel.close()
    }

    fun deliver(message: ServerMessage) {
        channel.trySend(message)
    }

    fun finish() {
        channel.close()
    }
}

/**
 * Hands the driver one scripted transport per dial; once the script is exhausted, every further
 * attempt throws signed-out so the loop ends deterministically. Twin of the Swift TransportScript.
 */
class TransportScript(transports: List<ScriptedTransport>) {
    private val queue = ArrayDeque(transports)
    val made = mutableListOf<ScriptedTransport>()

    fun next(): Transport {
        val transport =
            if (queue.isEmpty()) {
                ScriptedTransport(
                    ScriptedTransport.ConnectOutcome.Fail(WebSocketTransportException.SignedOut),
                )
            } else {
                queue.removeFirst()
            }
        made.add(transport)
        return transport
    }
}

// MARK: - Server-message fixtures for the driver tests

fun board(seq: Int = 0): Board =
    Board(
        seq = seq,
        status = GameStatus.ONGOING,
        firstFillAt = null,
        completedAt = null,
        abandonedAt = null,
        cells = List(4) { Cell(null, null) },
        participants = emptyList(),
        cursors = emptyList(),
        recentCommandIds = emptyList(),
        checkedWrongCells = emptyList(),
        checkCount = 0,
        stats = null,
    )

fun welcome(seq: Int = 0, userId: String = "me"): ServerMessage =
    ServerMessage.Welcome(
        WelcomeMessage(1, WelcomeMessage.SelfIdentity(userId, Role.SOLVER), board(seq)),
    )
