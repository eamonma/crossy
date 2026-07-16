import XCTest

import CrossyProtocol

// The personal reaction set spec (PROTOCOL.md §9, §12; DESIGN.md D25), twinned from the
// API's validate suite (apps/api/src/identity/reaction-set.test.ts): the default five,
// the one-emoji-grapheme-within-32-bytes slot rule as the Swift heuristic states it,
// and the named REACTION_SET_* rejections in the server's own check order. Where the
// heuristic and the server's `RGI_Emoji` diverge (non-RGI ZWJ chains, invented flags),
// the spec's header documents it and the server's 422 stays the authority; these tests
// pin the documented behavior on both sides of that line.

final class ReactionSetSpecTests: XCTestCase {
    // MARK: - The defaults (§9: the D25 five, slot order; the Phase 7 set retired)

    func test_defaultSetIsTheD25FiveInSlotOrder_PROTOCOL9() {
        XCTAssertEqual(ReactionSetSpec.defaultSet, ["🔥", "🤔", "🐐", "💀", "😭"])
    }

    func test_defaultSetPassesItsOwnValidator_PROTOCOL9() {
        XCTAssertNil(ReactionSetSpec.validate(ReactionSetSpec.defaultSet))
        for emoji in ReactionSetSpec.defaultSet {
            XCTAssertTrue(ReactionSetSpec.isReactionEmoji(emoji), "\(emoji) must pass")
        }
    }

    func test_shapeConstantsMirrorTheContract_PROTOCOL9() {
        XCTAssertEqual(ReactionSetSpec.size, 5)
        XCTAssertEqual(ReactionSetSpec.maxUTF8Bytes, 32)
    }

    // MARK: - One emoji grapheme: accepts (§9's send-gate rule)

