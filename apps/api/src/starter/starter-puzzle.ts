// The starter puzzle every new full account is seeded with, as a game they host, so a fresh
// signed-in home is never empty (owner decision 2026-07-11). One original, fully-checked 5x5
// mini we own outright, the same grid the offline iOS DemoRoom and the web ?demo=1 board render
// (kept in sync by hand, they are separate runtimes).
//
// INV-6: the solution lives here and, once seeded, in the `puzzles.data` / `games.puzzle_snapshot`
// jsonb only. It never reaches a client: the game view projects `ClientPuzzle` geometry out of the
// snapshot (games/routes.ts) and drops the solution by type, exactly as for any other puzzle.
//
//   # D A S H
//   F O R C E
//   A N G E L
//   S O U N D
//   T R E E #
import type { ServerPuzzle, Solution } from "@crossy/protocol";

/** Fixed id so the shared puzzle is provisioned once and every seeded game points at one row. */
export const STARTER_PUZZLE_ID = "11111111-1111-4111-8111-111111111111";

/** Display metadata for the signed-in home list and the facts card. Not a solution (INV-6). */
export const STARTER_PUZZLE_TITLE = "Warm-up";
export const STARTER_PUZZLE_AUTHOR = "Crossy";

/** The room name the seeded game carries, so it reads as the starter in the games list. */
export const STARTER_GAME_NAME = "Your first puzzle";

const cell = (v: string): Solution => v as Solution;

export const STARTER_PUZZLE: ServerPuzzle = {
  rows: 5,
  cols: 5,
  blocks: [0, 24],
  circles: [12],
  clues: {
    across: [
      { number: 1, text: "Quick run for the door", cellIndices: [1, 2, 3, 4] },
      {
        number: 5,
        text: "Push with everything you have",
        cellIndices: [5, 6, 7, 8, 9],
      },
      {
        number: 6,
        text: "The one who leaves the porch light on and waits up",
        cellIndices: [10, 11, 12, 13, 14],
      },
      {
        number: 7,
        text: "What a full room makes",
        cellIndices: [15, 16, 17, 18, 19],
      },
      {
        number: 8,
        text: "It holds the swing and the shade all summer",
        cellIndices: [20, 21, 22, 23],
      },
    ],
    down: [
      { number: 1, text: "Giver, no strings", cellIndices: [1, 6, 11, 16, 21] },
      {
        number: 2,
        text: "Talk in circles at the dinner table",
        cellIndices: [2, 7, 12, 17, 22],
      },
      {
        number: 3,
        text: "The part of the play you remember after",
        cellIndices: [3, 8, 13, 18, 23],
      },
      {
        number: 4,
        text: "Kept close a good while",
        cellIndices: [4, 9, 14, 19],
      },
      {
        number: 5,
        text: "Quick, or going without breakfast",
        cellIndices: [5, 10, 15, 20],
      },
    ],
  },
  // Row-major, null at the two corner blocks (0 and 24).
  solution: [
    null,
    cell("D"),
    cell("A"),
    cell("S"),
    cell("H"),
    cell("F"),
    cell("O"),
    cell("R"),
    cell("C"),
    cell("E"),
    cell("A"),
    cell("N"),
    cell("G"),
    cell("E"),
    cell("L"),
    cell("S"),
    cell("O"),
    cell("U"),
    cell("N"),
    cell("D"),
    cell("T"),
    cell("R"),
    cell("E"),
    cell("E"),
    null,
  ],
};
