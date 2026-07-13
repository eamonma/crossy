// Invite code generation (DESIGN.md §7). `/g/{code}`: 8 characters from the unambiguous
// alphabet `[2-9A-HJ-NP-Z]`, crypto-random. The alphabet drops the visually ambiguous
// glyphs 0/O and 1/I/L-lookalikes, so a code read aloud or off a screen is unambiguous.
// The `games.invite_code` CHECK constraint pins this exact format as defense in depth; the
// generator is the source, the constraint is the backstop.
import { randomInt } from "node:crypto";

/** The unambiguous alphabet from DESIGN.md §7: 2-9, A-H, J-N, P-Z. 32 symbols, no 0/1/I/O. */
export const INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Code length (DESIGN.md §7). 32^8 is roughly 1.1e12 codes, so collisions are rare. */
export const INVITE_CODE_LENGTH = 8;

/**
 * The invite-code shape, built from the same alphabet and length as the generator so the two
 * cannot drift, and equivalent to the `games_invite_code_format` CHECK (`^[2-9A-HJ-NP-Z]{8}$`).
 * The public code-resolution paths (the invite host, the unfurl) shape-gate a caller-supplied
 * code against this BEFORE any DB lookup, so a malformed code never probes the unique index. The
 * caller's code is ASCII-uppercased first (INV-1); the alphabet has no `-`, so it forms no range.
 */
export const INVITE_CODE_PATTERN = new RegExp(
  `^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`,
);

/**
 * Generate one crypto-random invite code. `randomInt` draws from the CSPRNG without modulo
 * bias because the alphabet length (32) divides the generator's range evenly, and it is a
 * node builtin (this is an app, not the pure engine, so IO and randomness are allowed).
 */
export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}
