// The clue browser's pure row rules (twin of apps/ios ClueBook.ClueBrowserList): given the two clue
// lists, the local selection, the rendered fill set, and the keys the current clue cross-references,
// derive each row's render facts (current / crossing / dimmed / referenced) and the jump a tapped row
// takes. The washes are achromatic emphasis (DESIGN.md §3): the current word leans on a quiet ink
// wash, the crossing word on half of one, a referenced clue on a fainter rung, and a fully filled
// word de-emphasizes. Pure and Compose-free, so tests pin the wash and jump rules without a view.
//
// The referenced set speaks the "18A"/"18D" key scheme ClueRefs.referencedKeys emits, so a row checks
// its own key against it (self already excluded there). The jump is the web's clueClick verbatim: the
// clue's first cell, its axis set, no first-empty scan (that is Tab's rule, not the pointer's).

package crossy.ui

import crossy.protocol.Clue

/** One clue-browser row's render facts. `firstCell`/`isAcross` carry the jump target so the view
 *  needs no puzzle lookup on tap; a row is never both current and referenced (current wins). */
data class ClueBrowserRow(
    val number: Int,
    val text: String,
    val isAcross: Boolean,
    val firstCell: Int,
    val isCurrent: Boolean,
    val isCrossing: Boolean,
    val isDimmed: Boolean,
    val isReferenced: Boolean,
)

object ClueBrowser {
    /** A word is filled when every cell of it renders non-null (the INV-10 composite). */
    fun isFilled(clue: Clue, filled: Set<Int>): Boolean =
        clue.cellIndices.isNotEmpty() && clue.cellIndices.all { it in filled }

    /** One direction's rows against the selection, the rendered fill set, and the referenced keys
     *  (ClueRefs.referencedKeys). `isAcross` is the axis of this whole list (Android's clue model
     *  implies axis by list). A row is current when the cursor sits on its word AND shares its axis,
     *  crossing when on the word off-axis, dimmed when filled and neither, referenced when the current
     *  clue names it (and it is not itself current). */
    fun rows(
        clues: List<Clue>,
        isAcross: Boolean,
        selection: GridSelection?,
        filled: Set<Int>,
        referenced: Set<String>,
    ): List<ClueBrowserRow> =
        clues.map { clue ->
            val onWord = selection?.let { it.cell in clue.cellIndices } ?: false
            val isCurrent = onWord && selection?.isAcross == isAcross
            val isCrossing = onWord && !isCurrent
            val dimmed = !isCurrent && !isCrossing && isFilled(clue, filled)
            val key = "${clue.number}${if (isAcross) 'A' else 'D'}"
            val isReferenced = !isCurrent && key in referenced
            ClueBrowserRow(
                number = clue.number,
                text = clue.text,
                isAcross = isAcross,
                firstCell = clue.cellIndices.firstOrNull() ?: 0,
                isCurrent = isCurrent,
                isCrossing = isCrossing,
                isDimmed = dimmed,
                isReferenced = isReferenced,
            )
        }

    /** The jump a tapped row takes (the web's clueClick, verbatim): the clue's first cell, its axis
     *  set. */
    fun jumpTarget(row: ClueBrowserRow): GridSelection = GridSelection(row.firstCell, row.isAcross)
}
