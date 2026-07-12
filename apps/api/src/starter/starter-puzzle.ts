// The starter puzzle every new full account is seeded with, as a game they host, so a fresh
// signed-in home is never empty (owner decision 2026-07-11). An easy, welcoming 5x5: common
// words and gimme clues, so a first solve actually lands. Each new user gets their OWN copy
// (created_by = them, so it shows in their owned puzzles list), minted by starter/seed. One
// original, fully-checked grid we own outright, the same grid the offline iOS DemoRoom and the
// web ?demo=1 board render (kept in sync by hand, they are separate runtimes).
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
      { number: 1, text: "Sprint", cellIndices: [1, 2, 3, 4] },
      {
        number: 5,
        text: "May the ___ be with you",
        cellIndices: [5, 6, 7, 8, 9],
      },
      { number: 6, text: "Winged figure", cellIndices: [10, 11, 12, 13, 14] },
      { number: 7, text: "Noise", cellIndices: [15, 16, 17, 18, 19] },
      { number: 8, text: "Oak or pine", cellIndices: [20, 21, 22, 23] },
    ],
    down: [
      { number: 1, text: "Blood ___", cellIndices: [1, 6, 11, 16, 21] },
      { number: 2, text: "Bicker", cellIndices: [2, 7, 12, 17, 22] },
      { number: 3, text: "Part of a play", cellIndices: [3, 8, 13, 18, 23] },
      { number: 4, text: "Grasped", cellIndices: [4, 9, 14, 19] },
      { number: 5, text: "Speedy", cellIndices: [5, 10, 15, 20] },
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
