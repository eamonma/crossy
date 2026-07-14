// Personal reaction-set validator unit tests (PROTOCOL.md §9, §12; DESIGN.md D25). Exercises the
// authoritative `validate` and its per-slot `isReactionEmoji` predicate directly, the same rule the
// section 9 send gate takes: exactly one RGI emoji grapheme within 32 UTF-8 bytes, a set of exactly
// five, all distinct on the exact grapheme string, or null to reset to the defaults. No normalization
// happens here; the graphemes pass through byte-exact.
import { describe, expect, it } from "vitest";
import { isReactionEmoji, validate } from "./reaction-set";

// The five default graphemes (PROTOCOL.md §9), a known-good set for the accept path.
const DEFAULT_FIVE = ["🔥", "🤔", "🐐", "💀", "😭"];

// A multi-codepoint single grapheme: 🇨🇦 is two regional indicators, 👍🏽 is a base plus a skin-tone
// modifier. Each is one user-perceived emoji, so each is one valid slot.
const FLAG_CA = "\u{1F1E8}\u{1F1E6}"; // 🇨🇦
const THUMBS_SKIN = "\u{1F44D}\u{1F3FD}"; // 👍🏽

// A valid RGI emoji that overruns the 32-byte bound: 🧑🏻‍❤️‍💋‍🧑🏿 (kiss, two skin tones) is 35 UTF-8
// bytes, so the byte bound rejects it even though it is one well-formed emoji grapheme.
const OVERLONG_EMOJI = "\u{1F9D1}\u{1F3FB}‍❤️‍\u{1F48B}‍\u{1F9D1}\u{1F3FF}";

describe("isReactionEmoji: one RGI emoji grapheme within 32 UTF-8 bytes (PROTOCOL.md §9)", () => {
  it("accepts a single-codepoint emoji", () => {
    expect(isReactionEmoji("🔥")).toBe(true);
  });

  it("accepts a multi-codepoint single grapheme (a flag, a skin-tone modifier)", () => {
    expect(isReactionEmoji(FLAG_CA)).toBe(true);
    expect(isReactionEmoji(THUMBS_SKIN)).toBe(true);
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

describe("validate: the reactionSet contract rules (PROTOCOL.md §9, §12)", () => {
  it("null is valid: it resets to the default five", () => {
    const result = validate(null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("accepts a set of exactly five valid distinct emoji, byte-exact (no normalization)", () => {
    const set = ["🔥", "🤔", FLAG_CA, THUMBS_SKIN, "😭"];
    const result = validate(set);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(set);
  });

  it("accepts the default five", () => {
    const result = validate(DEFAULT_FIVE);
    expect(result.ok).toBe(true);
  });

  it("REACTION_SET_LENGTH when not exactly five entries (too few)", () => {
    const result = validate(["🔥", "🤔", "🐐", "💀"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REACTION_SET_LENGTH");
  });

  it("REACTION_SET_LENGTH when not exactly five entries (too many)", () => {
    const result = validate(["🔥", "🤔", "🐐", "💀", "😭", "👀"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REACTION_SET_LENGTH");
  });

  it("REACTION_SET_INVALID when an entry is not one emoji grapheme", () => {
    const result = validate(["🔥", "🤔", "🐐", "💀", "not-an-emoji"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REACTION_SET_INVALID");
  });

  it("REACTION_SET_INVALID when an entry is two emoji", () => {
    const result = validate(["🔥🤔", "🐐", "💀", "😭", "👀"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REACTION_SET_INVALID");
  });

  it("REACTION_SET_INVALID when an entry exceeds 32 UTF-8 bytes", () => {
    const result = validate(["🔥", "🤔", "🐐", "💀", OVERLONG_EMOJI]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REACTION_SET_INVALID");
  });

  it("REACTION_SET_DUPLICATE when the same grapheme repeats", () => {
    const result = validate(["🔥", "🤔", "🐐", "💀", "🔥"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REACTION_SET_DUPLICATE");
  });

  it("distinctness is exact-string: two look-alikes differing in code points are distinct", () => {
    // 👍 (no modifier) and 👍🏽 (with a skin-tone modifier) render alike but differ in code points, so
    // they are distinct entries and the set is accepted (PROTOCOL.md §12 exact-grapheme distinctness).
    const result = validate(["👍", THUMBS_SKIN, "🐐", "💀", "😭"]);
    expect(result.ok).toBe(true);
  });
});
