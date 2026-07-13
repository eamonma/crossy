// The driver against scripted transports and a stepping FakeClock (AD-6; PROTOCOL.md §5, §7, §9),
// Kotlin twin of apps/ios/Tests/CrossySessionTests/SessionDriverTests.swift. What these pin: the
// driver executes exactly the delays the store's BackoffSchedule decides (jitter included, via the
// policy's injected RNG), reports survival so the schedule resets in the store and never resets it
// itself, runs the heartbeat on the policy's 15 s number through the store's one outbound path, and
// stops cleanly on cancellation and on signed-out. Every number asserted here has a twin in
// ReconnectPolicyTest, so drift between decider and executor is visible.

package crossy.session

import crossy.protocol.ClientMessage
import crossy.protocol.HeartbeatMessage
import crossy.store.BackoffSchedule
import crossy.store.GameStore
import crossy.store.SyncState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SessionDriverTests {
    private fun failing(): ScriptedTransport =
        ScriptedTransport(ScriptedTransport.ConnectOutcome.Fail(RuntimeException("dial refused")))

    // MARK: - Backoff execution (AD-6: the store decides, the driver sleeps and dials)

    @Test
    fun redialHonorsTheStoresScheduleSleepingEachAttemptBetweenFailedDials_AD6_PROTOCOL7() =
        runTest {
            // unitRandom pinned to 1.0 exposes the undithered bases: 0, 1, 2, 4, 8.
            val script = TransportScript(List(5) { failing() })
            val store = GameStore(backoff = BackoffSchedule(random = { 1.0 }))
            val clock = FakeClock()
            val driver = SessionDriver(store, clock, makeTransport = script::next)
            val job = launch { driver.run() }

            advanceUntilIdle() // dial #1 fails, driver parks on the first backoff sleep
            repeat(5) {
                assertEquals(1, clock.waiterCount, "driver parks on a backoff sleep")
                clock.resumeNext()
                advanceUntilIdle()
            }
            job.join() // the exhausted script answers signed-out: a deliberate stop

            assertEquals(listOf(0.0, 1.0, 2.0, 4.0, 8.0), clock.sleeps, "the §7 walk, executed verbatim")
            assertEquals(6, script.made.size, "one fresh transport per attempt, dialed first")
        }

    @Test
    fun jitterComesFromThePolicysInjectedRNGNotTheDriver_PROTOCOL7() = runTest {
        // A 0.5 draw halves each base: full jitter is the policy's math, the driver just sleeps
        // whatever number it is handed.
        val script = TransportScript(List(3) { failing() })
        val store = GameStore(backoff = BackoffSchedule(random = { 0.5 }))
        val clock = FakeClock()
        val driver = SessionDriver(store, clock, makeTransport = script::next)
        val job = launch { driver.run() }

        advanceUntilIdle()
        repeat(3) {
            clock.resumeNext()
            advanceUntilIdle()
        }
        job.join()

        assertEquals(listOf(0.0, 0.5, 1.0), clock.sleeps)
    }

    @Test
    fun failedDialsNeverReportSurvivalSoTheWalkNeverResets_PROTOCOL7() = runTest {
        // The web onclose guard, mirrored: wall-clock time passing between failed attempts must not
        // read as survival, or a dead server would busy-loop at 0 s.
        val script = TransportScript(List(3) { failing() })
        val store = GameStore(backoff = BackoffSchedule(random = { 1.0 }))
        val clock = FakeClock()
        val driver = SessionDriver(store, clock, makeTransport = script::next)
        val job = launch { driver.run() }

        advanceUntilIdle()
        repeat(3) {
            clock.advance(100.0) // plenty of time passes; none of it was a connection
            clock.resumeNext()
            advanceUntilIdle()
        }
        job.join()

        assertEquals(listOf(0.0, 1.0, 2.0), clock.sleeps, "the walk kept escalating: no false reset")
    }

    // MARK: - Survival reporting (PROTOCOL.md §7: reset after 30 s, decided in the store)

    @Test
    fun thirtySecondSurvivalReportedToTheStoreResetsTheWalk_PROTOCOL7() = runTest {
        val live = ScriptedTransport()
        val script = TransportScript(listOf(failing(), failing(), live))
        val store = GameStore(backoff = BackoffSchedule(random = { 1.0 }))
        val clock = FakeClock()
        val driver = SessionDriver(store, clock, makeTransport = script::next)
        val job = launch { driver.run() }

        // Two failures walk the schedule to attempt 2.
        advanceUntilIdle() // dial #1 fails, parks on sleep 0
        clock.resumeNext()
        advanceUntilIdle() // dial #2 fails, parks on sleep 1
        clock.resumeNext()
        advanceUntilIdle() // dial #3 opens; heartbeat parks on its first 15 s tick

        live.deliver(welcome())
        advanceUntilIdle()
        assertEquals(SyncState.LIVE, store.render.value.sync)

        // The connection lives 30 s, then drops. connectionSurvived(30) resets the walk in the
        // store, so the post-drop delay is attempt 0 again.
        clock.advance(30.0)
        live.finish()
        advanceUntilIdle()
        assertEquals(1, clock.waiterCount, "parks on the backoff walk after the drop")
        clock.resumeNext()
        advanceUntilIdle()
        job.join()

        assertEquals(
            listOf(0.0, 1.0, 15.0, 0.0),
            clock.sleeps,
            "after the heartbeat's one 15 s tick, the 30 s survival reset the walk: attempt 0 again",
        )
    }

    // MARK: - Heartbeat (PROTOCOL.md §5, §9: every 15 s while live, the policy's number)

    @Test
    fun heartbeatsEveryFifteenSecondsThroughTheStoreWhileLive_PROTOCOL9() = runTest {
        val live = ScriptedTransport()
        val script = TransportScript(listOf(live))
        val store = GameStore(backoff = BackoffSchedule(random = { 1.0 }))
        val clock = FakeClock()
        val driver = SessionDriver(store, clock, makeTransport = script::next)
        val job = launch { driver.run() }

        advanceUntilIdle() // connect; heartbeat parks on the first 15 s tick
        live.deliver(welcome())
        advanceUntilIdle()
        assertEquals(SyncState.LIVE, store.render.value.sync)

        // Step the heartbeat timer twice; each tick flows store -> pump -> transport.
        assertEquals(1, clock.waiterCount, "heartbeat timer parked")
        clock.resumeNext()
        advanceUntilIdle()
        assertEquals(1, live.sent.size, "first heartbeat sent")
        assertEquals(1, clock.waiterCount, "heartbeat timer parked again")
        clock.resumeNext()
        advanceUntilIdle()
        assertEquals(2, live.sent.size, "second heartbeat sent")

        assertEquals(
            listOf<ClientMessage>(
                ClientMessage.Heartbeat(HeartbeatMessage()),
                ClientMessage.Heartbeat(HeartbeatMessage()),
            ),
            live.sent,
            "heartbeats go through the store's one ordered outbound path",
        )

        // The drop cancels the heartbeat with the connection; the next sleep is the backoff walk.
        live.finish()
        advanceUntilIdle()
        assertEquals(SyncState.RECONNECTING, store.render.value.sync)
        assertEquals(2, live.sent.size, "no heartbeat outlives its socket")

        clock.resumeNext() // release the post-drop backoff sleep
        advanceUntilIdle()
        job.join()
    }

    // MARK: - Deliberate teardown

    @Test
    fun cancellationClosesTheLiveTransportAndStopsTheLoop_PROTOCOL2() = runTest {
        val live = ScriptedTransport()
        val script = TransportScript(listOf(live))
        val store = GameStore()
        val clock = FakeClock()
        val driver = SessionDriver(store, clock, makeTransport = script::next)
        val job = launch { driver.run() }

        advanceUntilIdle()
        live.deliver(welcome())
        advanceUntilIdle()
        assertEquals(SyncState.LIVE, store.render.value.sync)

        job.cancel()
        advanceUntilIdle()
        job.join()

        assertEquals(1, live.closeCalls, "deliberate teardown closes the socket")
        assertEquals(1, script.made.size, "no redial after a deliberate stop")
        assertEquals(0, clock.waiterCount, "no sleeper left behind")
    }

    @Test
    fun signedOutStopsTheLoopInsteadOfBusyLooping_PROTOCOL2() = runTest {
        val script =
            TransportScript(
                listOf(
                    ScriptedTransport(
                        ScriptedTransport.ConnectOutcome.Fail(WebSocketTransportException.SignedOut),
                    ),
                ),
            )
        val store = GameStore()
        val clock = FakeClock()
        val driver = SessionDriver(store, clock, makeTransport = script::next)
        val job = launch { driver.run() }

        advanceUntilIdle()
        job.join()

        assertEquals(1, script.made.size, "one attempt, then a deliberate stop")
        assertTrue(clock.sleeps.isEmpty(), "no backoff sleep: this is a stop, not a retry")
    }

    // MARK: - The reconnect countdown deadline (DESIGN.md §8: the composition root's flag)

    @Test
    fun publishesAReconnectDeadlineAsEachBackoffSleepBegins_PROTOCOL7_DESIGN8() = runTest {
        val script = TransportScript(List(3) { failing() })
        val store = GameStore(backoff = BackoffSchedule(random = { 1.0 }))
        val clock = FakeClock()
        val deadlines = mutableListOf<Long>()
        val before = System.currentTimeMillis()
        val driver =
            SessionDriver(store, clock, onReconnectScheduled = { deadlines.add(it) }, makeTransport = script::next)
        val job = launch { driver.run() }

        advanceUntilIdle()
        repeat(3) {
            clock.resumeNext()
            advanceUntilIdle()
        }
        job.join()

        assertEquals(3, deadlines.size, "one deadline per backoff sleep")
        assertTrue(
            deadlines.all { it >= before },
            "the deadline is a future instant, not a shrinking duration",
        )
    }
}
