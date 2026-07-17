// The post-game analysis surface's data, as the render layer reads it (twin of apps/ios
// RoomAnalysis.swift; the RosterMember pattern, AAD-2: :ui names its own plain types and the
// protocol twins stay in their ring). The composition root fetches GET /games/{id}/analysis
// through :api and maps its AnalysisView into these before the room ever sees it.
//
// The bundle is first-correct truth (design/post-game/ANALYSIS.md, engine solveTrace): `owners`
// is who solved each cell FIRST, the same attribution the web mosaic and legend paint, distinct
// from the live event log's last-writer `by`. It carries userIds, cells, and numbers only, never
// a letter (INV-6): the server strips the trace to this shape, and this type has nowhere to hold
// a solution value by construction.

package crossy.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay

/** The analysis bundle for one completed game, render-ready. Times are relative seconds from the
 *  solve's start; `owners` maps a cell index to the userId who first got it right. */
data class RoomAnalysis(
    val owners: Map<Int, String>,
    val momentum: RoomMomentum,
    /** The room's longest pause and the burst that broke it, or null when the trace is too short
     *  to have a gap (fewer than two fills). */
    val turningPoint: RoomTurningPoint?,
    /** The solver superlatives, in the wire's ladder-rank order (design/post-game/TITLES.md): at most
     *  one per solver, empty for a solo solve (the solo rule) or an older API that predates titles. */
    val titles: List<RoomTitle>,
    /** The sittings partition (design/post-game/SITTINGS.md, D29), or null from an older cached
     *  bundle, which renders exactly as today: no context suffix, no seam ticks. */
    val sittings: RoomSittings? = null,
) {
    /** Distinct solvers who own at least one square (the stat trio's "Solvers"). */
    val solverCount: Int get() = owners.values.toSet().size

    /** Total squares with a first-correct owner (the stat trio's "Squares"). */
    val entryCount: Int get() = owners.size

    /** The solve span as `M:SS` (the stat trio's "Time"): the momentum duration, the reach from
     *  the first fill to the last, which is what the web panel labels Time. Active seconds once the
     *  server re-bases the bundle (D29); the label logic does not change. */
    val durationLabel: String get() = formatMSS(momentum.durationSeconds)

    /** The sitting-count context beside the headline Time ("24:13 · 2 sittings", owner ruling, D29):
     *  context, never a second stat, so it renders only at two or more sittings. A single-sitting
     *  game, an older bundle, and a degenerate count all read exactly as today: null, no suffix. */
    val sittingCountSuffix: String?
        get() {
            val count = sittings?.count ?: return null
            return if (count >= 2) "$count sittings" else null
        }

    companion object {
        /** A seconds count as `M:SS`, or `H:MM:SS` past an hour, matching the web's formatMSS
         *  (apps/web/src/ui/analysisReadout.ts) digit for digit: seconds floored, the seconds and
         *  (when hours show) minutes fields zero-padded, negatives and non-finite input clamped to
         *  "0:00" so a degenerate span never reads "NaN". Pure so it pins headlessly. */
        fun formatMSS(seconds: Double): String {
            val safe = if (seconds.isFinite()) seconds else 0.0
            val total = maxOf(0, kotlin.math.floor(safe).toInt())
            val hours = total / 3600
            val minutes = (total % 3600) / 60
            val secs = total % 60
            return if (hours > 0) {
                "$hours:${"%02d".format(minutes)}:${"%02d".format(secs)}"
            } else {
                "$minutes:${"%02d".format(secs)}"
            }
        }
    }
}

/** The solving-tempo ribbon's data: a fixed-length, peak-normalized intensity series and the span
 *  it covers (engine `momentum`). */
data class RoomMomentum(
    /** The solve span in seconds (0 for an empty or instant solve). */
    val durationSeconds: Double,
    /** 40 samples in [0, 1], each a bucket's fill count over the busiest bucket's (engine
     *  MOMENTUM_SAMPLES). All zero when nothing was filled. */
    val samples: List<Double>,
) {
    /** True when any bucket carried a fill: the ribbon has a shape to draw, rather than the flat
     *  quiet line a short solve leaves. */
    val hasSignal: Boolean get() = samples.any { it > 0 }
}

