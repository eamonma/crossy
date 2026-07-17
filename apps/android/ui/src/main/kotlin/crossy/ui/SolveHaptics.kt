// The solve's haptic grammar (apps/ios/DESIGN.md §7, roadmap I2e), the pure half: a light tick
// when the cursor travels to another word, a soft thud when a word completes under the local
// hand, a double tick when a word you stand in is finished by someone else, a distinct pattern
// for gameCompleted — and never a haptic for a teammate's routine letters (that would buzz
// constantly in a lively room). Twin of apps/ios SolveHaptics.swift's SolveHaptic/SolveHapticFold;
// the player (the Vibrator-backed twin of iOS's generator class) rides the haptics wiring track,
// so this file stays JVM-pure and headlessly tested.
//
// The grammar is a pure fold over observed (filled, selection) pairs, the CelebrationGate
// pattern: whose hand moved is derived, never plumbed. A delta on the cell the cursor stood on
// is the local hand (you type where you stand); any other single-cell delta is a teammate's. A
// bulk delta is a snapshot (welcome, resync) — history arriving, not a moment, so it is silent.

package crossy.ui

/** One haptic moment, named by DESIGN.md §7's grammar. The player renders it; the fold derives
 *  it; nothing else decides when the room buzzes. */
enum class SolveHaptic {
    /** The cursor traveled to another word: a block crossed, a line changed, a swipe between
     *  words, the axis toggled (owner ruling 2026-07-10 broadening §7's block-cross tick to
     *  every word-to-word travel). */
    TRAVEL_TICK,

    /** A word completed under the local hand. */
    WORD_THUD,

    /** A word the cursor stands in was finished by someone else. */
    DOUBLE_TICK,

    /** The gameCompleted pattern (fired off the INV-3 gate, not this fold). */
    COMPLETION,

    /** Your own reaction left (Wave 7.5): a light confirmation under the fan's fire. */
    REACTION_SENT,

    /** A teammate's sticker landed on or beside your active word (Wave 7.5; gated by proximity
     *  and the receive-haptics toggle, never fired for a sticker across the board). */
    REACTION_LANDED,

    /** The room's check landed (PROTOCOL.md §6, §10; D27): the marks just painted for everyone.
     *  One soft thud in the room-event register (the reactionLanded family, weighted up: a
     *  deliberate act, not a passing wave), never a celebration pattern. Fired off the store's
     *  live-event beat only (GameStore.onPuzzleChecked); snapshot healing stays silent. */
    CHECK_LANDED,
}

/** Starting values for the device tuning pass (DESIGN.md §7: tuned on hardware). One block to
 *  edit; nothing else holds a magic number. Values mirror iOS SolveHapticTuning verbatim. */
object SolveHapticTuning {
    const val TRAVEL_TICK_INTENSITY: Double = 0.6
    const val WORD_THUD_INTENSITY: Double = 1.0
    const val DOUBLE_TICK_INTENSITY: Double = 0.8

    /** The double tick's gap: wide enough to read as two, tight enough to be one gesture. */
    const val DOUBLE_TICK_GAP_MILLISECONDS: Int = 90

    /** The reaction pair (Wave 7.5): your send confirms lightly; a received sticker near your
     *  word taps softer still (it is a wave, not a knock). */
    const val REACTION_SENT_INTENSITY: Double = 0.7
    const val REACTION_LANDED_INTENSITY: Double = 0.5

    /** The room check's landing thud (D27): heavier than a sticker's wave, lighter than the local
     *  word thud. Mirrors iOS SolveHapticTuning.checkLandedIntensity. */
    const val CHECK_LANDED_INTENSITY: Double = 0.8
}

/** The exactly-when derivation. Feed every observed (filled, selection) pair; at most one haptic
 *  comes back per observation. The first observation seeds the fold and never buzzes (a welcome
 *  into a half-filled board is arrival, not action). Mutable the way the iOS struct is: one
 *  instance per room, observed in board order. */
class SolveHapticFold {
    private var filled: Set<Int>? = null
    private var restCell: Int? = null
    private var restIsAcross: Boolean? = null

    fun observe(filled: Set<Int>, selection: GridSelection, geometry: GridGeometry): SolveHaptic? {
        val before = this.filled
        val rest = restCell
        val restAcross = restIsAcross
        this.filled = filled
        restCell = selection.cell
        restIsAcross = selection.isAcross
        if (before == null || rest == null || restAcross == null) return null
        val delta = filled - before

        // Pure movement (a swipe, an advance, a backspace step, a toggle): the tick when the
        // travel lands in another word (owner ruling 2026-07-10: line changes and swipes tick
        // like block crossings; within-word steps stay silent). Clears are movement too.
        if (delta.isEmpty()) {
            if (selection.cell == rest && selection.isAcross == restAcross) return null
            return if (wordChanged(rest, restAcross, selection, geometry)) SolveHaptic.TRAVEL_TICK else null
        }

        // The live wire places one letter at a time; a bulk delta is a snapshot.
        val placed = delta.singleOrNull() ?: return null

        if (placed == rest) {
            // The local hand. A completing letter thuds; the thud outranks the advance's travel
            // tick (one haptic per intent, the loudest fact).
            if (completesAWord(placed, filled, geometry)) return SolveHaptic.WORD_THUD
            return if (wordChanged(rest, restAcross, selection, geometry)) SolveHaptic.TRAVEL_TICK else null
        }

        // Another hand. §7's double tick only when it finishes the word the cursor stands in
        // ("mid-typing" read as the standing word); a teammate's routine letter is silent, always.
        val standing = geometry.wordCells(rest, restAcross)
        if (placed in standing && filled.containsAll(standing)) return SolveHaptic.DOUBLE_TICK
        return null
    }

    companion object {
        /** Whether the travel landed in another word: the standing word's cells before against
         *  after (a block crossing, a line change, an axis toggle, and any jump all change the
         *  word; a step within the word does not). */
        internal fun wordChanged(
            fromCell: Int,
            fromIsAcross: Boolean,
            to: GridSelection,
            geometry: GridGeometry,
        ): Boolean =
            geometry.wordCells(fromCell, fromIsAcross) != geometry.wordCells(to.cell, to.isAcross)

        /** True when a word through the cell stands fully filled: the placed letter was the
         *  word's last empty cell on either axis. */
        internal fun completesAWord(cell: Int, after: Set<Int>, geometry: GridGeometry): Boolean =
            after.containsAll(geometry.wordCells(cell, isAcross = true)) ||
                after.containsAll(geometry.wordCells(cell, isAcross = false))
    }
}
