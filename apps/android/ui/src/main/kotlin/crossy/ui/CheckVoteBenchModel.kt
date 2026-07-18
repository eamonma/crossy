// The check vote's presentation model (PROTOCOL.md §10, D32; Wave 15.6 UX), the pure half of the
// Bench and the ring. It owns the normative copy, the five-beat phase machine, the elector chip
// states, the ring's drain, and the hold-to-propose timing, all as pure functions of the store's
// VoteView plus a frame clock. Compose imports NONE of this: the composables (VoteBench, VoteRing)
// read these functions and paint, so the copy and the timing are headlessly tested (the ReactionModel
// / StickerEnvelope idiom). Nothing here holds a clock or a color; `now` and the ground arrive at the
// call site. The web UI is not the spec (CLAUDE.md): this is the app's own idiom, the Bench and the
// ring, not a dialog and a countdown.

package crossy.ui

import crossy.store.VoteView

/**
 * The vote's copy, exact and in one place (Wave 15.6 spec). No counts are ever shown to the room and
 * no countdown digits appear anywhere: the ring is the only clock. The post-fail tally is the one
 * count, and it is the proposer's alone.
 */
object VoteCopy {
    /** The proposal line under the proposer, and the polite open announcement (TalkBack). */
    fun proposal(name: String): String = "$name wants to check the puzzle"

    /** The two verbs, "Check it" primary. */
    const val CHECK_IT: String = "Check it"
    const val KEEP_SOLVING: String = "Keep solving"

    /** The passing reveal: "Checking…" during the breath, then "{n} to fix" as the marks wash in. */
    const val CHECKING: String = "Checking…"
    fun toFix(wrongCells: Int): String = "$wrongCells to fix"

    /** The one calm recess line per non-passing outcome. TERMINAL shows no line: the completion or
     *  abandon UI supersedes it. */
    const val REJECTED: String = "The room keeps solving"
    const val EXPIRED: String = "The vote lapsed"
    const val GRID_BROKEN: String = "Vote ended, the grid changed"

    /** The proposer-only post-fail tally, the one count the vote ever shows. */
    fun tally(approvals: Int, needed: Int): String = "$approvals of $needed"
}

/** The Bench's timing constants (Wave 15.6). One block; nothing else holds a magic number. */
object VoteBenchTiming {
    /** Press-and-hold to propose in multiplayer; early release cancels. */
    const val HOLD_MS: Long = 600L

    /** The breath after a passing close, "Checking…" before the ring flash and the mark wash. */
    const val REVEAL_BREATH_MS: Long = 600L

    /** The wrong-cell wash budget: marks paint in ascending cell order within this. */
    const val WASH_MAX_MS: Long = 900L

    /** The recess: the one calm line lingers, then the Bench withdraws. No try-again affordance. */
    const val RECESS_MS: Long = 2_500L

    /** Discrete ring levels under reduced motion (a stepped drain instead of a continuous sweep). */
    const val REDUCED_MOTION_RING_STEPS: Int = 6
}

/** One elector's ballot state for a chip (PROTOCOL.md §10; D32). Unvoted chips render dimmed. */
enum class ChipVote { APPROVED, REJECTED, UNVOTED }

/**
 * One elector chip: the frozen identity (existing avatar/color keyed by userId), the ballot state,
 * and the two role flags the Bench reads. `isProposer` opened in APPROVED; `isSelf` is the local
 * elector. No count is derived here (the room never sees a tally): the chips are the whole tally the
 * room reads, one settled dot per ballot.
 */
data class ElectorChip(
    val userId: String,
    val name: String,
    val vote: ChipVote,
    val isProposer: Boolean,
    val isSelf: Boolean,
)

/**
 * A resolved vote the Bench animates out: the reveal (passed) or the recess (failed/cancelled). The
 * composable captures this the instant the store's VoteClosed beat fires, snapshotting the count the
 * reveal needs and the proposer's post-fail tally, since the store's `checkVote` is already cleared.
 * `startedAt` is the frame clock at close.
 */
