// The Wave 2.1d keyboard map and pointer paths (ROADMAP "Wave 2.1d desktop
// interaction spec"), driven end to end through packages/engine's navigation ops.
// The 5x4 vector fixture (blocks 2, 6, 13):
//
//   0  1  #  3  4
//   5  #  7  8  9
//  10 11 12  # 14
//  15 16 17 18 19
import { describe, expect, it } from "vitest";
import type { Grid } from "@crossy/engine";
import { cellClick, clueClick, initialSelection, keyEffect } from "./actions";
import type { InputEnv } from "./actions";

const grid: Grid = { cols: 5, rows: 4, blocks: new Set([2, 6, 13]) };

function env(overrides: Partial<InputEnv> = {}): InputEnv {
  return {
    grid,
    filled: new Set<number>(),
    selection: { cell: 0, direction: "across" },
    frozen: false,
    ...overrides,
  };
}

describe("letters and digits go through the typing op (keyboard map; typing-advance.json)", () => {
  it("places the letter and advances with filled-skip to the word's next empty cell", () => {
    const out = keyEffect(
      env({
        filled: new Set([16]),
        selection: { cell: 15, direction: "across" },
      }),
      "p",
      false,
    );
    expect(out?.mutations).toEqual([
      { type: "placeLetter", cell: 15, value: "P" },
    ]);
    expect(out?.selection).toEqual({ cell: 17, direction: "across" });
  });

  it("uppercases ASCII-only before the mutation (INV-1)", () => {
    const out = keyEffect(env(), "k", false);
    expect(out?.mutations).toEqual([
      { type: "placeLetter", cell: 0, value: "K" },
    ]);
  });

  it("accepts a digit (the A-Z0-9 charset)", () => {
    const out = keyEffect(env(), "7", false);
    expect(out?.mutations).toEqual([
      { type: "placeLetter", cell: 0, value: "7" },
    ]);
  });

  it("ignores a code point outside A-Z0-9 (INV-1: no locale casing rescue)", () => {
    expect(keyEffect(env(), "é", false)).toBeNull();
    expect(keyEffect(env(), "!", false)).toBeNull();
  });

  it("at the word's end an incomplete word wraps to its first empty cell (full-word-asymmetry.json)", () => {
    // Word 15..19; 16..18 filled; typing at 19 fills it, so 15 is the only empty.
    const out = keyEffect(
      env({
        filled: new Set([16, 17, 18]),
        selection: { cell: 19, direction: "across" },
      }),
      "e",
      false,
    );
    expect(out?.selection).toEqual({ cell: 15, direction: "across" });
  });
});

describe("arrows move along the axis or toggle across it (keyboard map; single-cell-advance.json)", () => {
  it("ArrowRight along across moves with block-skip (seed 5)", () => {
    const out = keyEffect(
      env({ selection: { cell: 1, direction: "across" } }),
      "ArrowRight",
      false,
    );
    expect(out?.selection).toEqual({ cell: 3, direction: "across" });
    expect(out?.mutations).toEqual([]);
  });

  it("ArrowDown across the current axis toggles direction without moving (DESIGN section 5)", () => {
    const out = keyEffect(
      env({ selection: { cell: 8, direction: "across" } }),
      "ArrowDown",
      false,
    );
    expect(out?.selection).toEqual({ cell: 8, direction: "down" });
  });

  it("clamps at the grid edge (seed 4)", () => {
    const out = keyEffect(
      env({ selection: { cell: 15, direction: "down" } }),
      "ArrowDown",
      false,
    );
    expect(out?.selection).toEqual({ cell: 15, direction: "down" });
  });

  it("arrows never skip filled cells (no filled-skip on the advance primitive)", () => {
    const out = keyEffect(
      env({
        filled: new Set([16]),
        selection: { cell: 15, direction: "across" },
      }),
      "ArrowRight",
      false,
    );
    expect(out?.selection).toEqual({ cell: 16, direction: "across" });
  });
});

