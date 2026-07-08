// Fake boards for the playground. No server, no networking: these stand in for the
// solution-stripped ClientPuzzle that arrives over the wire in Wave 2.1d.
import { computeLayout } from "./layout";
import type { Puzzle, Teammate } from "./types";

export interface Board {
  id: string;
  label: string;
  puzzle: Puzzle;
  /** Seed fills so typing, filled-skip, and wrap can be felt immediately. */
  initialFills: ReadonlyMap<number, string>;
  teammates: readonly Teammate[];
}

function buildPuzzle(
  cols: number,
  rows: number,
  blocks: ReadonlySet<number>,
  circles: ReadonlySet<number>,
  wrong: ReadonlySet<number>,
): Puzzle {
  const { numbers, acrossClues, downClues } = computeLayout(cols, rows, blocks);
  return {
    cols,
    rows,
    blocks,
    numbers,
    circles,
    wrong,
    acrossClues,
    downClues,
  };
}

// The 5x4 fixture the 12 navigation vectors are written against: blocks {2, 6, 13}.
// Seeing the exact grid the seed cases cite makes the vector behavior tangible.
const seedBlocks = new Set([2, 6, 13]);
const seedBoard: Board = {
  id: "seed",
  label: "5x4 vector fixture",
  puzzle: buildPuzzle(5, 4, seedBlocks, new Set([7]), new Set()),
  initialFills: new Map([
    [0, "C"],
    [1, "A"],
  ]),
  teammates: [{ id: "t-ada", initial: "A", cell: 8, direction: "down" }],
};

// A realistic 15x15. Blocks are placed with 180-degree rotational symmetry (real grids
// are symmetric): a seed list for the top half is mirrored to the bottom half.
const SIZE = 15;
const seedTopBlocks: ReadonlyArray<readonly [number, number]> = [
  [0, 4],
  [0, 10],
  [1, 4],
  [1, 10],
  [2, 4],
  [2, 10],
  [3, 7],
  [3, 8],
  [4, 5],
  [4, 9],
  [5, 3],
  [5, 6],
  [6, 2],
  [6, 12],
  [7, 4],
  [7, 10],
];

function symmetricBlocks(): Set<number> {
  const blocks = new Set<number>();
  for (const [r, c] of seedTopBlocks) {
    blocks.add(r * SIZE + c);
    blocks.add((SIZE - 1 - r) * SIZE + (SIZE - 1 - c));
  }
  return blocks;
}

const fifteenBlocks = symmetricBlocks();

// A scatter of fills: enough to show letters, a filled word that forces wrap, and one
// wrong cell to exercise the red check-background role.
const fifteenFills = new Map<number, string>([
  [0, "S"],
  [1, "P"],
  [2, "A"],
  [3, "R"],
  [15, "T"],
  [16, "R"],
  [17, "A"],
  [18, "C"],
  [19, "E"],
  [30, "O"],
  [31, "P"],
  [32, "E"],
  [33, "N"],
  [45, "M"],
  [46, "A"],
  [47, "Z"],
  [48, "E"],
  [7, "X"], // flagged wrong below
]);

const fifteenWrong = new Set<number>([7]);

// Circles as an inset-ring overlay on a short diagonal, so the ring rendering shows.
const fifteenCircles = new Set<number>([32, 48, 64, 80, 96]);

const fifteenBoard: Board = {
  id: "fifteen",
  label: "15x15 daily-style",
  puzzle: buildPuzzle(SIZE, SIZE, fifteenBlocks, fifteenCircles, fifteenWrong),
  initialFills: fifteenFills,
  teammates: [
    { id: "t-mel", initial: "M", cell: 98, direction: "across" },
    { id: "t-jun", initial: "J", cell: 156, direction: "down" },
    // Two teammates share cell 172 to exercise the collapse-to-count rendering.
    { id: "t-kai", initial: "K", cell: 172, direction: "across" },
    { id: "t-lee", initial: "L", cell: 172, direction: "down" },
  ],
};

export const boards: readonly Board[] = [seedBoard, fifteenBoard];

export function boardById(id: string): Board {
  return boards.find((b) => b.id === id) ?? seedBoard;
}