sealed interface VoteResolution {
    val startedAt: Long

    /** A passing close: the check ran. `wrongCells` is the count for "{n} to fix". */
    data class Passed(val wrongCells: Int, override val startedAt: Long) : VoteResolution

    /**
     * A non-passing close (PROTOCOL.md §10 reasons). `reason` is REJECTED / EXPIRED / GRID_BROKEN /
     * TERMINAL. `approvalsAtClose` and `needed` feed the proposer-only tally. `isProposer` gates that
     * tally to the proposer alone.
     */
    data class Ended(
        val reason: String?,
        val approvalsAtClose: Int,
        val needed: Int,
        val isProposer: Boolean,
        override val startedAt: Long,
    ) : VoteResolution
}

/**
 * The Bench's pure model. Every method is a pure function of a VoteView (open vote) or a
 * VoteResolution (a closed one animating out) plus the frame clock; the composable owns the state
 * transitions and the drawing.
 */
object CheckVoteBenchModel {

    // --- Chips and verbs (the floor and the division) ---

    /**
     * The elector chips in electorate order (already ascending ASCII, INV-1). `names` resolves a
     * userId to its display name; an unknown id falls back to the id so a chip never renders blank.
     */
    fun chips(vote: VoteView, selfUserId: String?, names: (String) -> String): List<ElectorChip> =
        vote.electorate.map { id ->
            ElectorChip(
                userId = id,
                name = names(id),
                vote = when {
                    id in vote.approvals -> ChipVote.APPROVED
                    id in vote.rejections -> ChipVote.REJECTED
                    else -> ChipVote.UNVOTED
                },
                isProposer = id == vote.by,
                isSelf = id == selfUserId,
            )
        }

    /**
     * Whether the local user sees the two verbs. Only a still-unvoted elector votes: the proposer
     * already approved (chips, no verbs), and a non-elector reads only (no verbs). A closed or absent
     * vote shows nothing.
     */
    fun showVerbs(vote: VoteView?, selfUserId: String?): Boolean {
        if (vote == null || selfUserId == null) return false
        return selfUserId in vote.electorate && !vote.hasVoted(selfUserId)
    }

    // --- The ring (the only clock) ---

    /**
     * The ring's remaining fraction, 1.0 at open draining to 0.0 at expiry (PROTOCOL.md §10). The
     * halo draws this share of its full length; it is the only clock, so no digits accompany it.
     */
    fun ringFraction(vote: VoteView, nowMillis: Long): Float =
        (vote.remainingMillis(nowMillis).toFloat() / CHECK_VOTE_TTL_MS_FLOAT).coerceIn(0f, 1f)

    /**
     * The stepped ring fraction under reduced motion: the continuous drain quantized to
     * [VoteBenchTiming.REDUCED_MOTION_RING_STEPS] discrete levels, so the halo steps its opacity
     * instead of sweeping (the §7 reduced-motion form). Ceil so a just-opened vote reads full.
     */
    fun ringFractionStepped(vote: VoteView, nowMillis: Long): Float {
        val steps = VoteBenchTiming.REDUCED_MOTION_RING_STEPS
        val raw = ringFraction(vote, nowMillis)
        return (kotlin.math.ceil(raw * steps) / steps).coerceIn(0f, 1f)
    }

    /** The ring fraction for the active motion mode: continuous, or stepped under reduced motion. */
    fun ringFraction(vote: VoteView, nowMillis: Long, reduceMotion: Boolean): Float =
        if (reduceMotion) ringFractionStepped(vote, nowMillis) else ringFraction(vote, nowMillis)

    // --- Hold-to-propose (the call) ---

    /** The hold fill, 0..1 over [VoteBenchTiming.HOLD_MS]; the control ignites the ring at 1.0. */
    fun holdFraction(heldMillis: Long): Float =
        (heldMillis.toFloat() / VoteBenchTiming.HOLD_MS).coerceIn(0f, 1f)