    func test_acceptsAPlainEmojiScalar_PROTOCOL9() {
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("🔥"))
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("🐐"))
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("🦆"))
    }

    func test_acceptsAFlag_twoRegionalIndicators_PROTOCOL9() {
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("🇨🇦"))
    }

    func test_acceptsASkinTonedModifierBase_PROTOCOL9() {
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("👍🏽"))
    }

    func test_acceptsAShortZWJSequence_PROTOCOL9() {
        // ❤️‍🔥 (heart on fire): 2764 FE0F 200D 1F525, 13 bytes, one grapheme.
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("❤️‍🔥"))
        // 👨‍👩‍👧‍👦 (family): four scalars joined, 25 bytes, inside the bound.
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("👨‍👩‍👧‍👦"))
    }

    func test_acceptsAVS16PresentedTextDefaultScalar_PROTOCOL9() {
        // ♥️ (2665 FE0F) is an emoji; bare ♥ is a text glyph (rejected below). The
        // session suite pinned this same pair (the variation-selector finding).
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("\u{2665}\u{FE0F}"))
    }

    func test_acceptsAnRGIKeycap_PROTOCOL9() {
        // 1️⃣ = digit + VS16 + combining keycap, the RGI shape.
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("\u{31}\u{FE0F}\u{20E3}"))
    }

    func test_acceptsATagSequenceFlag_PROTOCOL9() {
        // 🏴󠁧󠁢󠁳󠁣󠁴󠁿 (Scotland): the 1F3F4 base, gbsct tags, CANCEL TAG; 28 bytes.
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("🏴󠁧󠁢󠁳󠁣󠁴󠁿"))
    }

    // MARK: - One emoji grapheme: rejects

    func test_rejectsLettersAndDigits_PROTOCOL9() {
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("A"))
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("z"))
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("1"), "a bare digit is text")
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("é"))
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("?"))
    }

    func test_rejectsTheEmptyStringAndWhitespace_PROTOCOL9() {
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji(""))
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji(" "))
    }

    func test_rejectsTwoEmoji_PROTOCOL9() {
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("🔥🔥"), "two graphemes")
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("🔥 "), "emoji plus a space")
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("a🔥"), "text plus an emoji")
    }

    func test_rejectsATextPresentationForm_PROTOCOL9() {
        // Bare ♥ (2665, Emoji_Presentation=No, no VS16) and the explicit VS15 form.
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("\u{2665}"))
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("\u{2602}\u{FE0E}"))
    }

    func test_rejectsAVS16lessKeycap_PROTOCOL9() {
        // #⃣ without VS16 is not the RGI keycap shape (both sides reject).
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("\u{23}\u{20E3}"))
    }

    func test_rejectsAnOversizeGrapheme_PROTOCOL9() {
        // 👩🏻‍❤️‍💋‍👨🏻 (kiss, both skin-toned) is ONE grapheme of 35 UTF-8 bytes: past
        // the §9 shape bound, so both sides reject it however well-formed it is.
        let kiss = "👩🏻‍❤️‍💋‍👨🏻"
        XCTAssertEqual(kiss.count, 1, "one grapheme cluster")
        XCTAssertEqual(kiss.utf8.count, 35, "over the 32-byte bound")
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji(kiss))
    }

    func test_rejectsMalformedJoinsAndDanglingModifiers_PROTOCOL9() {
        // A trailing ZWJ leaves an empty final segment.
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("🔥\u{200D}"))
        // A doubled skin tone never forms one element.
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("👍🏽🏽"))
        // A skin tone on a non-modifier-base (🔥 takes no tone).
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("🔥\u{1F3FD}"))
        // A lone regional indicator is half a flag.
        XCTAssertFalse(ReactionSetSpec.isReactionEmoji("\u{1F1E6}"))
    }

    // MARK: - The documented divergence (heuristic superset; the server rules)

    func test_documentedDivergence_nonRGIChainsPassTheHeuristic_PROTOCOL9() {
        // These are well-formed emoji shapes OUTSIDE the RGI list: the local heuristic
        // accepts them (it has no RGI data) and the server answers 422
        // REACTION_SET_INVALID, which the UI surfaces as the authority. Pinned so the
        // divergence is a documented fact, not a surprise.
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("🐐\u{200D}🔥"), "a non-RGI ZWJ chain")
        XCTAssertTrue(ReactionSetSpec.isReactionEmoji("🇦🇦"), "a non-region flag pair")
    }

    // MARK: - validate: the whole-set rules in the server's order (§12)

    func test_validate_nullIsValid_theDefaultsReset_PROTOCOL12() {
        XCTAssertNil(ReactionSetSpec.validate(nil))
    }

    func test_validate_fiveDistinctEmojiPass_PROTOCOL12() {
        XCTAssertNil(ReactionSetSpec.validate(["🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶"]))
    }

    func test_validate_notFiveIsLength_PROTOCOL12() {
        XCTAssertEqual(ReactionSetSpec.validate([]), .length)
        XCTAssertEqual(ReactionSetSpec.validate(["🔥", "🤔", "🐐", "💀"]), .length)
        XCTAssertEqual(
            ReactionSetSpec.validate(["🔥", "🤔", "🐐", "💀", "😭", "🎉"]), .length)
    }

    func test_validate_aNonEmojiEntryIsInvalid_PROTOCOL12() {
        XCTAssertEqual(ReactionSetSpec.validate(["🔥", "🤔", "A", "💀", "😭"]), .invalid)
        XCTAssertEqual(ReactionSetSpec.validate(["🔥", "🤔", "🐐🐐", "💀", "😭"]), .invalid)
        XCTAssertEqual(ReactionSetSpec.validate(["🔥", "🤔", "", "💀", "😭"]), .invalid)
    }

    func test_validate_aRepeatedEntryIsDuplicate_PROTOCOL12() {
        XCTAssertEqual(ReactionSetSpec.validate(["🔥", "🔥", "🐐", "💀", "😭"]), .duplicate)
    }

    func test_validate_checksRunInTheServersOrder_PROTOCOL12() {
        // Length outranks a bad entry (six entries, one a letter)...
        XCTAssertEqual(
            ReactionSetSpec.validate(["🔥", "🤔", "🐐", "💀", "😭", "A"]), .length)
        // ...and a bad entry outranks a duplicate (the letter repeats).
        XCTAssertEqual(ReactionSetSpec.validate(["A", "A", "🐐", "💀", "😭"]), .invalid)
    }

    func test_validate_distinctnessComparesTheExactGraphemeStrings_PROTOCOL12() {
        // 👍 and 👍🏽 render alike but differ in code points: distinct on purpose
        // (§12; the ♥ vs ♥️ finding the session suite pinned).
        XCTAssertNil(ReactionSetSpec.validate(["👍", "👍🏽", "🐐", "💀", "😭"]))
    }

    // MARK: - The named codes are the wire strings (§12)

    func test_errorRawValuesAreTheStableWireCodes_PROTOCOL12() {
        XCTAssertEqual(ReactionSetError.length.rawValue, "REACTION_SET_LENGTH")
        XCTAssertEqual(ReactionSetError.invalid.rawValue, "REACTION_SET_INVALID")
        XCTAssertEqual(ReactionSetError.duplicate.rawValue, "REACTION_SET_DUPLICATE")
    }
}
