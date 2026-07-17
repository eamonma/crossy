// The Titles display table's contract (design/post-game/TITLES.md; PROTOCOL.md §12 titles row; twin of
// apps/ios TitleLadderTests.swift): the wire's {userId, key, evidence} resolves to render-ready cards,
// an unknown key from a newer server is dropped (the MUST-ignore rule, how the ladder grows without
// client lockstep), and evidence formats per rung semantics: counts as pluralized counts, the two
// whole-seconds rungs as M:SS, no-evidence rungs as their fixed line, and a numeric rung with a missing
// number drops the line rather than printing a blank. The copy is pinned string for string against the
// web's TITLE_COPY (apps/web/src/ui/titlesReadout.ts): the same room reads identically on both
// platforms. Pure value math, no Compose, the RoomAnalysisTests discipline.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class TitleLadderTests {
    private fun card(key: String, evidence: Int?, userId: String = "u1"): TitleCard? =
        TitleLadder.card(RoomTitle(userId = userId, key = key, evidence = evidence))

    // MARK: Coverage (the pinned ladder)

    @Test
    fun `the ladder covers exactly the sixteen pinned keys, in ladder rank order`() {
        // The TITLES.md ladder table, rank order: exactly the engine TITLE_LADDER's keys, no more, no
        // fewer (v1's fifteen plus the D29 fast-follow's marathoner at rank 8).
        assertEquals(
            listOf(
                "saboteur", "one-hit-wonder", "ice-breaker", "bullseye", "headliner",
                "sprinter", "meddler", "marathoner", "quick-starter", "closer",
                "specialist", "long-hauler", "wanderer", "scribbler", "collector",
                "workhorse",
            ),
            TitleLadder.keys,
        )
        for (key in TitleLadder.keys) {
            val resolved = card(key, 7)
            assertNotNull(resolved, "$key is a pinned key and must have copy")
            assertFalse(resolved!!.label.isEmpty(), "$key must carry a label")
            assertNotNull(resolved.detail, "$key must carry a detail line for evidence 7")
        }
    }

    @Test
    fun `the copy matches the web table string for string`() {
        // These strings are the web's TITLE_COPY verbatim (titlesReadout.ts); a drift on either side
        // fails one of the twin sweeps.
        val expected: List<Triple<Pair<String, Int?>, String, String?>> = listOf(
            Triple("saboteur" to 7, "The saboteur", "Overwrote 7 correct squares"),
            Triple("one-hit-wonder" to null, "The one-hit wonder", "One square, flawlessly chosen"),
            Triple("ice-breaker" to 240, "The ice breaker", "Ended the room's 4:00 silence"),
            Triple("bullseye" to 9, "The bullseye", "9 squares, none wrong"),
            Triple("headliner" to 3, "The headliner", "Led 3 of the long ones"),
            Triple("sprinter" to 9, "The sprinter", "9 squares in 30 seconds"),
            Triple("meddler" to 2, "The meddler", "Finished 2 words others started"),
            Triple("marathoner" to 3, "The marathoner", "Showed up for all 3 sittings"),
            Triple("quick-starter" to 8, "The quick starter", "8 squares in the opening stretch"),
            Triple("closer" to 5, "The closer", "5 squares in the closing stretch"),
            Triple("specialist" to 11, "The specialist", "Kept to one corner, 11 squares"),
            Triple("long-hauler" to 1572, "The long hauler", "On the case for 26:12"),
            Triple("wanderer" to null, "The wanderer", "Roamed the whole grid"),
            Triple("scribbler" to 61, "The scribbler", "Busiest pencil, 61 letters down"),
            Triple("collector" to 17, "The collector", "Had a hand in 17 words"),
            Triple("workhorse" to 42, "The workhorse", "42 squares filled"),
        )
        assertEquals(expected.map { it.first.first }, TitleLadder.keys, "the sweep covers the whole ladder")
        for ((keyEvidence, label, detail) in expected) {
            val (key, evidence) = keyEvidence
            val resolved = card(key, evidence)
            assertEquals(label, resolved?.label, key)
            assertEquals(detail, resolved?.detail, key)
        }
    }

    // MARK: Evidence semantics (TITLES.md ladder table)

    @Test
    fun `count rungs pluralize, one square is never one squares`() {
        assertEquals("1 square in the opening stretch", card("quick-starter", 1)?.detail)
        assertEquals("8 squares in the opening stretch", card("quick-starter", 8)?.detail)
        assertEquals("Busiest pencil, 1 letter down", card("scribbler", 1)?.detail)
        assertEquals("Had a hand in 1 word", card("collector", 1)?.detail)
        assertEquals("Finished 2 words others started", card("meddler", 2)?.detail)
        assertEquals("1 square filled", card("workhorse", 1)?.detail)
        assertEquals("Overwrote 1 correct square", card("saboteur", 1)?.detail)
        // The marathoner's evidence is the sitting count, floored at 2 by its gate (TITLES.md rank 8),
        // so the plural branch is the only one the wire can reach.
        assertEquals("Showed up for both sittings", card("marathoner", 2)?.detail)
        assertEquals("Showed up for all 5 sittings", card("marathoner", 5)?.detail)
    }

    @Test
    fun `the whole-seconds rungs render M SS through the hour-rolling formatter`() {
        // The web's formatMSS: seconds floored, hours split out past sixty minutes.
        assertEquals("Ended the room's 4:00 silence", card("ice-breaker", 240)?.detail)
        assertEquals("Ended the room's 2:30 silence", card("ice-breaker", 150)?.detail)
        assertEquals("On the case for 26:12", card("long-hauler", 1572)?.detail)
        // A floor rung can land on a single-fill solver whose span is 0 (the TITLES.md coverage rule),
        // and a multi-sitting span can cross an hour (the hour roll in RoomAnalysis.formatMSS).
        assertEquals("On the case for 0:00", card("long-hauler", 0)?.detail)
        assertEquals("On the case for 1:01:40", card("long-hauler", 3700)?.detail)
    }

    @Test
    fun `null evidence on a numeric rung drops the line, never prints a blank`() {
        // The web's withCount: null in, null out; the card still renders label + name.
        val resolved = card("saboteur", null)
        assertEquals("The saboteur", resolved?.label)
        assertNull(resolved?.detail, "a missing number drops the line")
    }

    @Test
    fun `the no-evidence rungs carry their fixed line, whatever the wire says`() {
        // The two no-evidence rungs read the same off null or an unexpected number: their claim is the
        // whole line (the web's fixed-copy shape).
        assertEquals("One square, flawlessly chosen", card("one-hit-wonder", null)?.detail)
        assertEquals("One square, flawlessly chosen", card("one-hit-wonder", 3)?.detail)
        assertEquals("Roamed the whole grid", card("wanderer", null)?.detail)
        assertEquals("Roamed the whole grid", card("wanderer", 12)?.detail)
    }

    // MARK: Forward compatibility (PROTOCOL §12: a client MUST ignore an unknown key)

    @Test
    fun `an unknown title key resolves to no card, the section drops it`() {
        // A newer server's ladder grew (as it did with marathoner): the older client drops the award and
        // keeps the rest, never a crash and never a placeholder.
        assertNull(card("night-owl", 5))
        assertNull(card("not-a-title", null))
        assertNull(card("", 1))
        // The panel's exact derivation: mapNotNull keeps the known awards in wire order.
        val titles = listOf(
            RoomTitle(userId = "u-noor", key = "night-owl", evidence = 5),
            RoomTitle(userId = "me", key = "workhorse", evidence = 12),
            RoomTitle(userId = "u-jia", key = "not-a-title", evidence = null),
        )
        assertEquals(listOf("me"), titles.mapNotNull { TitleLadder.card(it) }.map { it.userId })
    }

    @Test
    fun `empty titles yield no cards, the solo rule renders no section`() {
        // A solo solve (or an older API) ships no titles; the panel gates its "Titles" header on the
        // resolved cards, so no card means no section, never an empty box.
        assertEquals(emptyList<TitleCard>(), emptyList<RoomTitle>().mapNotNull { TitleLadder.card(it) })
    }

    @Test
    fun `the cards keep the wire order, ladder rank is never reordered`() {
        // The server orders by ladder rank; reordering client-side would fork the two platforms'
        // surfaces (titlesReadout.ts carries the same rule).
        val titles = listOf(
            RoomTitle(userId = "b", key = "workhorse", evidence = 42),
            RoomTitle(userId = "a", key = "saboteur", evidence = 7),
        )
        assertEquals(
            listOf("b", "a"),
            titles.mapNotNull { TitleLadder.card(it) }.map { it.userId },
            "wire order rides through, whatever the keys' ladder ranks",
        )
    }
}