    /** Whether the hold has reached the propose threshold (an early release cancels below it). */
    fun holdComplete(heldMillis: Long): Boolean = heldMillis >= VoteBenchTiming.HOLD_MS

    // --- The resolution beats (reveal and recess) ---

    /**
     * The single line the resolved Bench shows at `now`, or null when none (a TERMINAL close, whose
     * completion/abandon UI supersedes any line). A passing close reads "Checking…" through the
     * breath, then "{n} to fix" as the marks wash; a non-passing close reads its one calm line.
     */
    fun resolutionLine(resolution: VoteResolution, nowMillis: Long): String? = when (resolution) {
        is VoteResolution.Passed ->
            if (nowMillis - resolution.startedAt < VoteBenchTiming.REVEAL_BREATH_MS) {
                VoteCopy.CHECKING
            } else {
                VoteCopy.toFix(resolution.wrongCells)
            }
        is VoteResolution.Ended -> when (resolution.reason) {
            "REJECTED" -> VoteCopy.REJECTED
            "EXPIRED" -> VoteCopy.EXPIRED
            "GRID_BROKEN" -> VoteCopy.GRID_BROKEN
            else -> null // TERMINAL (or an unknown reason): no line, the terminal UI takes over
        }
    }

    /**
     * The proposer-only post-fail tally "{approvals} of {needed}", or null when it must not show
     * (not the proposer, a passing or TERMINAL close). The one count the vote surfaces, and only to
     * the proposer.
     */
    fun proposerTally(resolution: VoteResolution): String? = when (resolution) {
        is VoteResolution.Ended ->
            if (resolution.isProposer && resolution.reason != "TERMINAL" && resolution.reason != null) {
                VoteCopy.tally(resolution.approvalsAtClose, resolution.needed)
            } else {
                null
            }
        else -> null
    }

    /** Whether the ring should be flash-dissolving (a passing reveal, after the breath). */
    fun ringDissolving(resolution: VoteResolution, nowMillis: Long): Boolean =
        resolution is VoteResolution.Passed &&
            nowMillis - resolution.startedAt >= VoteBenchTiming.REVEAL_BREATH_MS

    /**
     * The mark-wash progress 0..1 over [VoteBenchTiming.WASH_MAX_MS], starting after the breath on a
     * passing close; 0 before the breath and for any non-passing close. The grid paints wrong-cell
     * marks in ascending order across this, in the existing check-mark style.
     */
    fun washProgress(resolution: VoteResolution, nowMillis: Long): Float {
        if (resolution !is VoteResolution.Passed) return 0f
        val since = nowMillis - resolution.startedAt - VoteBenchTiming.REVEAL_BREATH_MS
        if (since <= 0L) return 0f
        return (since.toFloat() / VoteBenchTiming.WASH_MAX_MS).coerceIn(0f, 1f)
    }

    /** Whether the resolved Bench has finished its recess and should withdraw at `now`. */
    fun resolutionComplete(resolution: VoteResolution, nowMillis: Long): Boolean {
        val elapsed = nowMillis - resolution.startedAt
        return when (resolution) {
            is VoteResolution.Passed -> elapsed >= VoteBenchTiming.REVEAL_BREATH_MS + VoteBenchTiming.RECESS_MS
            is VoteResolution.Ended -> elapsed >= VoteBenchTiming.RECESS_MS
        }
    }

    /** The polite TalkBack announcement for a resolution, or null when there is no line (TERMINAL). */
    fun resolutionAnnouncement(resolution: VoteResolution): String? = when (resolution) {
        is VoteResolution.Passed -> VoteCopy.toFix(resolution.wrongCells)
        is VoteResolution.Ended -> when (resolution.reason) {
            "REJECTED" -> VoteCopy.REJECTED
            "EXPIRED" -> VoteCopy.EXPIRED
            "GRID_BROKEN" -> VoteCopy.GRID_BROKEN
            else -> null
        }
    }

    private const val CHECK_VOTE_TTL_MS_FLOAT: Float = 30_000f
}
