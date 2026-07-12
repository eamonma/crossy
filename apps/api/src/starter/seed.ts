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
  STARTER_PUZZLE_FEATURES,
  STARTER_PUZZLE_TITLE,
} from "./starter-puzzle";

/**
 * Mint the user their OWN copy of the starter puzzle (`created_by = them`, so it lists in their
 * owned puzzles), then create the solo game they host on it. The seeded game is a normal game:
 * it shows up in the caller's `GET /games`, and its view projects `ClientPuzzle` geometry out of
 * the snapshot with no solution (INV-6). Guests are never seeded: the caller gates on
 * `isAnonymous`, and a guest cannot hold host anyway (DESIGN.md §8).
 */
export async function seedStarterGame(db: Db, userId: string): Promise<void> {
  const [puzzle] = await db
    .insert(schema.puzzles)
    .values({
      data: STARTER_PUZZLE,
      features: STARTER_PUZZLE_FEATURES,
      title: STARTER_PUZZLE_TITLE,
      author: STARTER_PUZZLE_AUTHOR,
      createdBy: userId,
    })
    .returning({ puzzleId: schema.puzzles.puzzleId });
  await createGameWithHost(
    db,
    puzzle!.puzzleId,
    STARTER_PUZZLE,
    userId,
    STARTER_GAME_NAME,
  );
}
