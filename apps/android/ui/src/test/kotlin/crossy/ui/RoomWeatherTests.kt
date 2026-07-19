// The honest-weather mapping pinned against apps/ios/Sources/CrossyUI/RoomWeather.swift (DESIGN.md
// §8): which states dim the board, which count down, and the "Back in Ns" line. The board-dim wash
// opacity and the countdown math are the behavior the room bar and the grid scrim read; keeping them
// pinned keeps the Android twin from drifting off the iOS numbers.
package crossy.ui

import crossy.store.SyncState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class RoomWeatherTests {
    @Test
    fun `DESIGN8 the board dims pre-welcome and while reconnecting, never while live or resyncing`() {
        assertTrue(RoomWeather.boardDimmed(SyncState.CONNECTING))
        assertTrue(RoomWeather.boardDimmed(SyncState.RECONNECTING))
        assertFalse(RoomWeather.boardDimmed(SyncState.LIVE))
        assertFalse(RoomWeather.boardDimmed(SyncState.RESYNCING))
    }

    @Test
    fun `DESIGN8 the board-dim wash matches the iOS 0_45 opacity`() {
        assertEquals(0.45, RoomWeather.boardDimOpacity)
    }

    @Test
    fun `DESIGN8 only reconnecting counts down, a first connect names nothing`() {
        assertTrue(RoomWeather.showsCountdown(SyncState.RECONNECTING))
        assertFalse(RoomWeather.showsCountdown(SyncState.CONNECTING))
        assertFalse(RoomWeather.showsCountdown(SyncState.LIVE))
        assertFalse(RoomWeather.showsCountdown(SyncState.RESYNCING))
    }

    @Test
    fun `DESIGN8 whole seconds to the next dial, ceiled and floored at zero`() {
        assertNull(RoomWeather.countdownSeconds(retryAtMillis = null, nowMillis = 1_000))
        assertEquals(3, RoomWeather.countdownSeconds(retryAtMillis = 4_000, nowMillis = 1_000))
        // Ceils a partial second (iOS rounds up), and never goes negative once the deadline passes.
        assertEquals(3, RoomWeather.countdownSeconds(retryAtMillis = 3_500, nowMillis = 1_000))
        assertEquals(0, RoomWeather.countdownSeconds(retryAtMillis = 900, nowMillis = 1_000))
    }

    @Test
    fun `DESIGN8 the countdown line is warm and plain, the bare word once it elapses`() {
        assertEquals("Back in 3s", RoomWeather.reconnectLine(retryAtMillis = 4_000, nowMillis = 1_000))
        assertEquals("Reconnecting", RoomWeather.reconnectLine(retryAtMillis = null, nowMillis = 1_000))
        assertEquals("Reconnecting", RoomWeather.reconnectLine(retryAtMillis = 1_000, nowMillis = 1_000))
    }

    @Test
    fun `DESIGN8 the dot's three registers, calm live, breathing resync, dimmed while not live`() {
        assertEquals(RoomWeather.Dot.CALM, RoomWeather.dot(SyncState.LIVE))
        assertEquals(RoomWeather.Dot.BREATHING, RoomWeather.dot(SyncState.RESYNCING))
        assertEquals(RoomWeather.Dot.DIMMED, RoomWeather.dot(SyncState.CONNECTING))
        assertEquals(RoomWeather.Dot.DIMMED, RoomWeather.dot(SyncState.RECONNECTING))
    }

    @Test
    fun `DESIGN8 only a reconnect names itself, the first connect and the calm states stay wordless`() {
        assertEquals("Reconnecting", RoomWeather.label(SyncState.RECONNECTING))
        assertNull(RoomWeather.label(SyncState.CONNECTING))
        assertNull(RoomWeather.label(SyncState.LIVE))
        assertNull(RoomWeather.label(SyncState.RESYNCING))
    }

    // The reconnect-overlay grace window (Track A-android; the web and iOS 2000 ms twin): the chrome
    // waits out RECONNECT_OVERLAY_GRACE_MS of continuous non-live before it speaks, and clears the
    // instant the room returns to live. Driven on the test scheduler (the SessionDriverTests idiom).
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `A-android a non-live blink under the grace window never shows the overlay`() = runTest {
        val sync = MutableStateFlow(SyncState.LIVE)
        val seen = mutableListOf<Boolean>()
        val job = launch { RoomWeather.overlayGrace(sync).collect { seen.add(it) } }
        runCurrent()

        sync.value = SyncState.RECONNECTING
        advanceTimeBy(RoomWeather.RECONNECT_OVERLAY_GRACE_MS - 1)
        runCurrent()

        // A ~200 ms Railway reconnect recovers before the window elapses: the chrome never spoke.
        assertEquals(listOf(false), seen)
        job.cancel()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `A-android non-live past the grace window shows the overlay`() = runTest {
        val sync = MutableStateFlow(SyncState.LIVE)
        val seen = mutableListOf<Boolean>()
        val job = launch { RoomWeather.overlayGrace(sync).collect { seen.add(it) } }
        runCurrent()

        sync.value = SyncState.RECONNECTING
        advanceTimeBy(RoomWeather.RECONNECT_OVERLAY_GRACE_MS)
        runCurrent()

        assertEquals(listOf(false, true), seen)
        job.cancel()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `A-android recovery to live hides the overlay at once`() = runTest {
        val sync = MutableStateFlow(SyncState.LIVE)
        val seen = mutableListOf<Boolean>()
        val job = launch { RoomWeather.overlayGrace(sync).collect { seen.add(it) } }
        runCurrent()

        sync.value = SyncState.RECONNECTING
        advanceUntilIdle() // past the window: the overlay is up
        assertEquals(listOf(false, true), seen)

        sync.value = SyncState.LIVE
        runCurrent() // no virtual time passes: the overlay clears immediately on recovery
        assertEquals(listOf(false, true, false), seen)
        job.cancel()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `A-android recovery before the window cancels the pending timer`() = runTest {
        val sync = MutableStateFlow(SyncState.LIVE)
        val seen = mutableListOf<Boolean>()
        val job = launch { RoomWeather.overlayGrace(sync).collect { seen.add(it) } }
        runCurrent()

        sync.value = SyncState.RESYNCING
        advanceTimeBy(RoomWeather.RECONNECT_OVERLAY_GRACE_MS - 1)
        runCurrent()
        sync.value = SyncState.LIVE // recovered before the window: the armed timer is cancelled
        advanceUntilIdle() // let any stranded timer fire; it must not

        assertEquals(listOf(false), seen)
        job.cancel()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `A-android a resyncing to reconnecting bounce is one unbroken non-live stretch`() = runTest {
        val sync = MutableStateFlow(SyncState.LIVE)
        val seen = mutableListOf<Boolean>()
        val job = launch { RoomWeather.overlayGrace(sync).collect { seen.add(it) } }
        runCurrent()

        sync.value = SyncState.RESYNCING
        advanceTimeBy(RoomWeather.RECONNECT_OVERLAY_GRACE_MS / 2)
        runCurrent()
        sync.value = SyncState.RECONNECTING // a bounce mid-window must not reset the shared timer
        advanceTimeBy(RoomWeather.RECONNECT_OVERLAY_GRACE_MS / 2)
        runCurrent()

        // The window is measured from the first non-live instant, not the bounce: the overlay shows.
        assertEquals(listOf(false, true), seen)
        job.cancel()
    }
}
