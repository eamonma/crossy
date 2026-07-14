// The client-side mirror of the personal reaction-set validator (PROTOCOL.md §9, §12; DESIGN.md D25).
// It reproduces the API's authoritative rule (apps/api/src/identity/reaction-set.ts) so the Settings
// editor can gate a save before the wire and name the failure inline, keyed on the same codes the
// server returns. The server stays the single writer and the authority (INV-7): this is a UX gate,
// not a second source of truth, so it MUST agree with the API rule byte for byte. No normalization:
// graphemes are validated and stored byte-exact, so distinctness compares the exact strings.

/** Exactly five slots (PROTOCOL.md §9: the personal set is five emoji in slot order). */
export const REACTION_SET_SIZE = 5;

/**
 * The section 9 send-gate byte bound: an emoji is at most 32 UTF-8 bytes, the same shape bound the
 * wire codec enforces (packages/protocol codec.ts) and the API's set gate reproduces.
 */
export const MAX_REACTION_BYTES = 32;

// One RGI emoji grapheme (Unicode `RGI_Emoji`, one well-formed emoji). The `v` flag (Unicode sets) is
// required for the `\p{RGI_Emoji}` string property. Built via the RegExp constructor, not a literal:
// the `v` flag in a regex literal needs a TS target of es2024+, while the runtime supports it
// regardless, so the string form keeps the workspace target and runs the same matcher (the same
// string-constructed-regex idiom the API validator and display-name.ts use). Anchored, so the whole
// string must be exactly one emoji: a two-emoji string or an emoji with trailing text fails.
const RGI_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

const encoder = new TextEncoder();

/** UTF-8 byte length of `s`, for the section 9 shape bound. */
function utf8ByteLength(s: string): number {
  return encoder.encode(s).length;
}

/**
 * True if `s` is exactly one sendable reaction emoji: one RGI emoji grapheme within the 32-UTF-8-byte
 * bound (PROTOCOL.md §9). The per-slot rule and the send-gate rule, one predicate for both. The byte
 * bound is checked first so a pathological long input never reaches the regex; an empty string fails
 * the regex (it is not one emoji).
 */
export function isReactionEmoji(s: string): boolean {
  return utf8ByteLength(s) <= MAX_REACTION_BYTES && RGI_EMOJI.test(s);
}

/** The named domain rejections, matching the API's errors.ts and PROTOCOL.md §12. */
export type ReactionSetError =
  "REACTION_SET_LENGTH" | "REACTION_SET_INVALID" | "REACTION_SET_DUPLICATE";

export type ReactionSetValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ReactionSetError };

/**
 * Validate a `reactionSet` value the same way the API does (PROTOCOL.md §9, §12): exactly five
 * entries (else REACTION_SET_LENGTH), each exactly one RGI emoji grapheme within 32 UTF-8 bytes
 * (else REACTION_SET_INVALID), all five distinct on the exact grapheme string (else
 * REACTION_SET_DUPLICATE). `null` (reset to defaults) is out of scope here: the editor never
 * validates the reset, it just sends null. The order of checks matches the API so the client and
 * the server name the same first failure.
 */
export function validateReactionSet(
  set: readonly string[],
): ReactionSetValidation {
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
  return { ok: true };
}