describe("Tab and Shift+Tab go through tabTarget (keyboard map; next-word.json, previous-word.json)", () => {
  it("Tab lands on the next clue's first empty cell", () => {
    const out = keyEffect(
      env({ selection: { cell: 0, direction: "across" } }),
      "Tab",
      false,
    );
    expect(out?.selection).toEqual({ cell: 3, direction: "across" });
  });

  it("Shift+Tab runs the symmetric first-empty scan into the previous clue", () => {
    const out = keyEffect(
      env({
        filled: new Set([0]),
        selection: { cell: 3, direction: "across" },
      }),
      "Tab",
      true,
    );
    expect(out?.selection).toEqual({ cell: 1, direction: "across" });
  });
});

describe("Backspace and Delete are aliased through backspaceTarget (keyboard map; backspace-step-back.json)", () => {
  it("clears a non-empty current cell in place and stays", () => {
    const out = keyEffect(
      env({
        filled: new Set([3]),
        selection: { cell: 3, direction: "across" },
      }),
      "Backspace",
      false,
    );
    expect(out?.mutations).toEqual([{ type: "clearCell", cell: 3 }]);
    expect(out?.selection).toEqual({ cell: 3, direction: "across" });
  });

  it("on an already-empty cell steps back across the block into the previous word and clears there", () => {
    const out = keyEffect(
      env({
        filled: new Set([1]),
        selection: { cell: 3, direction: "across" },
      }),
      "Backspace",
      false,
    );
    expect(out?.selection).toEqual({ cell: 1, direction: "across" });
    expect(out?.mutations).toEqual([{ type: "clearCell", cell: 1 }]);
  });

  it("stepping back onto an already-empty cell moves without sending a no-op clear", () => {
    const out = keyEffect(
      env({ selection: { cell: 3, direction: "across" } }),
      "Backspace",
      false,
    );
    expect(out?.selection).toEqual({ cell: 1, direction: "across" });
    expect(out?.mutations).toEqual([]);
  });

  it("Delete behaves identically to Backspace", () => {
    const backspace = keyEffect(
      env({
        filled: new Set([1]),
        selection: { cell: 3, direction: "across" },
      }),
      "Backspace",
      false,
    );
    const del = keyEffect(
      env({
        filled: new Set([1]),
        selection: { cell: 3, direction: "across" },
      }),
      "Delete",
      false,
    );
    expect(del).toEqual(backspace);
  });
});

describe("Space clears and advances one cell, clamping at the word end (Decision 2.1d-5; space-clear-advance.json)", () => {
  it("clears a non-empty cell and advances onto the next cell even when it is filled (no filled-skip)", () => {
    const out = keyEffect(
      env({
        filled: new Set([15, 16]),
        selection: { cell: 15, direction: "across" },
      }),
      " ",
      false,
    );
    expect(out?.mutations).toEqual([{ type: "clearCell", cell: 15 }]);
    expect(out?.selection).toEqual({ cell: 16, direction: "across" });
  });

  it("on an empty cell just advances (no clearCell mutation, nothing to clear)", () => {
    const out = keyEffect(
      env({ selection: { cell: 15, direction: "across" } }),
      " ",
      false,
    );
    expect(out?.mutations).toEqual([]);
    expect(out?.selection).toEqual({ cell: 16, direction: "across" });
  });

  it("clamps at the word end and never crosses into the next word (canEscapeWord false)", () => {
    const out = keyEffect(
      env({
        filled: new Set([12]),
        selection: { cell: 12, direction: "across" },
      }),
      " ",
      false,
    );
    expect(out?.mutations).toEqual([{ type: "clearCell", cell: 12 }]);
    expect(out?.selection).toEqual({ cell: 12, direction: "across" });
  });

  it("never toggles direction (the vetoed Space-toggle is gone)", () => {
    const out = keyEffect(
      env({ selection: { cell: 8, direction: "down" } }),
      " ",
      false,
    );
    expect(out?.selection.direction).toBe("down");
  });
});

