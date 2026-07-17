package crossy.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// The personal reaction set spec (PROTOCOL.md §9, §12; DESIGN.md D25), twinned case-for-case from
// apps/ios ReactionSetSpecTests.swift and the API validate suite (apps/api/src/identity/
// reaction-set.test.ts): the default five, the one-emoji-grapheme-within-32-bytes slot rule as the
// Kotlin heuristic states it, and the named REACTION_SET_* rejections in the server's check order.
// Where the heuristic and the server's `RGI_Emoji` diverge (non-RGI ZWJ chains, invented flags), the
// spec's header documents it and the server's 422 stays the authority; these tests pin the documented
// behavior on both sides of that line.
class ReactionSetSpecTests {
    // --- The defaults (§9: the D25 five, slot order; the Phase 7 set retired) ---

    @Test
    fun defaultSetIsTheD25FiveInSlotOrder_PROTOCOL9() {
        assertEquals(listOf("🔥", "🤔", "🐐", "💀", "😭"), ReactionSetSpec.defaultSet)
    }

    @Test
    fun defaultSetPassesItsOwnValidator_PROTOCOL9() {
        assertNull(ReactionSetSpec.validate(ReactionSetSpec.defaultSet))
        for (emoji in ReactionSetSpec.defaultSet) {
            assertTrue(ReactionSetSpec.isReactionEmoji(emoji), "$emoji must pass")
        }
    }

    @Test
    fun shapeConstantsMirrorTheContract_PROTOCOL9() {
        assertEquals(5, ReactionSetSpec.SIZE)
        assertEquals(32, ReactionSetSpec.MAX_UTF8_BYTES)
    }

    // --- One emoji grapheme: accepts (§9's send-gate rule) ---

    @Test
    fun acceptsAPlainEmojiScalar_PROTOCOL9() {
        assertTrue(ReactionSetSpec.isReactionEmoji("🔥"))
        assertTrue(ReactionSetSpec.isReactionEmoji("🐐"))
        assertTrue(ReactionSetSpec.isReactionEmoji("🦆"))
    }

    @Test
    fun acceptsAFlag_twoRegionalIndicators_PROTOCOL9() {
        assertTrue(ReactionSetSpec.isReactionEmoji("🇨🇦"))
    }

    @Test
    fun acceptsASkinTonedModifierBase_PROTOCOL9() {
        assertTrue(ReactionSetSpec.isReactionEmoji("👍🏽"))
    }

    @Test
    fun acceptsAShortZWJSequence_PROTOCOL9() {
        // ❤️‍🔥 (heart on fire): 2764 FE0F 200D 1F525, 13 bytes, one grapheme.
        assertTrue(ReactionSetSpec.isReactionEmoji("❤️‍🔥"))
        // 👨‍👩‍👧‍👦 (family): four scalars joined, 25 bytes, inside the bound.
        assertTrue(ReactionSetSpec.isReactionEmoji("👨‍👩‍👧‍👦"))
    }

    @Test
    fun acceptsAVS16PresentedTextDefaultScalar_PROTOCOL9() {
        // ♥️ (2665 FE0F) is an emoji; bare ♥ is a text glyph (rejected below). The variation-selector
        // finding the session suite pinned.
        assertTrue(ReactionSetSpec.isReactionEmoji("♥️"))
    }

    @Test
    fun acceptsAnRGIKeycap_PROTOCOL9() {
        // 1️⃣ = digit + VS16 + combining keycap, the RGI shape.
        assertTrue(ReactionSetSpec.isReactionEmoji("1️⃣"))
    }

    @Test
    fun acceptsATagSequenceFlag_PROTOCOL9() {
        // 🏴󠁧󠁢󠁳󠁣󠁴󠁿 (Scotland): the 1F3F4 base, gbsct tags, CANCEL TAG; 28 bytes.
        assertTrue(ReactionSetSpec.isReactionEmoji("🏴󠁧󠁢󠁳󠁣󠁴󠁿"))
    }

    // --- One emoji grapheme: rejects ---

    @Test
    fun rejectsLettersAndDigits_PROTOCOL9() {
        assertFalse(ReactionSetSpec.isReactionEmoji("A"))
        assertFalse(ReactionSetSpec.isReactionEmoji("z"))
        assertFalse(ReactionSetSpec.isReactionEmoji("1"), "a bare digit is text")
        assertFalse(ReactionSetSpec.isReactionEmoji("é"))
        assertFalse(ReactionSetSpec.isReactionEmoji("?"))
    }

    @Test
    fun rejectsTheEmptyStringAndWhitespace_PROTOCOL9() {
        assertFalse(ReactionSetSpec.isReactionEmoji(""))
        assertFalse(ReactionSetSpec.isReactionEmoji(" "))
    }

    @Test
    fun rejectsTwoEmoji_PROTOCOL9() {
        assertFalse(ReactionSetSpec.isReactionEmoji("🔥🔥"), "two graphemes")
        assertFalse(ReactionSetSpec.isReactionEmoji("🔥 "), "emoji plus a space")
        assertFalse(ReactionSetSpec.isReactionEmoji("a🔥"), "text plus an emoji")
    }

    @Test
    fun rejectsATextPresentationForm_PROTOCOL9() {
        // Bare ♥ (2665, Emoji_Presentation=No, no VS16) and the explicit VS15 form.
        assertFalse(ReactionSetSpec.isReactionEmoji("♥"))
        assertFalse(ReactionSetSpec.isReactionEmoji("☂︎"))
    }

