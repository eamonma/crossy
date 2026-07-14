// Personal reaction set spec (PROTOCOL.md §9, §12; DESIGN.md D25). The authoritative validate path
// the identity `PATCH /me` write runs for the `reactionSet` field, mirroring display-name.ts: an
// exported validate function that returns named rule violations. A reaction set is the five emoji a
// user's client offers to send; the API is the single writer of the column (INV-7) and the session
// never reads it (a `react` carries the grapheme itself, §9).
//
// The set is stored byte-exact: unlike a display name, it is NEVER normalized. Distinctness compares
// the exact grapheme strings, so two entries that render alike but differ in code points (a variation
// selector, a skin-tone modifier) are distinct. The per-entry rule is the section 9 send-gate rule:
// exactly one RGI emoji grapheme within the 32-UTF-8-byte shape bound. Wrong types (a value that is
// neither null nor an array of strings) are the caller's concern, mapped to 400 VALIDATION before
// this runs, not a 422 here (display-name.ts draws the same line for a non-string name).

/** Exactly five slots (PROTOCOL.md §9: the personal set is five emoji in slot order). */
export const REACTION_SET_SIZE = 5;

/**
 * The section 9 send-gate byte bound: an emoji is at most 32 UTF-8 bytes. This is the same shape
 * bound the wire codec enforces (packages/protocol codec.ts), reproduced here because the /me set
 * gate is a distinct policy path (the codec enforces shape only, never emoji-ness, §9).
 */
export const MAX_REACTION_BYTES = 32;

// One RGI emoji grapheme (Unicode `RGI_Emoji`, one well-formed emoji). The `v` flag (Unicode sets) is
// required for the `\p{RGI_Emoji}` string property. Built via the RegExp constructor, not a literal:
// the `v` flag in a regex literal needs a TS target of es2024+, while the runtime (Node 24) supports
// it regardless, so the string form keeps the workspace target (es2023) and runs the same matcher
// (the same string-constructed-regex idiom display-name.ts uses). Anchored, so the whole string must
// be exactly one emoji: a two-emoji string or an emoji with trailing text fails.
const RGI_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

const encoder = new TextEncoder();

/** UTF-8 byte length of `s`, for the section 9 shape bound. */
function utf8ByteLength(s: string): number {
  return encoder.encode(s).length;
}

/**
 * True if `s` is exactly one sendable reaction emoji: one RGI emoji grapheme within the 32-UTF-8-byte
 * bound (PROTOCOL.md §9). This is the per-slot rule and the send-gate rule, one predicate for both.
 * The byte bound is checked first so a pathological long input never reaches the regex on a large
 * string; an empty string fails the regex (it is not one emoji).
 */
export function isReactionEmoji(s: string): boolean {
  return utf8ByteLength(s) <= MAX_REACTION_BYTES && RGI_EMOJI.test(s);
}

/** The named domain rejections `validate` returns, matching errors.ts and PROTOCOL.md §12. */
export type ReactionSetError =
  "REACTION_SET_LENGTH" | "REACTION_SET_INVALID" | "REACTION_SET_DUPLICATE";

export type ValidateResult =
  | { readonly ok: true; readonly value: readonly string[] | null }
  | { readonly ok: false; readonly code: ReactionSetError };

/**
 * Validate a `reactionSet` patch value (PROTOCOL.md §9, §12). `null` is valid and resets to the
 * defaults. Otherwise the value must be exactly five entries (else REACTION_SET_LENGTH), each exactly
 * one RGI emoji grapheme within 32 UTF-8 bytes (else REACTION_SET_INVALID), all five distinct on the
 * exact grapheme string (else REACTION_SET_DUPLICATE). No normalization: the graphemes are validated
 * and returned byte-exact for storage. The caller resolves the 400 VALIDATION lane (a value that is
 * not null and not an array of strings) before calling this, the same split display-name.ts uses.
 */
export function validate(set: readonly string[] | null): ValidateResult {
  if (set === null) return { ok: true, value: null };
  if (set.length !== REACTION_SET_SIZE) {
    return { ok: false, code: "REACTION_SET_LENGTH" };
  }
  for (const entry of set) {
    if (!isReactionEmoji(entry)) {
      return { ok: false, code: "REACTION_SET_INVALID" };
    }
  }
  // Distinctness compares the exact strings (PROTOCOL.md §12): a variation selector or skin-tone
  // modifier makes two look-alikes distinct, so a plain Set on the raw strings is the whole check.
  if (new Set(set).size !== set.length) {
    return { ok: false, code: "REACTION_SET_DUPLICATE" };
  }
  return { ok: true, value: [...set] };
}
