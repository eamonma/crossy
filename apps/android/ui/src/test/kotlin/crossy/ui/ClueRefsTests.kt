// Clue cross-reference tests, ported case-for-case from the normative web suite
// apps/web/src/ui/clueRefs.test.ts (declared normative for ports) with the iOS-shaped "18A"/"18D"
// key scheme. Each test cites the web `it(...)` name it mirrors so drift between clients stays
// greppable. The starred-clue predicates (DESIGN.md D26) are pinned the same way, and the same
// division of labor holds: parse reads intent, referencedKeys is the one place a reference meets a
// real clue list and where existence and self-exclusion are decided.

package crossy.ui

import crossy.protocol.Clue
import crossy.protocol.ClueRun
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ClueRefsTests {

    // --- parseClueRefs: the grammar, independent of any puzzle (web describe "parseClueRefs") ---

    @Test
    fun `parse reads a hyphenated single ref`() {
        // web: "reads a hyphenated single ref"
        assertEquals(listOf(ClueRef(42, isAcross = false)), parseClueRefs("42-Down"))
    }

    @Test
    fun `parse reads a spaced single ref`() {
        // web: "reads a spaced single ref"
        assertEquals(listOf(ClueRef(17, isAcross = true)), parseClueRefs("17 Across"))
    }

    @Test
    fun `parse reads a ref buried in prose like See 42-Down`() {
        // web: "reads a ref buried in prose, like 'See 42-Down'"
        assertEquals(listOf(ClueRef(42, isAcross = false)), parseClueRefs("See 42-Down"))
    }

    @Test
    fun `parse is case-insensitive on the direction word`() {
        // web: "is case-insensitive on the direction word"
        assertEquals(
            listOf(
                ClueRef(42, isAcross = false),
                ClueRef(8, isAcross = true),
                ClueRef(3, isAcross = true),
            ),
            parseClueRefs("42-DOWN and 8-across and 3 AcRoSs"),
        )
    }

    @Test
    fun `parse distributes one trailing direction word over a comma-and list`() {
        // web: "distributes one trailing direction word over a comma-and list"
        assertEquals(
            listOf(
                ClueRef(17, isAcross = true),
                ClueRef(20, isAcross = true),
                ClueRef(49, isAcross = true),
                ClueRef(59, isAcross = true),
            ),
            parseClueRefs("17, 20, 49, and 59 across"),
        )
    }

    @Test
    fun `parse distributes over a short and list`() {
        // web: "distributes over a short 'and' list"
        assertEquals(
            listOf(ClueRef(5, isAcross = false), ClueRef(12, isAcross = false)),
            parseClueRefs("5 and 12 down"),
        )
    }

    @Test
    fun `parse distributes over an ampersand list`() {
        // web: "distributes over an ampersand list"
        assertEquals(
            listOf(
                ClueRef(1, isAcross = false),
                ClueRef(5, isAcross = false),
                ClueRef(9, isAcross = false),
            ),
            parseClueRefs("1, 5 & 9 Down"),
        )
    }

    @Test
    fun `parse keeps mixed axes in one clue on their own direction words`() {
        // web: "keeps mixed axes in one clue on their own direction words"
        assertEquals(
            listOf(ClueRef(17, isAcross = true), ClueRef(3, isAcross = false)),
            parseClueRefs("17-Across and 3-Down"),
        )
    }

    @Test
    fun `parse keeps a distributed list and a later single ref apart`() {
        // web: "keeps a distributed list and a later single ref apart"
        assertEquals(
            listOf(
                ClueRef(17, isAcross = true),
                ClueRef(20, isAcross = true),
                ClueRef(49, isAcross = true),
                ClueRef(3, isAcross = false),
            ),
            parseClueRefs("17, 20, and 49 across, plus 3 down"),
        )
    }

    @Test
    fun `parse reads refs in order, duplicates kept for the call site to dedupe`() {
        // web: "reads refs in the order they appear, duplicates kept for the call site to dedupe"
        assertEquals(
            listOf(ClueRef(8, isAcross = false), ClueRef(8, isAcross = false)),
            parseClueRefs("8-Down, see also 8-Down"),
        )
    }

    @Test
    fun `parse reads a three-digit clue number`() {
        // web: "reads a three-digit clue number"
        assertEquals(listOf(ClueRef(100, isAcross = true)), parseClueRefs("With 100-Across"))
    }

    @Test
    fun `parse does not match a bare number with no direction word`() {
        // web: "does not match a bare number with no direction word"
        assertEquals(emptyList<ClueRef>(), parseClueRefs("Just the number 5 alone"))
    }

    @Test
    fun `parse does not match a year`() {
        // web: "does not match a year"
        assertEquals(emptyList<ClueRef>(), parseClueRefs("Event of 1999"))
        assertEquals(emptyList<ClueRef>(), parseClueRefs("In 1066 across the channel"))
    }

    @Test
    fun `parse does not read a four-digit number's tail as a reference`() {
        // web: "does not read a four-digit number's tail as a reference"
        assertEquals(emptyList<ClueRef>(), parseClueRefs("1000 down"))
        assertEquals(emptyList<ClueRef>(), parseClueRefs("12345 across"))
    }

    @Test
    fun `parse does not match an enumeration like (17)`() {
        // web: "does not match an enumeration like '(17)'"
        assertEquals(emptyList<ClueRef>(), parseClueRefs("Some answer (17)"))
    }

    @Test
    fun `parse does not read a direction word alone as a reference`() {
        // web: "does not read a direction word alone as a reference"
        assertEquals(emptyList<ClueRef>(), parseClueRefs("ACROSS the wide river"))
        assertEquals(emptyList<ClueRef>(), parseClueRefs("A quiet rundown of the day"))
        assertEquals(emptyList<ClueRef>(), parseClueRefs("Downtown at dusk"))
    }

    @Test
    fun `parse does not match a number glued to a direction word with no separator`() {
        // web: "does not match a number glued to a direction word with no separator"
        assertEquals(emptyList<ClueRef>(), parseClueRefs("12down"))
    }

    @Test
    fun `parse returns empty for empty or absent text`() {
        // web: "returns [] for empty or absent text"
        assertEquals(emptyList<ClueRef>(), parseClueRefs(""))
        assertEquals(emptyList<ClueRef>(), parseClueRefs(null))
    }

    @Test
    fun `parse returns empty for prose with no reference at all`() {
        // web: "returns [] for prose with no reference at all"
        assertEquals(emptyList<ClueRef>(), parseClueRefs("Capital of France"))
    }

    // --- the reference puzzle, shared by the starred grammar and resolution cases (web fixture) ---

    private val revealer =
        "Question during a brainstorming session ... or of the answers to the starred clues"
    private val refAcross = listOf(
        Clue(18, "*Yes — three arduous ones", listOf(0, 1)),
        Clue(29, "*Yes — sometimes more than 1,000", listOf(2, 3)),
        Clue(37, "*Yes — exactly one, in common usage", listOf(4, 5)),
        Clue(50, "*No — but it does have three feet", listOf(6, 7)),
        Clue(61, revealer, listOf(8, 9)),
    )
    private val refDown = listOf(Clue(1, "Capital of France", listOf(0, 2)))

    // --- the starred-clue convention (web describe "the starred-clue convention") ---

    @Test
    fun `starred reads the reference puzzle's revealer`() {
        // web: "reads the reference puzzle's revealer"
        assertTrue(referencesStarredClues(revealer))
    }

    @Test
    fun `starred marks the reference puzzle's four theme entries and nothing else`() {
        // web: "marks the reference puzzle's four theme entries and nothing else"
        assertEquals(listOf(18, 29, 37, 50), refAcross.filter(::isStarredClue).map { it.number })
        assertEquals(emptyList<Clue>(), refDown.filter(::isStarredClue))
    }

    @Test
    fun `starred does not read starred as a verb`() {
        // web: "does not read 'starred' as a verb: 'Starred in a movie' names nothing"
        assertFalse(referencesStarredClues("Starred in a movie"))
        assertFalse(referencesStarredClues("She starred alongside him"))
    }

    @Test
    fun `starred takes every noun the convention uses`() {
        // web: "takes every noun the convention uses"
        assertTrue(referencesStarredClues("starred answers"))
        assertTrue(referencesStarredClues("asterisked clues"))
        assertTrue(referencesStarredClues("the four starred entries"))
        assertTrue(referencesStarredClues("the starred entry"))
        assertTrue(referencesStarredClues("the starred squares"))
        assertTrue(referencesStarredClues("a starred-clue theme"))
    }

    @Test
    fun `starred reads the possessive the starred clues' answers`() {
        // web: "reads the possessive: \"the starred clues' answers\""
        assertTrue(referencesStarredClues("the starred clues' answers"))
    }

    @Test
    fun `starred is case-insensitive on the revealer phrase`() {
        // web: "is case-insensitive on the revealer phrase"
        assertTrue(referencesStarredClues("... of the STARRED CLUES"))
    }

    @Test
    fun `starred is one-way, a starred clue as the active clue names nothing`() {
        // web: "is one-way: a starred clue as the active clue names nothing"
        for (clue in refAcross.filter(::isStarredClue)) {
            assertFalse(referencesStarredClues(clue.text))
        }
    }

    @Test
    fun `starred sees the star through styled prose (law 11 keeps it verbatim in text)`() {
        // web: "sees the star through styled prose, since law 11 keeps it verbatim in text"
        val styled = Clue(
            18, "*bold star", listOf(0),
            runs = listOf(ClueRun("*"), ClueRun("bold star", listOf("b"))),
        )
        assertTrue(isStarredClue(styled))
    }

    @Test
    fun `starred tolerates leading whitespace before the star`() {
        // web: "tolerates leading whitespace before the star"
        assertTrue(isStarredClue(Clue(1, " *Themed", listOf(0))))
    }

    @Test
    fun `starred is not starred for a mid-prose asterisk or empty text`() {
        // web: "is not starred for a mid-prose asterisk or absent text"
        // (Android Clue.text is non-optional, so only the empty-string half of the web case ports.)
        assertFalse(isStarredClue(Clue(1, "Not *this", listOf(0))))
        assertFalse(isStarredClue(Clue(1, "", listOf(0))))
    }

    @Test
    fun `starred returns false for empty or absent revealer text`() {
        // web: "returns false for empty or absent revealer text"
        assertFalse(referencesStarredClues(""))
        assertFalse(referencesStarredClues(null))
    }

    // --- referencedKeys: the resolution chokepoint (web describe "referencedKeys") ---

    private fun activeOn(number: Int): Clue? = refAcross.find { it.number == number }

    @Test
    fun `keys resolves the revealer to exactly the four starred entries`() {
        // web: "resolves the reference puzzle's revealer to exactly the four starred entries"
        assertEquals(
            setOf("18A", "29A", "37A", "50A"),
            referencedKeys(activeOn(61), activeIsAcross = true, refAcross, refDown),
        )
    }

    @Test
    fun `keys is one-way, a starred clue as the active clue resolves to empty`() {
        // web: "is one-way: a starred clue as the active clue resolves to empty"
        assertEquals(
            emptySet<String>(),
            referencedKeys(activeOn(18), activeIsAcross = true, refAcross, refDown),
        )
    }

    @Test
    fun `keys resolves a revealer to empty when the puzzle has no starred clues`() {
        // web: "resolves a revealer to empty when the puzzle has no starred clues"
        val starless = listOf(Clue(61, revealer, listOf(8, 9)))
        assertEquals(
            emptySet<String>(),
            referencedKeys(starless[0], activeIsAcross = true, starless, refDown),
        )
    }

    @Test
    fun `keys drops a numeric ref naming a clue the grid lacks`() {
        // web: "drops a numeric ref naming a clue the grid lacks"
        val clue = Clue(1, "With 99-Across and 18-Across", listOf(0, 2))
        assertEquals(
            setOf("18A"),
            referencedKeys(clue, activeIsAcross = false, refAcross, listOf(clue)),
        )
    }

    @Test
    fun `keys excludes a starred revealer from the set it names, keeping its siblings`() {
        // web: "excludes a starred revealer from the set it names, keeping its siblings"
        val selfNaming = Clue(61, "*A hint to the starred clues", listOf(8, 9))
        val across = refAcross.take(4) + selfNaming
        assertEquals(
            setOf("18A", "29A", "37A", "50A"),
            referencedKeys(selfNaming, activeIsAcross = true, across, refDown),
        )
    }

    @Test
    fun `keys excludes a numeric self-reference`() {
        // web: "excludes a numeric self-reference"
        val clue = Clue(18, "See 18-Across and 1-Down", listOf(0, 1))
        assertEquals(
            setOf("1D"),
            referencedKeys(clue, activeIsAcross = true, listOf(clue), refDown),
        )
    }

    @Test
    fun `keys unions a numeric ref and a starred ref from one clue into one set`() {
        // web: "unions a numeric ref and a starred ref from one clue into one set"
        val clue = Clue(1, "With 61-Across, a hint to the starred answers", listOf(0, 2))
        assertEquals(
            setOf("61A", "18A", "29A", "37A", "50A"),
            referencedKeys(clue, activeIsAcross = false, refAcross, listOf(clue)),
        )
    }

    @Test
    fun `keys resolves plain prose and an absent active clue to empty`() {
        // web: "resolves plain prose and an absent active clue to empty"
        assertEquals(
            emptySet<String>(),
            referencedKeys(refDown[0], activeIsAcross = false, refAcross, refDown),
        )
        assertEquals(
            emptySet<String>(),
            referencedKeys(null, activeIsAcross = true, refAcross, refDown),
        )
    }

    // --- referencedCells: key set to painted cells (web describe "referencedCells") ---

    private val cellsAcross = listOf(
        Clue(1, "", listOf(0, 1, 2)),
        Clue(5, "", listOf(10, 11)),
    )
    private val cellsDown = listOf(
        Clue(1, "", listOf(0, 3, 6)),
        Clue(2, "", listOf(1, 4)),
    )

    @Test
    fun `cells unions the cells of referenced clues across both axes`() {
        // web: "unions the cells of referenced clues across both axes"
        assertEquals(
            setOf(10, 11, 0, 3, 6),
            referencedCells(setOf("5A", "1D"), cellsAcross, cellsDown),
        )
    }

    @Test
    fun `cells contributes nothing for a key that names no existing clue`() {
        // web: "contributes nothing for a key that names no existing clue"
        assertEquals(
            setOf(0, 1, 2),
            referencedCells(setOf("1A", "9D"), cellsAcross, cellsDown),
        )
    }

    @Test
    fun `cells returns an empty set for an empty key set`() {
        // web: "returns an empty set for an empty key set"
        assertEquals(emptySet<Int>(), referencedCells(emptySet(), cellsAcross, cellsDown))
    }
}
