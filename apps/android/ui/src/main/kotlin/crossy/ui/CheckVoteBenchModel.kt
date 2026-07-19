// The check vote's presentation model (PROTOCOL.md §10, D32; Wave 15.6 UX), the pure half of the
// Bench. It owns the normative copy, the five-beat phase machine, the elector chip states, and the
// hold-to-propose timing, all as pure functions of the store's VoteView plus a frame clock. Compose
// imports NONE of this: the composable (VoteBench) reads these functions and paints, so the copy and
// the timing are headlessly tested (the ReactionModel / StickerEnvelope idiom). Nothing here holds a
// clock or a color; `now` and the ground arrive at the call site. The web UI is not the spec
// (CLAUDE.md): this is the app's own idiom, the Bench, not a dialog and a countdown.

package crossy.ui

import crossy.store.VoteView

/**
 * The vote's copy, exact and in one place (Wave 15.6 spec). No counts are ever shown to the room and
 * no countdown digits appear anywhere: the vote surfaces no clock (Wave 15.9b). The post-fail tally
 * is the one count, and it is the proposer's alone.
 */
object VoteCopy {
    /** The proposal line under the proposer, and the polite open announcement (TalkBack). */
    fun proposal(name: String): String = "$name wants to check the puzzle"

    /** The proposer's own view of the line (owner ruling, Wave 15.9a): they read the room's pending
     *  answer, never their own name in the third person. */
    const val WAITING_FOR_ROOM: String = "Waiting for the room"

    /** A departed or unknown proposer: the line stays collective, never a raw userId. */
    const val PROPOSER_FALLBACK: String = "A teammate"

    /** A departed or unknown elector's chip name: a neutral placeholder, never a raw userId. */
    const val CHIP_FALLBACK: String = "Player"

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

    /** The breath after a passing close, "Checking…" before the mark wash. */
    const val REVEAL_BREATH_MS: Long = 600L

    /** The wrong-cell wash budget: marks paint in ascending cell order within this. */
    const val WASH_MAX_MS: Long = 900L

    /** The recess: the one calm line lingers, then the Bench withdraws. No try-again affordance. */
    const val RECESS_MS: Long = 2_500L
}

/**
 * The passing reveal's ascending mark wash (PROTOCOL.md §10, D32; UX.md U6), the flagship beat. When
 * the breath ends the wrong-cell marks appear in ascending cell order, each cell's coat animating in
 * over [COAT_MS], staggered by [perCellDelayMs] per rank, the whole wash under 900 ms. Pure so the
 * timing is headlessly pinned (the grid draw pass calls [progress] with its own frame clock); reduced
 * motion never runs it (the room shows every mark at once at the breath end).
 */
object CheckWash {
    /** Each cell's coat fades and scales in over this long. */
    const val COAT_MS: Double = 360.0

    /** The per-rank stagger: `min(60 ms, 500 ms / (n - 1))`, so the last cell never starts past 500 ms
     *  and the whole wash (stagger + one coat) stays under 900 ms for any n. Zero for a single mark. */
    fun perCellDelayMs(n: Int): Double = if (n > 1) minOf(60.0, 500.0 / (n - 1)) else 0.0

    /** The whole wash's duration for n marks: the last cell's start plus one coat. Always under 900 ms. */
    fun totalMs(n: Int): Double = if (n <= 0) 0.0 else perCellDelayMs(n) * (n - 1) + COAT_MS

    /** The coat progress 0..1 for the cell at ascending [rank] (of [n]) at [elapsedMs] since the wash
     *  start. Alpha is this; the scale-in is `0.6 + 0.4 * progress`. */
    fun progress(rank: Int, n: Int, elapsedMs: Double): Double =
        ((elapsedMs - rank * perCellDelayMs(n)) / COAT_MS).coerceIn(0.0, 1.0)
}

/** One elector's ballot state for a chip (PROTOCOL.md §10; D32). Unvoted chips render dimmed. */
enum class ChipVote { APPROVED, REJECTED, UNVOTED }

/**
 * The viewer's relation to an open vote (PROTOCOL.md §10, D32; Wave 15.12 card): the proposer sees
 * pucks and no verbs (their proposal already approved), an unvoted elector sees the two verbs, and a
 * non-elector reads only. The card's dismissal policy reads this. Twin of iOS CheckVoteViewerRole.
 */
enum class CheckVoteRole { PROPOSER, ELECTOR, NON_ELECTOR }

/**
 * The card's dismissal policy (Wave 15.12 card ruling, mirror of iOS CheckVoteCardPolicy): the wire
 * has no vote-cancel, so a blocking card with no verb could hold its viewer the whole timebox. The
 * elector's ballot is the exit and their card never dismisses while it is castable; everyone without
 * a castable ballot — the proposer, a non-elector, a rejoined already-voted elector — may put the
 * card away and return to the board. The vote stays live in the store; the resolution re-presents.
 */
