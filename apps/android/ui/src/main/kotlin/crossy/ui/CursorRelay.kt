// The cursor relay throttle (PROTOCOL.md §9: moveCursor at most 10 per second per client; the
// server MAY drop excess silently). Twin of iOS's CrossyUI/CursorRelay.swift and the web's posture
// (apps/web/src/LiveApp.tsx): a leading send plus one coalesced trailing send, so a hop lands
// immediately, a fast run of hops collapses to the cap, and the LAST position always goes out (the
// trailing send reads the latest selection when it fires; a stale final cursor would lie to the
// room). Pure state over injected times, so the tests pin the cadence without a clock; the room
// screen owns the actual timer and the store refuses sends while connecting (GameStore.moveCursor).

package crossy.ui

/** The mutable throttle state one client holds (iOS keeps it a `mutating` struct in the view; the
 *  Kotlin twin is a class the room screen keeps in `remember`). */
class CursorRelayThrottle {
    /** What the caller does about one selection change. */
    sealed interface Verdict {
        /** Send now (the leading edge). */
        data object Send : Verdict
        /** Schedule one trailing send this far in the future; it must read the latest selection
         *  when it fires. */
        data class ScheduleTrailing(val afterSeconds: Double) : Verdict
        /** A trailing send is already scheduled; it will carry this change. */
        data object Coalesce : Verdict
    }

    companion object {
        /** 100 ms between sends: the PROTOCOL.md §9 cap of 10/s, the web's CAP_MS. */
        const val CAP_SECONDS = 0.1
    }

    private var lastSentAt: Double? = null
    private var trailingScheduled = false

    /** The selection changed at `now` (any monotonic seconds). Decides and records. */
    fun selectionChanged(now: Double): Verdict {
        val since = lastSentAt?.let { now - it } ?: Double.POSITIVE_INFINITY
        if (since >= CAP_SECONDS) {
            lastSentAt = now
            return Verdict.Send
        }
        if (trailingScheduled) return Verdict.Coalesce
        trailingScheduled = true
        return Verdict.ScheduleTrailing(CAP_SECONDS - since)
    }

    /** The scheduled trailing send fired at `now`: the caller sends the latest selection and the
     *  throttle window restarts from here. */
    fun trailingFired(now: Double) {
        trailingScheduled = false
        lastSentAt = now
    }

    /** The trailing send was cancelled (the room is closing); nothing was sent. */
    fun trailingCancelled() {
        trailingScheduled = false
    }
}
