// Seed a new full account's first game (DESIGN.md §8 signup path). Called once, when the JIT
// identity mirror first inserts the `users` row for a non-anonymous identity (auth/middleware).
// The API is the single writer on `puzzles`, `games`, and `memberships` (INV-7), so both writes
// here are legal; `game_state` stays session-owned and materializes on first connect.
import { schema } from "@crossy/db";
import type { Db } from "../db/client";
import { createGameWithHost } from "../games/create";
import {
  STARTER_GAME_NAME,
  STARTER_PUZZLE,
  STARTER_PUZZLE_AUTHOR,
  STARTER_PUZZLE_ID,
  STARTER_PUZZLE_TITLE,
} from "./starter-puzzle";

/**
 * Ensure the shared starter puzzle exists (idempotent by its fixed id), then create the user's
 * own solo game hosting it. The seeded game is a normal game: it shows up in the caller's
 * `GET /games`, and its view projects `ClientPuzzle` geometry out of the snapshot with no
 * solution (INV-6). Guests are never seeded: the caller gates on `isAnonymous`, and a guest
 * cannot hold host anyway (DESIGN.md §8).
 */
export async function seedStarterGame(db: Db, userId: string): Promise<void> {
  await db
    .insert(schema.puzzles)
    .values({
      puzzleId: STARTER_PUZZLE_ID,
      data: STARTER_PUZZLE,
      title: STARTER_PUZZLE_TITLE,
      author: STARTER_PUZZLE_AUTHOR,
    })
    .onConflictDoNothing({ target: schema.puzzles.puzzleId });
  await createGameWithHost(
    db,
    STARTER_PUZZLE_ID,
    STARTER_PUZZLE,
    userId,
    STARTER_GAME_NAME,
  );
}