describe("Enter and Escape are no-ops (keyboard map)", () => {
  it("returns null so the browser default stands", () => {
    expect(keyEffect(env(), "Enter", false)).toBeNull();
    expect(keyEffect(env(), "Escape", false)).toBeNull();
  });
});

describe("after a terminal state navigation stays live and mutation freezes (ROADMAP 2.1d; INV-4 scope)", () => {
  it("typing is refused: handled, but no mutation and no cursor motion", () => {
    const out = keyEffect(
      env({ frozen: true, selection: { cell: 15, direction: "across" } }),
      "a",
      false,
    );
    expect(out).toEqual({
      selection: { cell: 15, direction: "across" },
      mutations: [],
    });
  });

  it("Space is refused: it mutates, so it freezes with typing (Decision 2.1d-5)", () => {
    const out = keyEffect(
      env({
        frozen: true,
        filled: new Set([15]),
        selection: { cell: 15, direction: "across" },
      }),
      " ",
      false,
    );
    expect(out).toEqual({
      selection: { cell: 15, direction: "across" },
      mutations: [],
    });
  });

  it("Backspace and Delete are refused", () => {
    const out = keyEffect(
      env({
        frozen: true,
        filled: new Set([3]),
        selection: { cell: 3, direction: "across" },
      }),
      "Delete",
      false,
    );
    expect(out).toEqual({
      selection: { cell: 3, direction: "across" },
      mutations: [],
    });
  });

  it("arrows and Tab keep working: the frozen board stays explorable", () => {
    const arrow = keyEffect(
      env({ frozen: true, selection: { cell: 1, direction: "across" } }),
      "ArrowRight",
      false,
    );
    expect(arrow?.selection).toEqual({ cell: 3, direction: "across" });
    const tab = keyEffect(
      env({ frozen: true, selection: { cell: 0, direction: "across" } }),
      "Tab",
      false,
    );
    expect(tab?.selection).toEqual({ cell: 3, direction: "across" });
  });
});

describe("the three pointer paths (ROADMAP 2.1d selection model, v2 verbatim)", () => {
  it("clicking a playable cell other than the current one moves and keeps direction", () => {
    expect(cellClick(grid, { cell: 0, direction: "down" }, 8)).toEqual({
      cell: 8,
      direction: "down",
    });
  });

  it("clicking the already-current cell toggles direction and does not move", () => {
    expect(cellClick(grid, { cell: 8, direction: "across" }, 8)).toEqual({
      cell: 8,
      direction: "down",
    });
  });

  it("clicking a block is a no-op", () => {
    expect(cellClick(grid, { cell: 8, direction: "across" }, 2)).toBeNull();
  });

  it("clicking a clue jumps to its start unconditionally and sets its axis (no first-empty scan)", () => {
    // clueClick takes no fill state at all: this path is neither Tab nor Shift+Tab,
    // so no first-empty scan can run.
    expect(clueClick({ direction: "down", cells: [3, 8] })).toEqual({
      cell: 3,
      direction: "down",
    });
  });

  it("pointer paths stay live after a terminal state (navigation, not mutation)", () => {
    // cellClick and clueClick never mutate, so they take no frozen flag at all.
    expect(cellClick(grid, { cell: 0, direction: "across" }, 3)).toEqual({
      cell: 3,
      direction: "across",
    });
  });
});

describe("initial position (DESIGN section 5)", () => {
  it("first playable cell, direction across", () => {
    expect(initialSelection(grid)).toEqual({ cell: 0, direction: "across" });
    const blockedStart: Grid = { cols: 5, rows: 4, blocks: new Set([0, 1]) };
    expect(initialSelection(blockedStart)).toEqual({
      cell: 2,
      direction: "across",
    });
  });
});
