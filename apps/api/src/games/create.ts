// Create a game and its host membership. Extracted from routes.ts so both the POST /games
// handler and the signup starter-seed (auth/middleware -> starter/seed) can share the one
// transaction without a routes <-> middleware import cycle. The API is the single writer on
// games and memberships (INV-7); game_state stays session-owned and materializes on first
// connect (DESIGN.md §6, §9).
import { schema } from "@crossy/db";
import type { Db } from "../db/client";
import { generateInviteCode } from "./invite-code";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * Create a game and its host membership in one transaction, retrying on the rare invite-code
 * collision. The API does NOT create the game_state row: game_state is session-owned, and the
 * actor materializes it on first connect (DESIGN.md §6, §9). INV-7 holds structurally, since a
 * `crossy_api`-role connection has no grant to write game_state at all.
 */
export async function createGameWithHost(
  db: Db,
  puzzleId: string,
  puzzleSnapshot: unknown,
  createdBy: string,
  name: string | null,
): Promise<{ gameId: string; inviteCode: string; name: string | null }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateInviteCode();
    try {
      return await db.transaction(async (tx) => {
        const game = await tx
          .insert(schema.games)
          .values({ puzzleId, puzzleSnapshot, inviteCode, createdBy, name })
          .returning({ gameId: schema.games.gameId });
        const gameId = game[0]!.gameId;
        await tx
          .insert(schema.memberships)
          .values({ gameId, userId: createdBy, role: "host" });
        return { gameId, inviteCode, name };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error("could not allocate a unique invite code");
}
