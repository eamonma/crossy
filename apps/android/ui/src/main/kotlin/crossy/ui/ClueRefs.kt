// Pure reference parser plus the resolution chokepoint: given a clue's prose, find the entries it
// points at ("See 42-Down", "17, 20, 49, and 59 across"), and resolve those against the puzzle's
// real clue lists into one key set the board tint reads. Parse is string-only, no puzzle
// knowledge and no IO; resolution is the one place existence and self-exclusion are decided.
//
// The hard part of the parse is the distributed list: one trailing direction word governs every
// number before it ("5 and 12 down" is 5-Down and 12-Down). We scan for maximal runs of
// number-then-connector that close on a direction word, then read every number out of the run and
// pair each with that word. A direction word ends its run, so "17-Across and 3-Down" splits into
// two runs and yields one entry per axis.
//
// The starred-clue convention is the second kind of reference (DESIGN.md D26). A theme clue opens
// with a literal `*` and a revealer names the whole set collectively ("...the starred clues"), so
// the pair below is a predicate on the clue and a predicate on the prose, not a parse: a starred
// ref carries no number and no direction to read out. referencedKeys resolves both kinds into one
// key set, so they union and paint the same tier.
//
// Normative twins: apps/web/src/ui/clueRefs.ts (+ clueRefs.test.ts, declared normative for ports)
// and apps/ios/Sources/CrossyUI/ClueRefs.swift + ClueBook.swift. Same pattern strings, ported to
// java.util.regex, which backs the `(?<![0-9])` lookbehinds. The key scheme is iOS's "18A"/"18D"
// (Android's clue identity: axis is implied by which list a Clue sits in, so ClueRef carries an
// isAcross Bool like the iOS twin, not a Direction string like web). Schemes may differ across
// clients; behavior may not.

package crossy.ui

import crossy.protocol.Clue

/** A (number, isAcross) pair a clue's text references. The web's ClueRef carries a `Direction`
 *  string; here the axis is a Bool to match Android's list-implies-axis clue model, as on iOS. */
data class ClueRef(val number: Int, val isAcross: Boolean)

// One run: some numbers joined by list connectors (comma, "and", "&", hyphen, whitespace, in any
// run), closed by a direction word. The connector before the direction word is a hyphen or spaces
// ("17-Across", "17 Across"); requiring [\s-]+ there keeps "12down" glued prose out. The trailing
// \b stops "Downtown" or "Rundown" from reading as a direction. Case-insensitive per the
// direction-word requirement.
//
// [0-9]{1,3} caps a number at three digits (clue numbers never run longer), and the (?<![0-9])
// guard forbids a preceding digit, so a four-digit year ("in 1999") can never donate its last
// three digits to a run. Together they reject years and enumerations that carry no direction.
private val RUN =
    Regex(
        "(?<![0-9])([0-9]{1,3}(?:(?:\\s*(?:,|&|-|and|\\s)\\s*)+(?<![0-9])[0-9]{1,3})*)[\\s-]+(across|down)\\b",
        RegexOption.IGNORE_CASE,
    )

// The numbers inside a run, read left to right. Same three-digit cap and leading-digit guard as
// RUN so the two never disagree on what counts as one number.
private val NUMBER = Regex("(?<![0-9])[0-9]{1,3}")

// A revealer naming the starred set. The noun is required: "starred" alone is ordinary prose
// ("Starred in a movie"), and only the adjacent noun separates the convention from the verb. The
// asymmetry is why this is biased hard toward precision: a missed revealer degrades to no
// highlight, while a false one paints roughly a quarter of the grid. [\s-]+ is the same connector
// idiom RUN uses, so a hyphenated "starred-clue" reads like "17-Across" does. Case-insensitive:
// the revealer opens a sentence as often as not.
private val STARRED =
    Regex(
        "\\b(?:starred|asterisked)[\\s-]+(?:clues?|answers?|entries|entry|squares?)\\b",
        RegexOption.IGNORE_CASE,
    )

// The convention's mark: a literal `*` opening the clue, leading whitespace tolerated. PROTOCOL
// section 12 law 11 carries the star through ingestion verbatim, so plain `text` is the whole
// story here. Read `text`, never `runs`: the runs concatenate to `text` (law 1), so a star split
// into its own styled run still shows up at the front of `text`.
private val STARRED_MARK = Regex("^\\s*\\*")

