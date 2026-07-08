// The navigation core is TDD'd straight from the normative seed vectors. This test
// loads the real vector file (the same one the engine runner in packages/engine
// consumes) and drives every one of the 12 cases through getNextCell, so the playground
// input model cannot drift from the shared contract. INV-1: one deterministic
// navigation, grid in and position out.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boardById } from "./boards";
import {
  backspace,
  getNextCell,
  moveByArrow,
  selectCell,
  tabToClue,
  toggleDirection,
  typeLetter,
  wordCells,
} from "./navigation";
import type { Direction, Grid, Selection, Toward } from "./types";

interface SeedCase {
  name: string;
  given: { cols: number; rows: number; blocks: number[] };
  when: {
    direction: Direction;
    from: number;
    toward: Toward;
    canEscapeWord?: boolean;
  };
  then: { cell: number };
}

const here = dirname(fileURLToPath(import.meta.url));
const vectorPath = resolve(
  here,
  "../../../../vectors/v1/navigation/single-cell-advance.json",
);
const seedCases = JSON.parse(readFileSync(vectorPath, "utf8")) as SeedCase[];

describe("getNextCell conforms to the seed navigation vectors (INV-1)", () => {
  it("loads all 12 seed cases", () => {
    expect(seedCases).toHaveLength(12);
  });

  for (const c of seedCases) {
    it(c.name, () => {
      const grid: Grid = {
        cols: c.given.cols,
        rows: c.given.rows,
        blocks: new Set(c.given.blocks),
      };
      const actual =
        c.when.canEscapeWord === undefined
          ? getNextCell(grid, c.when.direction, c.when.from, c.when.toward)
          : getNextCell(
              grid,
              c.when.direction,
              c.when.from,
              c.when.toward,
              c.when.canEscapeWord,
            );
      expect(actual).toBe(c.then.cell);
    });
  }
});

// The 5x4 fixture the vectors are written against, for the higher-level interactions.
//  0  1  #  3  4
//  5  #  7  8  9
// 10 11 12 13# 14   (13 is a block)
// 15 16 17 18 19
const grid: Grid = { cols: 5, rows: 4, blocks: new Set([2, 6, 13]) };

describe("wordCells finds the maximal run along an axis (INV-1)", () => {
  it("across word stops at a block and the row edge", () => {
    expect(wordCells(grid, "across", 4)).toEqual([3, 4]);
    expect(wordCells(grid, "across", 0)).toEqual([0, 1]);
  });
  it("down word stops at a block", () => {
    expect(wordCells(grid, "down", 1)).toEqual([1]); // block at 6 sits below
    expect(wordCells(grid, "down", 0)).toEqual([0, 5, 10, 15]);
  });
});

describe("arrow keys move along the axis or toggle across it (INV-1)", () => {
  it("along the axis moves with block-skip", () => {
    const sel: Selection = { cell: 1, direction: "across" };
    expect(moveByArrow(grid, sel, "across", "forward")).toEqual({
      cell: 3,
      direction: "across",
    });
  });
  it("across the axis toggles direction and holds the cell", () => {
    const sel: Selection = { cell: 8, direction: "across" };
    expect(moveByArrow(grid, sel, "down", "forward")).toEqual({
      cell: 8,
      direction: "down",
    });
  });
});

describe("typing advances with filled-skip and wraps at the word end (INV-1)", () => {
  it("advances to the next empty cell in the word", () => {
    const fills = new Map<number, string>();
    const out = typeLetter(grid, fills, { cell: 0, direction: "across" }, "h");
    expect(out.selection).toEqual({ cell: 1, direction: "across" });
    expect(out.fills?.get(0)).toBe("H");
  });
  it("skips an already-filled cell inside the word", () => {
    // word 15..19; 16 already filled, so typing at 15 lands on 17.
    const fills = new Map<number, string>([[16, "X"]]);
    const out = typeLetter(grid, fills, { cell: 15, direction: "across" }, "a");
    expect(out.selection.cell).toBe(17);
  });
  it("wraps to the word's first empty cell when the tail is full", () => {
    // word 15..19; type at 18 with 19 already filled and 15 empty → wrap to 15.
    const fills = new Map<number, string>([[19, "Z"]]);
    const out = typeLetter(grid, fills, { cell: 18, direction: "across" }, "b");
    expect(out.selection.cell).toBe(15);
  });
  it("stays on the last cell when the word is complete", () => {
    const fills = new Map<number, string>([
      [15, "A"],
      [16, "B"],
      [17, "C"],
      [18, "D"],
    ]);
    const out = typeLetter(grid, fills, { cell: 19, direction: "across" }, "e");
    expect(out.selection.cell).toBe(19);
  });
  it("ignores non-alphanumeric input", () => {
    const out = typeLetter(
      grid,
      new Map(),
      { cell: 0, direction: "across" },
      "!",
    );
    expect(out.fills).toBeUndefined();
    expect(out.selection).toEqual({ cell: 0, direction: "across" });
  });
});