    @Test
    fun rejectsAVS16lessKeycap_PROTOCOL9() {
        // #⃣ without VS16 is not the RGI keycap shape (both sides reject).
        assertFalse(ReactionSetSpec.isReactionEmoji("#⃣"))
    }

    @Test
    fun rejectsAnOversizeGrapheme_PROTOCOL9() {
        // 👩🏻‍❤️‍💋‍👨🏻 (kiss, both skin-toned) is ONE grapheme of 35 UTF-8 bytes: past the §9 shape
        // bound, so both sides reject it however well-formed it is.
        val kiss = "👩🏻‍❤️‍💋‍👨🏻"
        assertEquals(35, kiss.encodeToByteArray().size, "over the 32-byte bound")
        assertFalse(ReactionSetSpec.isReactionEmoji(kiss))
    }

    @Test
    fun rejectsMalformedJoinsAndDanglingModifiers_PROTOCOL9() {
        // A trailing ZWJ leaves an empty final segment.
        assertFalse(ReactionSetSpec.isReactionEmoji("🔥‍"))
        // A doubled skin tone never forms one element.
        assertFalse(ReactionSetSpec.isReactionEmoji("👍🏽🏽"))
        // A skin tone on a non-modifier-base (🔥 takes no tone).
        assertFalse(ReactionSetSpec.isReactionEmoji("🔥🏽"))
        // A lone regional indicator is half a flag.
        assertFalse(ReactionSetSpec.isReactionEmoji("🇦"))
    }

    // --- The documented divergence (heuristic superset; the server rules) ---

    @Test
    fun documentedDivergence_nonRGIChainsPassTheHeuristic_PROTOCOL9() {
        // Well-formed emoji shapes OUTSIDE the RGI list: the local heuristic accepts them (it has no
        // RGI data) and the server answers 422 REACTION_SET_INVALID, which the UI surfaces as the
        // authority. Pinned so the divergence is a documented fact, not a surprise.
        assertTrue(ReactionSetSpec.isReactionEmoji("🐐‍🔥"), "a non-RGI ZWJ chain")
        assertTrue(ReactionSetSpec.isReactionEmoji("🇦🇦"), "a non-region flag pair")
    }

    // --- validate: the whole-set rules in the server's order (§12) ---

    @Test
    fun validate_nullIsValid_theDefaultsReset_PROTOCOL12() {
        assertNull(ReactionSetSpec.validate(null))
    }

    @Test
    fun validate_fiveDistinctEmojiPass_PROTOCOL12() {
        assertNull(ReactionSetSpec.validate(listOf("🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶")))
    }

    @Test
    fun validate_notFiveIsLength_PROTOCOL12() {
        assertEquals(ReactionSetError.LENGTH, ReactionSetSpec.validate(emptyList()))
        assertEquals(ReactionSetError.LENGTH, ReactionSetSpec.validate(listOf("🔥", "🤔", "🐐", "💀")))
        assertEquals(
            ReactionSetError.LENGTH,
            ReactionSetSpec.validate(listOf("🔥", "🤔", "🐐", "💀", "😭", "🎉")),
        )
    }

    @Test
    fun validate_aNonEmojiEntryIsInvalid_PROTOCOL12() {
        assertEquals(ReactionSetError.INVALID, ReactionSetSpec.validate(listOf("🔥", "🤔", "A", "💀", "😭")))
        assertEquals(ReactionSetError.INVALID, ReactionSetSpec.validate(listOf("🔥", "🤔", "🐐🐐", "💀", "😭")))
        assertEquals(ReactionSetError.INVALID, ReactionSetSpec.validate(listOf("🔥", "🤔", "", "💀", "😭")))
    }

    @Test
    fun validate_aRepeatedEntryIsDuplicate_PROTOCOL12() {
        assertEquals(ReactionSetError.DUPLICATE, ReactionSetSpec.validate(listOf("🔥", "🔥", "🐐", "💀", "😭")))
    }

    @Test
    fun validate_checksRunInTheServersOrder_PROTOCOL12() {
        // Length outranks a bad entry (six entries, one a letter)...
        assertEquals(
            ReactionSetError.LENGTH,
            ReactionSetSpec.validate(listOf("🔥", "🤔", "🐐", "💀", "😭", "A")),
        )
        // ...and a bad entry outranks a duplicate (the letter repeats).
        assertEquals(ReactionSetError.INVALID, ReactionSetSpec.validate(listOf("A", "A", "🐐", "💀", "😭")))
    }

    @Test
    fun validate_distinctnessComparesTheExactGraphemeStrings_PROTOCOL12() {
        // 👍 and 👍🏽 render alike but differ in code points: distinct on purpose (§12; the ♥ vs ♥️
        // finding the session suite pinned).
        assertNull(ReactionSetSpec.validate(listOf("👍", "👍🏽", "🐐", "💀", "😭")))
    }

    // --- The named codes are the wire strings (§12) ---

    @Test
    fun errorWireValuesAreTheStableCodes_PROTOCOL12() {
        assertEquals("REACTION_SET_LENGTH", ReactionSetError.LENGTH.wire)
        assertEquals("REACTION_SET_INVALID", ReactionSetError.INVALID.wire)
        assertEquals("REACTION_SET_DUPLICATE", ReactionSetError.DUPLICATE.wire)
    }
}