/** One solver superlative (design/post-game/TITLES.md): the wire's award, carried verbatim. `key` is
 *  the lowercase-kebab ladder key ("saboteur"); the display table (TitleLadder) decides what it knows,
 *  so an unknown key from a grown ladder is skipped at render, never dropped here (forward
 *  compatibility, PROTOCOL.md §12). Twin of the iOS RoomTitle. */
data class RoomTitle(
    val userId: String,
    /** The pinned lowercase-kebab title key, verbatim from the wire. */
    val key: String,
    /** The rung's own count (overwrites, whole seconds, squares), or null for a rung that cites
     *  none. Never a letter (INV-6). */
    val evidence: Int?,
)

/** The sittings partition, render-ready (design/post-game/SITTINGS.md, D29): the count for the
 *  headline's context suffix, the spans for the ribbon's seam ticks, and the wall span for flavor
 *  copy. All seconds ride the bundle's active axis, the same axis as `RoomMomentum.durationSeconds`,
 *  so a seam places by lookup. Twin of the iOS RoomSittings. */
data class RoomSittings(
    val count: Int,
    val spans: List<Span>,
    /** The wall-clock trace span (the pre-D29 duration), flavor only, never a competing stat
     *  (owner ruling, D29). */
    val wallSeconds: Double,
) {
    /** One sitting's reach on the active axis, contiguous with its neighbors. */
    data class Span(val startSeconds: Double, val endSeconds: Double)

    /** The interior sitting boundaries on the active axis: `spans[k].endSeconds` for every k but the
     *  last, where the ribbon draws its seam ticks. Empty for a single sitting, so the ribbon renders
     *  exactly as today. */
    val interiorBoundarySeconds: List<Double>
        get() = spans.dropLast(1).map { it.endSeconds }
}

/** The room's longest pause and the burst that ended it (engine `TurningPoint`): the ribbon
 *  shades the stall span and marks where solving picked back up. */
data class RoomTurningPoint(
    /** The largest gap between consecutive fills, in seconds. */
    val stallSeconds: Double,
    /** The relative time, in seconds, of the fill that ended the gap. */
    val breakSeconds: Double,
    /** Fills within the 30-second window after the break (engine BURST_WINDOW_MS). */
    val burst: Int,
)

/** The analysis fetch's state machine, the thin observable the solve screen drives (twin of iOS
 *  AnalysisModel). The bundle is fetched exactly once per completed room, off an injected suspend
 *  closure (the composition root closes over the REST client and game id, keeping :ui out of the
 *  REST ring). A completion can be observed over the socket a beat before the session has flushed
 *  completed_at to Postgres, so the endpoint 404s for a short window right after a live finish;
 *  the load retries a few times before it calls the game absent (the web client's
 *  completion-race guard). */
class AnalysisModel {
    /** The fetch's four states: not yet asked, in flight, resolved, or given up (a 404 past the
     *  retries, or a genuine absence). */
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data class Ready(val bundle: RoomAnalysis) : Phase
        data object Absent : Phase
    }

    var phase: Phase by mutableStateOf(Phase.Idle)
        private set

    /** The resolved bundle, or null until it lands. */
    val bundle: RoomAnalysis? get() = (phase as? Phase.Ready)?.bundle

    /** Kick the one fetch for this room. Idempotent: a second call while a fetch is in flight or
     *  already resolved is a no-op, so both the completion edge and a tab-open can ask without
     *  racing. `fetch` returns null on any failure (a 404, transport weather, a decode fault);
     *  the retries cover the completion race, after which absent stands. Suspends on the caller's
     *  scope (the room's), so leaving the room cancels the walk. */
    suspend fun load(
        tries: Int = 3,
        delayMillis: Long = 700,
        fetch: suspend () -> RoomAnalysis?,
    ) {
        if (phase != Phase.Idle) return
        phase = Phase.Loading
        repeat(maxOf(1, tries)) { attempt ->
            val bundle = fetch()
            if (bundle != null) {
                phase = Phase.Ready(bundle)
                return
            }
            if (attempt < tries - 1) delay(delayMillis)
        }
        phase = Phase.Absent
    }
}
