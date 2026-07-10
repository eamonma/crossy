// Invite-code resolution, shared by POST /games/join and GET /g/{code} (PROTOCOL.md §12).
// One implementation so every code-holding path normalizes and probes identically (INV-1):
// the invite alphabet is all uppercase ASCII (`generateInviteCode`, the
// `games_invite_code_format` CHECK), so ASCII-uppercasing a hand-typed lowercase code
// resolves it exactly when it is a real code, with no locale folding (the reverse of the
// cell-value rule, same INV-1 primitive). Surrounding whitespace a phone keyboard may add is
// trimmed; stored codes never contain any. The lookup is backed by the
// `games_invite_code_key` UNIQUE index, so it is a single-row index probe. Read-only: the
// API's single-writer duties (INV-7) are untouched here.
import { eq } from "drizzle-orm";
import { schema } from "@crossy/db";
import { asciiUppercase } from "@crossy/protocol";
import type { Db } from "../db/client";

/** Normalize a caller-held invite code for lookup: trim, then ASCII-uppercase (INV-1). */
export function normalizeInviteCode(raw: string): string {
  return asciiUppercase(raw.trim());
}

/**
 * Resolve a game by a caller-held invite code (normalized here). `null` means no game
 * matches. `inviteCode` is the stored value, constrained by the `games_invite_code_format`
 * CHECK to `^[2-9A-HJ-NP-Z]{8}$`, so a consumer rendering it never echoes raw caller input.
 */
export async function findGameByInviteCode(
  db: Db,
  rawCode: string,
): Promise<{ gameId: string; inviteCode: string } | null> {
  const found = await db
    .select({
      gameId: schema.games.gameId,
      inviteCode: schema.games.inviteCode,
    })
    .from(schema.games)
    .where(eq(schema.games.inviteCode, normalizeInviteCode(rawCode)))
    .limit(1);
  return found[0] ?? null;
}