/** The clue identity key, iOS's scheme: number then axis letter ("18A" / "18D"). The board tint
 *  looks a clue up by this key, so both the exists set and the reference set speak it. */
private fun clueKey(number: Int, isAcross: Boolean): String = "$number${if (isAcross) 'A' else 'D'}"

/**
 * The (number, isAcross) pairs a clue's text references, in reading order, duplicates kept.
 * Returns [] when the text is empty or null, or when it names no entry. A bare number, a year, or
 * an enumeration like "(17)" carries no direction word, so none of them produce a pair.
 */
fun parseClueRefs(text: String?): List<ClueRef> {
    if (text.isNullOrEmpty()) return emptyList()
    val refs = mutableListOf<ClueRef>()
    for (run in RUN.findAll(text)) {
        // Both groups are required by RUN, so a match always carries them.
        val numbers = run.groupValues[1]
        val isAcross = run.groupValues[2].lowercase() == "across"
        for (num in NUMBER.findAll(numbers)) {
            refs.add(ClueRef(num.value.toInt(), isAcross))
        }
    }
    return refs
}

/**
 * Whether a clue wears the starred-clue convention, meaning its prose opens with a literal `*`.
 * `Clue.text` is a non-optional String here, so the web's absent-text case has no Android analogue
 * and an empty string simply fails to match.
 */
fun isStarredClue(clue: Clue): Boolean = STARRED_MARK.containsMatchIn(clue.text)

/**
 * Whether a clue's text is a revealer, meaning it names the starred clues collectively. The link
 * is one-way by ruling (D26): this answers "does this prose name the starred set?", and a starred
 * clue's own prose names nothing, so a starred clue is never a revealer by virtue of its star.
 * Returns false for empty or null text.
 */
fun referencesStarredClues(text: String?): Boolean =
    text != null && STARRED.containsMatchIn(text)

/**
 * The keys of every clue the active clue references, keyed "18A"/"18D". This is the chokepoint:
 * both kinds of reference resolve here and union into one set (D26), the numbers the prose names
 * and, when the prose is a revealer, every starred clue. The single gate is the mark: a reference
 * to an entry this grid lacks, or the active clue naming itself, never lights a row. The parsers
 * read intent only; existence is decided here, against the puzzle's real clue lists.
 *
 * `active` is the clue under the cursor and `activeIsAcross` its axis (which list it came from);
 * Android's Clue carries no direction field, so the axis rides alongside. Empty when there is no
 * active clue, or when the clue names no entry that exists.
 *
 * The web twin is `referencedKeys`, the iOS twin `ClueBook.referencedIds(for:)`: same guards, same
 * shape, the "18A" key scheme shared with iOS.
 */
fun referencedKeys(
    active: Clue?,
    activeIsAcross: Boolean,
    across: List<Clue>,
    down: List<Clue>,
): Set<String> {
    if (active == null) return emptySet()

    val exists = HashSet<String>()
    for (c in across) exists.add(clueKey(c.number, true))
    for (c in down) exists.add(clueKey(c.number, false))
    val self = clueKey(active.number, activeIsAcross)
    val marks = HashSet<String>()
    fun mark(key: String) {
        if (key != self && key in exists) marks.add(key)
    }

    for (ref in parseClueRefs(active.text)) {
        mark(clueKey(ref.number, ref.isAcross))
    }
    // A revealer names the theme set collectively, so it resolves to every clue wearing the star.
    // One-way by ruling, so a starred clue lights nothing on its own.
    if (referencesStarredClues(active.text)) {
        for (c in across) if (isStarredClue(c)) mark(clueKey(c.number, true))
        for (c in down) if (isStarredClue(c)) mark(clueKey(c.number, false))
    }
    return marks
}

/**
 * The cells a set of referenced clues covers, unioned across both axes. `keys` is `referencedKeys`
 * output, already existence-filtered, so a key naming a clue this puzzle lacks matches nothing and
 * contributes no cells. Same "18A" key scheme the tint reads.
 */
fun referencedCells(
    keys: Set<String>,
    across: List<Clue>,
    down: List<Clue>,
): Set<Int> {
    if (keys.isEmpty()) return emptySet()
    val cells = HashSet<Int>()
    for (c in across) if (clueKey(c.number, true) in keys) cells.addAll(c.cellIndices)
    for (c in down) if (clueKey(c.number, false) in keys) cells.addAll(c.cellIndices)
    return cells
}