describe("backspace clears then steps back per the open decision (INV-1)", () => {
  it("clears a filled cell and stays", () => {
    const fills = new Map<number, string>([[3, "Q"]]);
    const out = backspace(
      grid,
      fills,
      { cell: 3, direction: "across" },
      "clamp-to-word",
    );
    expect(out.fills?.has(3)).toBe(false);
    expect(out.selection.cell).toBe(3);
  });
  it("clamp-to-word holds at the word start on an empty cell", () => {
    // word 3..4; cell 3 is the word start, backspace on empty clamps.
    const out = backspace(
      grid,
      new Map(),
      { cell: 3, direction: "across" },
      "clamp-to-word",
    );
    expect(out.selection.cell).toBe(3);
    expect(out.fills).toBeUndefined();
  });
  it("v2-cross-block steps across the block into the previous word", () => {
    // cell 3 empty, backspace crosses the block at 2 back to cell 1 and clears it.
    const fills = new Map<number, string>([[1, "Y"]]);
    const out = backspace(
      grid,
      fills,
      { cell: 3, direction: "across" },
      "v2-cross-block",
    );
    expect(out.selection.cell).toBe(1);
    expect(out.fills?.has(1)).toBe(false);
  });
});

describe("Tab targets clues, Shift+Tab honors the open decision (INV-1)", () => {
  const puzzle = boardById("seed").puzzle;
  const allClues = [...puzzle.acrossClues, ...puzzle.downClues];

  it("Tab lands on the next across clue's first empty cell", () => {
    const sel: Selection = { cell: 0, direction: "across" };
    const out = tabToClue(
      grid,
      new Map(),
      allClues,
      sel,
      "forward",
      "v2-asymmetric",
    );
    // next across clue after {0,1} is {3,4}; both empty → its start, cell 3.
    expect(out).toEqual({ cell: 3, direction: "across" });
  });

  it("Shift+Tab v2-asymmetric lands on the previous clue's end when its start is filled", () => {
    const fills = new Map<number, string>([[0, "A"]]); // start of {0,1} filled
    const sel: Selection = { cell: 3, direction: "across" };
    const out = tabToClue(
      grid,
      fills,
      allClues,
      sel,
      "backward",
      "v2-asymmetric",
    );
    expect(out.cell).toBe(1); // clue end, never a mid-word empty
  });

  it("Shift+Tab symmetric-first-empty lands on the previous clue's first empty cell", () => {
    const fills = new Map<number, string>([[0, "A"]]);
    const sel: Selection = { cell: 3, direction: "across" };
    const out = tabToClue(
      grid,
      fills,
      allClues,
      sel,
      "backward",
      "symmetric-first-empty",
    );
    expect(out.cell).toBe(1); // 0 filled, 1 empty → first empty is 1
  });
});

describe("click and toggle (INV-1)", () => {
  it("clicking the focused cell toggles direction", () => {
    expect(selectCell(grid, { cell: 8, direction: "across" }, 8)).toEqual({
      cell: 8,
      direction: "down",
    });
  });
  it("clicking a block is ignored", () => {
    const sel: Selection = { cell: 8, direction: "across" };
    expect(selectCell(grid, sel, 2)).toBe(sel);
  });
  it("toggleDirection flips the axis", () => {
    expect(toggleDirection({ cell: 0, direction: "across" })).toEqual({
      cell: 0,
      direction: "down",
    });
  });
});
