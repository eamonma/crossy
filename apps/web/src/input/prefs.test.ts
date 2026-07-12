// Pure unit tests for the pref-steered typing advance (settings slice 1). Each test names
// the rule it defends. The default combination (skipFilledInWord ON + endOfWord "first-blank")
// must reproduce the engine's vector-pinned typingAdvance byte-for-byte, so the same 5x4 grid
// and cases the navigation vectors use (vectors/v1/navigation/typing-advance.json and
// full-word-asymmetry.json) appear here, cross-checked against the engine directly.
import { describe, expect, it } from "vitest";
import { typingAdvance } from "@crossy/engine";
import type { Direction, Grid } from "@crossy/engine";
import {
  DEFAULT_NAV_PREFS,
  type NavPrefs,
  typingAdvanceWithPrefs,
} from "./prefs";

// The vectors' shared geometry: 5x4, blocks at 2, 6, 13. Rows are 0-4, 5-9, 10-14, 15-19.
const GRID: Grid = { cols: 5, rows: 4, blocks: new Set([2, 6, 13]) };

function filled(...cells: number[]): ReadonlySet<number> {
  return new Set(cells);
}

function advance(
  from: number,
  direction: Direction,
  fills: ReadonlySet<number>,
  prefs: NavPrefs,
): { cell: number; direction: Direction } {
  return typingAdvanceWithPrefs(GRID, direction, from, fills, prefs);
}

const SKIP_ON_FIRST_BLANK: NavPrefs = {
  skipFilledInWord: true,
  endOfWord: "first-blank",
};
const SKIP_OFF_FIRST_BLANK: NavPrefs = {
  skipFilledInWord: false,
  endOfWord: "first-blank",
};
const SKIP_ON_NEXT_CLUE: NavPrefs = {
  skipFilledInWord: true,
  endOfWord: "next-clue",
};
const SKIP_OFF_NEXT_CLUE: NavPrefs = {
  skipFilledInWord: false,
  endOfWord: "next-clue",
};

describe("typingAdvanceWithPrefs: defaults reproduce the vector-pinned engine exactly", () => {
  it("DEFAULT_NAV_PREFS is skip-filled ON and end-of-word first-blank (today's web behavior)", () => {
    expect(DEFAULT_NAV_PREFS).toEqual({
      skipFilledInWord: true,
      endOfWord: "first-blank",
    });
  });

  // For each engine typingAdvance vector, the default prefs must return the same cell. This is
  // the zero-change-by-default guarantee: a solver who never opens Settings sees no difference.
  it("default matches engine typingAdvance: filled-skip lands on the next empty cell (across)", () => {
    const fills = filled(15, 16);
    expect(advance(15, "across", fills, SKIP_ON_FIRST_BLANK).cell).toBe(17);
    expect(typingAdvance(GRID, "across", 15, fills)).toBe(17);
  });

  it("default matches engine typingAdvance: filled-skip jumps over several filled cells", () => {
    const fills = filled(15, 16, 17, 18);
    expect(advance(15, "across", fills, SKIP_ON_FIRST_BLANK).cell).toBe(19);
    expect(typingAdvance(GRID, "across", 15, fills)).toBe(19);
  });

  it("default matches engine typingAdvance: word-end incomplete wraps to first blank behind", () => {
    const fills = filled(7, 9);
    expect(advance(9, "across", fills, SKIP_ON_FIRST_BLANK).cell).toBe(8);
    expect(typingAdvance(GRID, "across", 9, fills)).toBe(8);
  });

  it("default matches engine typingAdvance: filled-skip advances along the down axis", () => {
    const fills = filled(4, 9);
    expect(advance(4, "down", fills, SKIP_ON_FIRST_BLANK).cell).toBe(14);
    expect(typingAdvance(GRID, "down", 4, fills)).toBe(14);
  });

  it("default matches engine typingAdvance: a full word stays on its last cell (full-word-asymmetry)", () => {
    const fills = filled(7, 8, 9);
    expect(advance(9, "across", fills, SKIP_ON_FIRST_BLANK).cell).toBe(9);
    expect(typingAdvance(GRID, "across", 9, fills)).toBe(9);
  });
});

describe("rule skipFilledInWord: ON skips filled cells, OFF steps to the next cell regardless", () => {
  // Word 15..19 (row 3), no blocks in the row. Cursor at 15, cell 16 already filled.
  it("ON: after placing at 15 with 16 filled, advance skips 16 to the empty 17", () => {
    const fills = filled(15, 16);
    expect(advance(15, "across", fills, SKIP_ON_FIRST_BLANK).cell).toBe(17);
  });

  it("OFF: after placing at 15 with 16 filled, advance lands on 16 (the immediate next cell)", () => {
    const fills = filled(15, 16);
    expect(advance(15, "across", fills, SKIP_OFF_FIRST_BLANK).cell).toBe(16);
  });

  it("OFF: with a run of filled cells ahead, advance still steps only one cell forward", () => {
    const fills = filled(15, 16, 17, 18);
    expect(advance(15, "across", fills, SKIP_OFF_FIRST_BLANK).cell).toBe(16);
  });

  it("ON and OFF agree when the immediate next cell is already empty (no skip needed)", () => {
    const fills = filled(15);
    expect(advance(15, "across", fills, SKIP_ON_FIRST_BLANK).cell).toBe(16);
    expect(advance(15, "across", fills, SKIP_OFF_FIRST_BLANK).cell).toBe(16);
  });
});

