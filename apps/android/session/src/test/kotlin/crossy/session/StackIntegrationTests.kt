// The JUnit side of the integration harness (Wave A3; apps/android/scripts/integration.ts boots the
// real local stack: Testcontainers Postgres, migrations, a JWKS issuer, the api and session
// services, then creates a game through the real REST api and runs `:session:test` with the
// CROSSY_IT_* connection facts in the environment). Absent those facts every test here skips
// (assumeTrue aborts, not fails), so a plain `./gradlew :session:test` and CI (no Docker) stay
// green with no services. Twin of apps/ios/Tests/CrossySessionTests/StackIntegrationTests.swift.
//
// Composition is production pieces only: WebSocketTransport through its production init (URL plus
// token provider), SessionDriver, GameStore. No seams, no scripted sockets; the session service
// stays the single writer of game state and assertions go through the client surface. What this
// pins is the M1 exit shape replayed in Kotlin against the real wire (PROTOCOL.md §2, §7, §8).

package crossy.session

import crossy.protocol.ClientMessage
import crossy.protocol.PlaceLetterMessage
import crossy.protocol.RequestSyncMessage
import crossy.protocol.ServerMessage
import crossy.store.GameStore
import crossy.store.SyncState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import java.util.UUID
import java.util.concurrent.Executors

class StackIntegrationTests {
    // The CROSSY_IT_* namespace the script injects. wsBase is `ws://127.0.0.1:{session-port}`, the
    // §2 endpoint base; tokenA/tokenB are two full-account members of the seeded game.
    private data class StackFacts(
        val wsBase: String,
        val gameId: String,
        val tokenA: String,
        val tokenB: String,
    )

    private fun stackFacts(): StackFacts {
        val env = System.getenv()
        val wsBase = env["CROSSY_IT_WS_BASE"]
        val gameId = env["CROSSY_IT_GAME_ID"]
        val tokenA = env["CROSSY_IT_TOKEN_A"]
        val tokenB = env["CROSSY_IT_TOKEN_B"]
        assumeTrue(
            !wsBase.isNullOrEmpty() &&
                !gameId.isNullOrEmpty() &&
                !tokenA.isNullOrEmpty() &&
                !tokenB.isNullOrEmpty(),
            "CROSSY_IT_* connection facts absent; run `corepack pnpm test:android-integration` " +
                "(apps/android/scripts/integration.ts boots the stack and re-runs this suite)",
        )
        return StackFacts(wsBase!!, gameId!!, tokenA!!, tokenB!!)
    }

    private fun wsUrl(facts: StackFacts): String = "${facts.wsBase}/games/${facts.gameId}/ws"

    // Poll a condition against the real stack; the store's render is a StateFlow, safe to read from
    // this thread while the mailbox mutates on its confining dispatcher.
    private suspend fun eventually(what: String, timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            delay(50)
        }
        assertTrue(false, "timed out waiting until $what")
    }

    private suspend fun awaitMessage(
        reader: InboundReader,
        timeoutMs: Long = 10_000,
        predicate: (ServerMessage) -> Boolean,
    ): ServerMessage {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val message = reader.next(500) ?: continue
            if (predicate(message)) return message
        }
        error("timed out waiting for a matching frame")
    }

    private fun freshClient() = OkHttpClient()

    private fun tearDown(client: OkHttpClient) {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
    }

    // The real handshake (PROTOCOL.md §2) and the echo path (§8), driven through the production
    // composition (GameStore + SessionDriver + WebSocketTransport): a letter placed through the
    // store's command path paints as overlay, and the server's cellSet echo clears it, leaving
    // sequenced state to carry the render (INV-10).
    @Test
    fun realHandshakeLandsWelcomeAndEchoClearsOverlay_INV10() = runBlocking {
        val facts = stackFacts()
        // The store is confined to one dispatcher (AAD-2): the driver, the mailbox, and the local
        // intent below all run on it, so nothing races the store's fields.
        val executor = Executors.newSingleThreadExecutor()
        val dispatcher = executor.asCoroutineDispatcher()
        val client = freshClient()
        val store = GameStore()
        val scope = CoroutineScope(dispatcher + SupervisorJob())
        val driver =
            SessionDriver(store) {
                WebSocketTransport(wsUrl(facts), tokenProvider = { facts.tokenA }, client = client)
            }
        val driverJob = scope.launch { driver.run() }
        try {
            eventually("the welcome flips the store live") {
                store.render.value.sync == SyncState.LIVE && store.render.value.selfUserId != null
            }
            val seqBefore = store.render.value.seq
            val self = store.render.value.selfUserId

            withContext(dispatcher) { store.placeLetter(0, "Q") }
            val painted = store.render.value
            assertEquals(1, painted.overlay.size, "the optimistic entry lives until the echo")
            assertEquals("Q", painted.renderValue(0), "the overlay paints immediately (INV-10)")

            eventually("the echo clears the overlay") {
                val r = store.render.value
                r.overlay.isEmpty() && r.cells[0]?.v == "Q"
            }
            val converged = store.render.value
            assertTrue(converged.seq > seqBefore, "the cellSet advanced sequenced state")
            assertEquals(self, converged.cells[0]?.by, "the echo names this writer")
            assertEquals("Q", converged.renderValue(0), "the render now reads sequenced state alone")
        } finally {
            driverJob.cancelAndJoin() // deliberate teardown: the driver closes the live socket 1000
            tearDown(client)
            dispatcher.close()
        }
    }

    // The explicit requestSync round trip (PROTOCOL.md §5, §7): a raw production transport places a
    // letter, sees its cellSet echo, then asks for a fresh snapshot and reads the placed letter back
    // out of the sync board. "Compare state" is the snapshot agreeing with the delta. A second cell
    // than the test above, so the two methods never contend on the one seeded game.
    @Test
    fun realRequestSyncReturnsASnapshotCarryingThePlacedLetter_PROTOCOL7() = runBlocking {
        val facts = stackFacts()
        val client = freshClient()
        val transport =
            WebSocketTransport(wsUrl(facts), tokenProvider = { facts.tokenA }, client = client)
        val reader = InboundReader(transport)
        try {
            transport.connect()
            val welcome =
                awaitMessage(reader) { it is ServerMessage.Welcome } as ServerMessage.Welcome
            assertEquals(1, welcome.message.protocolVersion, "the welcome negotiates v1 (PROTOCOL.md §2)")

            val cell = 12
            val commandId = UUID.randomUUID().toString()
            transport.send(ClientMessage.PlaceLetter(PlaceLetterMessage(commandId, cell, "Z")))

            val echo =
                awaitMessage(reader) {
                    it is ServerMessage.CellSet && it.message.commandId == commandId
                } as ServerMessage.CellSet
            assertEquals("Z", echo.message.value, "the echo carries the placed value (INV-10)")
            assertEquals(cell, echo.message.cell)

            transport.send(ClientMessage.RequestSync(RequestSyncMessage()))
            val sync = awaitMessage(reader) { it is ServerMessage.Sync } as ServerMessage.Sync
            assertEquals(
                "Z",
                sync.message.board.cells[cell].v,
                "the requestSync snapshot carries the placed letter (PROTOCOL.md §7)",
            )
            assertEquals(
                welcome.message.self.userId,
                sync.message.board.cells[cell].by,
                "and names this writer",
            )
        } finally {
            reader.cancel()
            runCatching { transport.close() }
            tearDown(client)
        }
    }
}
