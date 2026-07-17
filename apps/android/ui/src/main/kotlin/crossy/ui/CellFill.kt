// Cell background precedence, exactly as root DESIGN.md §10 orders it:
// black square > current cell > check highlight > cross-reference highlight >
// active word > teammate-here > default. One resolver, pinned by CellFillTests so the order
// can never fork between grounds or code paths. Twin of the iOS GridFill CellFill.

package crossy.ui

/** What paints a cell's background. Entries are declared in precedence order. */
enum class CellFill {
    BLOCK,
    CURRENT,

    /** The room-wide check mark (PROTOCOL.md §10, D27): a standing `checkedWrong` cell wears a flat
     *  check-token coat, identical for every member (a room act, never a personal color), above the
     *  cross-reference wash and below the current-cell fill. A cell with a pending optimistic
     *  overlay renders the overlay, not the mark: the caller suppresses it before resolve. */
    CHECK,

    /** The clue under the cursor names this cell's word ("With 27-Down"): a faint tint below check
     *  and above the active word, so a checked cell reads first and a referenced cell outranks the
     *  active word where the two words cross (DESIGN.md §10). */
    CROSS_REFERENCE,
    ACTIVE_WORD,
    TEAMMATE,
    BASE,
    ;

    companion object {
        /** Resolve one cell's fill from its flags. The conflict flash is not a background level:
         *  it paints above everything and decays (PROTOCOL.md §8), so it is not modeled here. */
        fun resolve(
            isBlock: Boolean,
            isCurrent: Boolean,
            isChecked: Boolean = false,
            isCrossReferenced: Boolean = false,
            inActiveWord: Boolean = false,
            hasTeammate: Boolean = false,
        ): CellFill = when {
            isBlock -> BLOCK
            isCurrent -> CURRENT
            isChecked -> CHECK
            isCrossReferenced -> CROSS_REFERENCE
            inActiveWord -> ACTIVE_WORD
            hasTeammate -> TEAMMATE
            else -> BASE
        }
    }
}