object CheckVoteCardPolicy {
    fun isDismissible(role: CheckVoteRole, hasOpenBallot: Boolean): Boolean =
        !(role == CheckVoteRole.ELECTOR && hasOpenBallot)
}

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
    data class Passed(
        val wrongCells: Int,
        override val startedAt: Long,
    ) : VoteResolution

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
     * userId to its display name, or null when the elector is departed/unknown; a null falls back to
     * [VoteCopy.CHIP_FALLBACK] so a chip never renders a raw userId (Wave 15.9a).
     */
    fun chips(vote: VoteView, selfUserId: String?, names: (String) -> String?): List<ElectorChip> =
        vote.electorate.map { id ->
            ElectorChip(
                userId = id,
                name = names(id) ?: VoteCopy.CHIP_FALLBACK,
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
     * The proposal line (Wave 15.9a owner ruling): the proposer reads the room's pending answer, not
     * their own name in the third person; others read "{name} wants to check the puzzle"; a departed
     * or unknown proposer falls back to [VoteCopy.PROPOSER_FALLBACK]. `proposerName` is null when the
     * proposer is not a known participant.
     */
    fun proposalLine(vote: VoteView, selfUserId: String?, proposerName: String?): String =
        if (vote.by == selfUserId) VoteCopy.WAITING_FOR_ROOM
        else VoteCopy.proposal(proposerName ?: VoteCopy.PROPOSER_FALLBACK)

    /**
     * The chips' merged content description (U5, Wave 15.9a): the chips are the room's ONLY tally, so
     * TalkBack needs one spoken summary of the ballot state that updates per ballot. One clause per
     * state in ballot order (checked, kept solving, not voted), each naming its electors; the ring
     * stays decorative. Empty electorate yields an empty string.
     */
    fun chipsSummary(chips: List<ElectorChip>): String {
        val approved = chips.filter { it.vote == ChipVote.APPROVED }.map { it.name }
        val rejected = chips.filter { it.vote == ChipVote.REJECTED }.map { it.name }
        val unvoted = chips.filter { it.vote == ChipVote.UNVOTED }.map { it.name }
        return buildList {
            if (approved.isNotEmpty()) add("${joinNames(approved)} voted check")
            if (rejected.isNotEmpty()) add("${joinNames(rejected)} voted keep solving")
            if (unvoted.isNotEmpty()) add("${joinNames(unvoted)} ${if (unvoted.size == 1) "hasn't" else "haven't"} voted")
        }.joinToString(", ")
    }

    /** A natural-language name list: "Ana", "Ana and Ben", "Ana, Ben, and Cleo" (Oxford comma). */
    private fun joinNames(names: List<String>): String = when (names.size) {
        0 -> ""
        1 -> names[0]
        2 -> "${names[0]} and ${names[1]}"
        else -> names.dropLast(1).joinToString(", ") + ", and " + names.last()
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

    /**
     * The viewer's role in an open vote (Wave 15.12): the proposer, an elector, or a reader. A null
     * self, or a self off the electorate that is not the proposer, reads only. Twin of iOS
     * CheckVoteCardModel.viewerRole.
     */
    fun role(vote: VoteView, selfUserId: String?): CheckVoteRole = when {
        selfUserId != null && selfUserId == vote.by -> CheckVoteRole.PROPOSER
        selfUserId != null && selfUserId in vote.electorate -> CheckVoteRole.ELECTOR
        else -> CheckVoteRole.NON_ELECTOR
    }

    /**
     * Whether the local viewer's card may be dismissed back to the board (Wave 15.12 card policy).
     * Only a still-unvoted elector is held (their ballot is the exit); the proposer, a non-elector,
     * and a rejoined already-voted elector may all put it away while the vote runs. Binds the pure
     * [CheckVoteCardPolicy] to the live vote and the local identity.
     */
    fun cardDismissible(vote: VoteView, selfUserId: String?): Boolean =
        CheckVoteCardPolicy.isDismissible(role(vote, selfUserId), hasOpenBallot = showVerbs(vote, selfUserId))

    // --- Hold-to-propose (the call) ---

    /** The hold fill, 0..1 over [VoteBenchTiming.HOLD_MS]; the control proposes the vote at 1.0. */
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
    fun resolutionLine(resolution: VoteResolution, nowMillis: Long, reduceMotion: Boolean = false): String? = when (resolution) {
        is VoteResolution.Passed -> {
            // "{n} to fix" lands LAST (U6): it holds "Checking…" through the breath AND the wash, then
            // the count arrives at breath + wash. Reduced motion has no breath or wash, so the count
            // (like the marks) applies instantly.
            val landed = reduceMotion ||
                nowMillis - resolution.startedAt >= VoteBenchTiming.REVEAL_BREATH_MS + VoteBenchTiming.WASH_MAX_MS
            if (landed) VoteCopy.toFix(resolution.wrongCells) else VoteCopy.CHECKING
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

    /**
     * The polite open announcement, per role (U10, Wave 15.12; mirror of iOS CheckVoteAnnouncement
     * .opened): an elector hears the question and that actions exist; the proposer hears their
     * proposal confirmed; a non-elector hears the question alone (no actions to offer).
     */
    fun openAnnouncement(role: CheckVoteRole, proposerName: String): String = when (role) {
        CheckVoteRole.PROPOSER -> "Check proposed. ${VoteCopy.WAITING_FOR_ROOM}."
        CheckVoteRole.ELECTOR -> "${VoteCopy.proposal(proposerName)}. Actions available."
        CheckVoteRole.NON_ELECTOR -> "${VoteCopy.proposal(proposerName)}."
    }

    /**
     * The polite close announcement for the resolution CARD (U10, Wave 15.12; mirror of iOS
     * CheckVoteAnnouncement.closed): the one calm line joined with the proposer's tally when it
     * stands, each ended with a period. Null for a terminal close and for a pass (the pass speaks
     * "Checking…" and "{n} to fix" through the status capsule, not the card).
     */
    fun closeAnnouncement(resolution: VoteResolution): String? = when (resolution) {
        is VoteResolution.Ended -> {
            val line = resolutionAnnouncement(resolution) ?: return null
            listOfNotNull(line, proposerTally(resolution)).joinToString(" ") { "$it." }
        }
        is VoteResolution.Passed -> null
    }
}
