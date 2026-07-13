// The onboarding prefill suggestion (DESIGN.md name-onboarding §5). The form is seeded with a
// name the user accepts with one tap, so "not skippable" costs one click, not an act of naming.
// It is a suggestion in an editable field, never a silent write: the user confirms.
//
// Order (§5): (1) the token metadata name or email local part, carried on the session as
// `nameSuggestion` (resolved in the Supabase adapter, which owns the raw user and the Apple
// private-relay special case); (2) else a deterministic friendly "Adjective Noun" generated from
// the userId, so the same user always sees the same suggestion and it is stable across a reopened
// form. The generated name always passes the display-name spec by construction (short ASCII
// words, one internal space), so the fast path never trips a validation error.
import type { IdentitySession } from "../identity";

// Small curated word lists. Kept short, friendly, and unambiguous; every pairing is 1..40
// graphemes with no disallowed scalar, so it always validates. Not authoritative, so no vector.
const ADJECTIVES: readonly string[] = [
  "Quiet",
  "Amber",
  "Bright",
  "Clever",
  "Sunny",
  "Swift",
  "Gentle",
  "Bold",
  "Calm",
  "Merry",
  "Nimble",
  "Brave",
  "Cosmic",
  "Golden",
  "Wandering",
  "Curious",
];

const NOUNS: readonly string[] = [
  "Comet",
  "Vireo",
  "Otter",
  "Maple",
  "Falcon",
  "Willow",
  "Ember",
  "Heron",
  "Pebble",
  "Meadow",
  "Sparrow",
  "Cedar",
  "Lantern",
  "Harbor",
  "Finch",
  "Quill",
];

/**
 * A stable 32-bit hash of a string (FNV-1a), so the same userId always maps to the same word
 * pair. Pure and dependency-free, mirroring the identity color hash's posture.
 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // FNV prime, kept in 32-bit unsigned space via Math.imul + >>> 0.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A deterministic friendly "Adjective Noun" from a userId (§5 step 3). Two independent indices
 * off the hash so the adjective and noun vary together; always valid by construction. Exported
 * so a test can pin its determinism and shape if desired.
 */
export function generatedName(userId: string): string {
  const h = hash32(userId);
  const adjective = ADJECTIVES[h % ADJECTIVES.length]!;
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length]!;
  return `${adjective} ${noun}`;
}

/**
 * The prefill name for the onboarding field (§5): the session's carried metadata/email
 * suggestion when it is present and non-empty, else the deterministic generated name. Always a
 * non-empty, valid string, so the field is never seeded empty and the fast path is one tap.
 */
export function prefillName(session: IdentitySession): string {
  const carried = session.nameSuggestion;
  if (typeof carried === "string" && carried.trim() !== "") return carried;
  return generatedName(session.userId);
}