describe("rule endOfWord first-blank: word-end with blanks behind jumps back to the first blank", () => {
  // Word 15..19. Cursor typed the last cell 19; blanks remain at 16 and 18 (15,17,19 filled).
  it("skip OFF: typing over the last cell 19 with blanks behind jumps back to the first blank 16", () => {
    const fills = filled(15, 17, 19);
    expect(advance(19, "across", fills, SKIP_OFF_FIRST_BLANK).cell).toBe(16);
  });

  it("skip ON: reaching word-end 9 with a blank behind jumps back to the first blank 8", () => {
    const fills = filled(7, 9); // word 7..9, blank at 8
    expect(advance(9, "across", fills, SKIP_ON_FIRST_BLANK).cell).toBe(8);
  });

  it("first-blank picks the FIRST blank, not the nearest, when several remain", () => {
    const fills = filled(19); // word 15..19, blanks 15,16,17,18 -> first is 15
    // Cursor sitting on the just-typed last cell 19 with everything else blank.
    expect(advance(19, "across", fills, SKIP_ON_FIRST_BLANK).cell).toBe(15);
  });
});

describe("rule endOfWord first-blank: a full word stays put (matches today; does NOT advance)", () => {
  it("skip ON: a fully filled word keeps the cursor on the last cell", () => {
    const fills = filled(7, 8, 9);
    const out = advance(9, "across", fills, SKIP_ON_FIRST_BLANK);
    expect(out).toEqual({ cell: 9, direction: "across" });
  });

  it("skip OFF: a fully filled word keeps the cursor on the last cell", () => {
    const fills = filled(15, 16, 17, 18, 19);
    const out = advance(19, "across", fills, SKIP_OFF_FIRST_BLANK);
    expect(out).toEqual({ cell: 19, direction: "across" });
  });
});

describe("rule endOfWord next-clue: completing the word advances to the next clue", () => {
  // Word 15..19 fully filled (row 3). Nothing else on the board is filled, so the Tab cycle's
  // next incomplete clue is the first across clue's first empty cell.
  it("skip ON: filling the last empty cell of a word advances to the next clue", () => {
    const fills = filled(15, 16, 17, 18, 19);
    const out = advance(19, "across", fills, SKIP_ON_NEXT_CLUE);
    // Advances off the word (not a stay-put); the exact landing is the Tab traversal's next
    // incomplete clue, so it differs from `end` (19).
    expect(out.cell).not.toBe(19);
  });

  it("skip ON: next-clue jump can cross axes (lands on the Tab cycle's next clue)", () => {
    // Fill every across cell so the only incomplete clues are down clues: the jump crosses axis.
    const acrossAll = filled(
      0,
      1,
      3,
      4,
      5,
      7,
      8,
      9,
      10,
      11,
      12,
      14,
      15,
      16,
      17,
      18,
      19,
    );
    const out = advance(19, "across", acrossAll, SKIP_ON_NEXT_CLUE);
    expect(out.direction).toBe("down");
  });

  it("next-clue: word-end with a blank still behind does NOT advance (stays on the last cell)", () => {
    // skip OFF lets the cursor reach the last cell with a blank behind; the word is not complete.
    const fills = filled(15, 17, 19); // blanks 16, 18 remain
    const out = advance(19, "across", fills, SKIP_OFF_NEXT_CLUE);
    expect(out).toEqual({ cell: 19, direction: "across" });
  });
});

describe("rule: last cell of the last clue leaves navigation live (no crash, no off-grid)", () => {
  it("first-blank on the whole board full keeps the cursor on the last cell", () => {
    // Every playable cell filled. word 15..19 full, nothing empty anywhere.
    const everything = filled(
      0,
      1,
      3,
      4,
      5,
      7,
      8,
      9,
      10,
      11,
      12,
      14,
      15,
      16,
      17,
      18,
      19,
    );
    const out = advance(19, "across", everything, SKIP_ON_FIRST_BLANK);
    expect(out.cell).toBe(19);
  });

  it("next-clue on the whole board full moves to the adjacent clue without going off-grid", () => {
    const everything = filled(
      0,
      1,
      3,
      4,
      5,
      7,
      8,
      9,
      10,
      11,
      12,
      14,
      15,
      16,
      17,
      18,
      19,
    );
    const out = advance(19, "across", everything, SKIP_ON_NEXT_CLUE);
    // tabTarget's live-after-solve fallback: a valid playable cell, never off-grid.
    expect(out.cell).toBeGreaterThanOrEqual(0);
    expect(GRID.blocks.has(out.cell)).toBe(false);
  });
});

describe("OFF/ON x first-blank/next-clue matrix: mid-word advance is unaffected by endOfWord", () => {
  // Mid-word (not at the end): the endOfWord pref must not change anything; only skip matters.
  const cases: Array<[NavPrefs, number]> = [
    [SKIP_ON_FIRST_BLANK, 17],
    [SKIP_ON_NEXT_CLUE, 17],
    [SKIP_OFF_FIRST_BLANK, 16],
    [SKIP_OFF_NEXT_CLUE, 16],
  ];
  for (const [prefs, expectedCell] of cases) {
    it(`skip ${prefs.skipFilledInWord ? "ON" : "OFF"} / ${prefs.endOfWord}: from 15 with 16 filled lands on ${expectedCell}`, () => {
      const fills = filled(15, 16);
      expect(advance(15, "across", fills, prefs).cell).toBe(expectedCell);
    });
  }
});
