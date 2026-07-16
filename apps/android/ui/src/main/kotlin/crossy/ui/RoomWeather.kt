// Honest weather (apps/ios/DESIGN.md §8; apps/ios/Sources/CrossyUI/RoomWeather.swift): the room's
// connection state as behavior, not chrome polish. Reconnecting dims the room with a quiet countdown
// because a person lost something mid-solve; the first connect (client-local `connecting`, no board
// truth yet) also dims but says nothing and counts nothing, since a first join has lost nothing. Live
// and resyncing leave the board alone (a snapshot applies wholesale when it lands). This is the pure
// mapping of the store's SyncState plus the driver's next-dial deadline; tests pin it. The animated
// weather dot and the glass chip are a later chrome track, so this twin carries only the behavior:
// whether the board dims, whether a countdown shows, and the countdown line itself.

package crossy.ui

import crossy.store.SyncState
import kotlin.math.ceil
import kotlin.math.max

object RoomWeather {
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
