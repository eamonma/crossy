// Honest weather (apps/ios/DESIGN.md §8; apps/ios/Sources/CrossyUI/RoomWeather.swift): the room's
// connection state as behavior, not chrome polish. Reconnecting dims the room with a quiet countdown
// because a person lost something mid-solve; the first connect (client-local `connecting`, no board
// truth yet) also dims but says nothing and counts nothing, since a first join has lost nothing. Live
// and resyncing leave the board alone (a snapshot applies wholesale when it lands). This is the pure
// mapping of the store's SyncState plus the driver's next-dial deadline; tests pin it. The dot's
// three registers (calm / breathing / dimmed) live here too now (the room bar draws them, RoomBar's
// WeatherDot); the glass chip is a later material track, so the register is the behavior, not polish.

package crossy.ui

import crossy.store.SyncState
import kotlin.math.ceil
import kotlin.math.max

object RoomWeather {
    /** The weather dot's three registers (apps/ios RoomWeather.Dot, DESIGN.md §8): a calm steady dot
     *  when live, a breathing pulse while a snapshot is on its way (resyncing), and a hollow ring
     *  while the room is dimmed (connecting or reconnecting). Achromatic: weather is the room's state,
     *  not a person (DESIGN.md §3). */
    enum class Dot {
        /** A quiet, steady dot: the room is live. */
        CALM,

        /** The dot breathes (a slow opacity pulse): a gap was seen, a snapshot is on its way.
         *  Chrome-only; the board does not change. */
        BREATHING,

        /** The dot holds hollow while the room is dimmed: the socket is gone, or not yet arrived. */
        DIMMED,
    }

    /** The dot register for one connection state (PROTOCOL.md §7 states plus the client-local
     *  connecting): live is calm, resyncing breathes, and both the pre-welcome connecting and a
     *  post-drop reconnecting hold the hollow dimmed dot. Twin of iOS RoomWeather.from(sync).dot. */
    fun dot(sync: SyncState): Dot = when (sync) {
        SyncState.LIVE -> Dot.CALM
        SyncState.RESYNCING -> Dot.BREATHING
        SyncState.CONNECTING, SyncState.RECONNECTING -> Dot.DIMMED
    }

    /** The plain word beside the dot, or null when the room needs none (ID-5: common words, nothing
     *  precious). Only a reconnect names itself, because a person lost something mid-solve; live,
     *  resyncing, and the first connect stay wordless (the terse first-connect pill, iOS
     *  RoomWeather.from). The reconnect countdown replaces this word while a dial is scheduled
     *  (showsCountdown + reconnectLine). Twin of iOS RoomWeather.label. */
    fun label(sync: SyncState): String? =
        if (sync == SyncState.RECONNECTING) "Reconnecting" else null

    /** The board's paper wash opacity when dimmed: strong enough to read as an honest hush, light
     *  enough that the room never dims dead (RoomWeather.boardDimOpacity). */
    const val boardDimOpacity: Double = 0.45

    /** True dims the board under the chrome: the pre-welcome `connecting` state and a post-drop
     *  `reconnecting`, both honestly not live. Live and resyncing keep the board's last truth. */
    fun boardDimmed(sync: SyncState): Boolean =
        sync == SyncState.CONNECTING || sync == SyncState.RECONNECTING

    /** True shows the quiet countdown to the next dial: reconnecting only (a first connect has lost
     *  nothing, so it names nothing). */
    fun showsCountdown(sync: SyncState): Boolean = sync == SyncState.RECONNECTING

    /** Whole seconds until the next dial, floored at zero; null when there is no deadline to count
     *  toward (the driver has not scheduled one). Epoch millis on Android, the SessionDriver clock. */
    fun countdownSeconds(retryAtMillis: Long?, nowMillis: Long): Int? {
        if (retryAtMillis == null) return null
        return max(0.0, ceil((retryAtMillis - nowMillis) / 1000.0)).toInt()
    }

    /** The countdown line, ID-5 plain and warm: "Back in 3s" while a dial is scheduled, the bare
     *  state word otherwise (no deadline yet, or it has already elapsed). Twin of reconnectLine. */
    fun reconnectLine(retryAtMillis: Long?, nowMillis: Long): String {
        val seconds = countdownSeconds(retryAtMillis, nowMillis)
        return if (seconds != null && seconds > 0) "Back in ${seconds}s" else "Reconnecting"
    }
}
