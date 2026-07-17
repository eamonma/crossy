// The shared ambient clock (ID-2, apps/ios/DESIGN.md §9; twin of apps/ios AmbientClock.swift): small,
// tabular, in the room bar, shared and social, not a whip. It derives entirely from wire facts: it
// reads 0:00 before the first fill (the timer starts at first fill, root DESIGN.md D15), ticks from
// `firstFillAt`, and freezes at the terminal instant (`completedAt`, or `abandonedAt` for a host-ended
// room). Timestamps arrive as ISO 8601 strings on the server's clock (PROTOCOL.md §3) and stay strings
// in the store; parsing and formatting live here where tests pin them with an injected `now`. Width
// stability (the clock never jitters, DESIGN.md §6) is the render site's job via tabular numerals
// (TextStyle.withTabularNumerals); this file keeps the digits minimal so there is little to jitter.

package crossy.ui

import java.time.Instant
import java.time.OffsetDateTime

object AmbientClock {
    /** Parse a wire timestamp into epoch millis (the store's clock unit; RoomWeather counts in the
     *  same unit). ISO 8601, fractional seconds tolerated (the JS server's toISOString carries
     *  milliseconds; fixtures often do not). A `Z`-terminated instant parses directly; an explicit
     *  offset form (`+00:00`) falls back to OffsetDateTime. Null on anything unparseable, so a clock
     *  with no origin quietly reads 0:00 rather than throwing. */
    fun parse(timestamp: String): Long? =
        try {
            Instant.parse(timestamp).toEpochMilli()
        } catch (e: Exception) {
            try {
                OffsetDateTime.parse(timestamp).toInstant().toEpochMilli()
            } catch (e2: Exception) {
                null
            }
        }

    /** Elapsed whole seconds for display. No first fill yet reads 0 (ID-2: before the first fill it
     *  reads 0:00 quietly); a terminal game freezes at `freezeAt` (the completion instant, or the
     *  abandonment for a host-ended room); clock skew can never show a negative time. */
    fun elapsedSeconds(firstFillAtMillis: Long?, freezeAtMillis: Long?, nowMillis: Long): Int {
        val origin = firstFillAtMillis ?: return 0
        val end = freezeAtMillis ?: nowMillis
        val seconds = (end - origin) / 1000
        return if (seconds < 0) 0 else seconds.toInt()
    }

    /** m:ss under an hour, h:mm:ss from there: a quiet timer, not a stopwatch (EXPERIENCE.md), so no
     *  leading zeros beyond what alignment needs and never sub-second digits. */
    fun display(seconds: Int): String {
        val clamped = if (seconds < 0) 0 else seconds
        val hours = clamped / 3600
        val minutes = (clamped % 3600) / 60
        val secs = clamped % 60
        return if (hours > 0) "$hours:${pad(minutes)}:${pad(secs)}" else "$minutes:${pad(secs)}"
    }

    /** The one-call form the room bar uses: wire strings in, display out. `freezeAt` is the terminal
     *  instant the clock stops at (`completedAt ?? abandonedAt`), null while the room runs. */
    fun display(firstFillAt: String?, freezeAt: String?, nowMillis: Long): String =
        display(
            elapsedSeconds(
                firstFillAtMillis = firstFillAt?.let(::parse),
                freezeAtMillis = freezeAt?.let(::parse),
                nowMillis = nowMillis,
            ),
        )

    private fun pad(value: Int): String = if (value < 10) "0$value" else "$value"
}
