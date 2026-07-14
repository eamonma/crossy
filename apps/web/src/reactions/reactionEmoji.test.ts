// The client-side reaction-set validator (Wave 8.4): the mirror of the API's authoritative rule
// (apps/api/src/identity/reaction-set.ts; PROTOCOL.md §9, §12), so its vectors mirror that suite.
// What passes here MUST be what the server accepts: one RGI emoji grapheme within 32 UTF-8 bytes
// per slot, exactly five, all distinct on the exact grapheme string. No normalization anywhere.
import { describe, expect, it } from "vitest";
import { isReactionEmoji, validateReactionSet } from "./reactionEmoji";

// The five default graphemes (PROTOCOL.md §9), a known-good set for the accept path.
const DEFAULT_FIVE = ["🔥", "🤔", "🐐", "💀", "😭"];

// A multi-codepoint single grapheme: 🇨🇦 is two regional indicators, 👍🏽 is a base plus a skin-tone
// modifier, and 🧑‍🍳 carries a ZWJ. Each is one user-perceived emoji, so each is one valid slot.
const FLAG_CA = "\u{1F1E8}\u{1F1E6}"; // 🇨🇦
const THUMBS_SKIN = "\u{1F44D}\u{1F3FD}"; // 👍🏽
const CHEF_ZWJ = "\u{1F9D1}‍\u{1F373}"; // 🧑‍🍳 (11 UTF-8 bytes, within the bound)

// A valid RGI emoji that overruns the 32-byte bound: 🧑🏻‍❤️‍💋‍🧑🏿 (kiss, two skin tones) is 35 UTF-8
// bytes, so the byte bound rejects it even though it is one well-formed emoji grapheme.
const OVERLONG_EMOJI = "\u{1F9D1}\u{1F3FB}‍❤️‍\u{1F48B}‍\u{1F9D1}\u{1F3FF}";

describe("isReactionEmoji: one RGI emoji grapheme within 32 UTF-8 bytes (PROTOCOL.md §9, the API mirror)", () => {
  it("accepts a single-codepoint emoji", () => {
    expect(isReactionEmoji("🔥")).toBe(true);
  });

  it("accepts a multi-codepoint single grapheme (a flag, a skin tone, a ZWJ sequence within the bound)", () => {
    expect(isReactionEmoji(FLAG_CA)).toBe(true);
    expect(isReactionEmoji(THUMBS_SKIN)).toBe(true);
    expect(isReactionEmoji(CHEF_ZWJ)).toBe(true);
  });

  it("rejects a two-emoji string (not one grapheme)", () => {
    expect(isReactionEmoji("🔥🤔")).toBe(false);
  });

  it("rejects an emoji with trailing text (not one grapheme)", () => {
    expect(isReactionEmoji("🔥x")).toBe(false);
  });

  it("rejects a non-emoji string", () => {
    expect(isReactionEmoji("ab")).toBe(false);
    expect(isReactionEmoji("5")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isReactionEmoji("")).toBe(false);
  });

  it("rejects a well-formed emoji that exceeds 32 UTF-8 bytes (the byte bound bites)", () => {
    expect(isReactionEmoji(OVERLONG_EMOJI)).toBe(false);
  });
});

describe("validateReactionSet: the reactionSet contract rules, mirrored client-side (PROTOCOL.md §9, §12)", () => {
  it("accepts a set of exactly five valid distinct emoji", () => {
    expect(
      validateReactionSet(["🔥", "🤔", FLAG_CA, THUMBS_SKIN, "😭"]),
    ).toEqual({ ok: true });
    expect(validateReactionSet(DEFAULT_FIVE)).toEqual({ ok: true });
  });

  it("REACTION_SET_LENGTH when not exactly five entries (too few, too many)", () => {
    expect(validateReactionSet(["🔥", "🤔", "🐐", "💀"])).toEqual({
      ok: false,
      code: "REACTION_SET_LENGTH",
    });
    expect(validateReactionSet(["🔥", "🤔", "🐐", "💀", "😭", "👀"])).toEqual({
      ok: false,
      code: "REACTION_SET_LENGTH",
    });
  });

  it("REACTION_SET_INVALID when an entry is not one emoji grapheme (non-emoji, two-emoji)", () => {
    expect(
      validateReactionSet(["🔥", "🤔", "🐐", "💀", "not-an-emoji"]),
    ).toEqual({ ok: false, code: "REACTION_SET_INVALID" });
    expect(validateReactionSet(["🔥🤔", "🐐", "💀", "😭", "👀"])).toEqual({
      ok: false,
      code: "REACTION_SET_INVALID",
    });
  });

  it("REACTION_SET_INVALID when an entry exceeds 32 UTF-8 bytes", () => {
    expect(
      validateReactionSet(["🔥", "🤔", "🐐", "💀", OVERLONG_EMOJI]),
    ).toEqual({ ok: false, code: "REACTION_SET_INVALID" });
  });

  it("REACTION_SET_DUPLICATE when the same grapheme repeats", () => {
    expect(validateReactionSet(["🔥", "🤔", "🐐", "💀", "🔥"])).toEqual({
      ok: false,
      code: "REACTION_SET_DUPLICATE",
    });
  });

  it("distinctness is exact-string: two look-alikes differing in code points are distinct", () => {
    // 👍 and 👍🏽 render alike but differ in code points, so they are distinct entries and the set
    // is accepted (PROTOCOL.md §12 exact-grapheme distinctness).
    expect(validateReactionSet(["👍", THUMBS_SKIN, "🐐", "💀", "😭"])).toEqual({
      ok: true,
    });
  });
});
