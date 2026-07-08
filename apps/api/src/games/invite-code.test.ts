// Invite-code format (DESIGN.md §7). The code is `/g/{code}`: 8 characters from the
// unambiguous alphabet `[2-9A-HJ-NP-Z]`, crypto-random. These pure tests need no
// infrastructure; they pin the format the `games.invite_code` CHECK also enforces.
import { describe, expect, it } from "vitest";
import {
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  generateInviteCode,
} from "./invite-code";

// The exact regex the migration's CHECK constraint uses (DESIGN.md §7, schema.ts).
const FORMAT = /^[2-9A-HJ-NP-Z]{8}$/;

describe("invite code (DESIGN.md §7)", () => {
  it("draws from a 32-symbol alphabet with no ambiguous glyphs (0, 1, I, O)", () => {
    expect(INVITE_ALPHABET.length).toBe(32);
    expect(INVITE_ALPHABET).not.toMatch(/[01IO]/);
    // Every symbol is itself a legal single-character code fragment.
    for (const ch of INVITE_ALPHABET) expect(ch).toMatch(/[2-9A-HJ-NP-Z]/);
  });

  it("generates codes that match the DB CHECK format exactly, defense in depth", () => {
    for (let i = 0; i < 2000; i += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      expect(code).toMatch(FORMAT);
    }
  });

  it("is effectively collision-free across a large draw (capability, not a counter)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20000; i += 1) seen.add(generateInviteCode());
    // 32^8 space: 20k draws colliding even once would be a red flag on the RNG.
    expect(seen.size).toBe(20000);
  });
});
