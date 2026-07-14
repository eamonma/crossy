// The completed mosaic's selection legality and geometry (reactions-11). The overlay restores a
// movable selection on the finished board so reactions can anchor anywhere (PROTOCOL.md §9: react is
// legal in any status and gated on a valid target cell, not the frozen mutation gate). These pin the
// two facts the DOM component leans on: blocks are never selectable, and letter entry stays inert
// after completion, so the aim overlay never mutates the board.
import { describe, expect, it } from "vitest";
import type { Grid } from "@crossy/engine";
import { cellBox, isMosaicSelectable, mosaicTargets } from "./mosaicSelect";
import { cellClick, keyEffect } from "../input/actions";

// A 5x4 board with blocks at 2, 6, 13 (the actions.test.ts fixture, so the two suites agree on
// which indices are playable).
const grid: Grid = { cols: 5, rows: 4, blocks: new Set([2, 6, 13]) };

describe("mosaic selection legality (PROTOCOL.md §9 target-cell rule; INV-4 terminal board)", () => {
  it("blocks are never pointer targets, so a block is not selectable on the mosaic", () => {
    const cells = mosaicTargets(grid).map((b) => b.cell);
    expect(cells).not.toContain(2);
    expect(cells).not.toContain(6);
    expect(cells).not.toContain(13);
    // Every other cell in a 5x4 grid is a playable target.
    expect(cells).toHaveLength(5 * 4 - 3);
    expect(cells).toContain(0);
    expect(cells).toContain(19);
  });

  it("isMosaicSelectable mirrors isCursorTarget: in range and not a block (PROTOCOL.md §9)", () => {
    expect(isMosaicSelectable(0, grid)).toBe(true);
    expect(isMosaicSelectable(19, grid)).toBe(true);
    // A block, out of range, negative, and a fractional index all fail, so the ring hides.
    expect(isMosaicSelectable(6, grid)).toBe(false);
    expect(isMosaicSelectable(20, grid)).toBe(false);
    expect(isMosaicSelectable(-1, grid)).toBe(false);
    expect(isMosaicSelectable(1.5, grid)).toBe(false);
  });

  it("clicking a block moves nothing (the live grid's cellClick rule the overlay reuses)", () => {
    expect(cellClick(grid, { cell: 0, direction: "across" }, 2)).toBeNull();
    expect(cellClick(grid, { cell: 0, direction: "across" }, 3)).toEqual({
      cell: 3,
      direction: "across",
    });
  });
});

describe("mosaic cell geometry (row-major percentages, PROTOCOL.md §3)", () => {
  it("places the top-left cell at the origin and sizes a cell by the grid", () => {
    expect(cellBox(0, 5, 4)).toEqual({
      cell: 0,
      leftPct: 0,
      topPct: 0,
      widthPct: 20,
      heightPct: 25,
    });
  });

  it("places an edge cell (bottom-right) flush against the far corner, never clipped", () => {
    // Cell 19 is col 4, row 3: its box starts one cell-width/height short of 100%, so its far edge
    // lands exactly at the board edge.
    expect(cellBox(19, 5, 4)).toEqual({
      cell: 19,
      leftPct: 80,
      topPct: 75,
      widthPct: 20,
      heightPct: 25,
    });
  });
});

describe("letter entry is inert on the completed board (INV-4; PROTOCOL.md §9)", () => {
  const frozenEnv = {
    grid,
    filled: new Set<number>(),
    selection: { cell: 0, direction: "across" as const },
    frozen: true,
  };

  it("a letter key produces no mutation and does not move the selection", () => {
    const effect = keyEffect(frozenEnv, "a", false);
    expect(effect).not.toBeNull();
    expect(effect?.mutations).toEqual([]);
    expect(effect?.selection).toEqual(frozenEnv.selection);
  });

  it("space and backspace stay inert too, so the aim overlay never clears a cell", () => {
    expect(keyEffect(frozenEnv, " ", false)?.mutations).toEqual([]);
    expect(keyEffect(frozenEnv, "Backspace", false)?.mutations).toEqual([]);
  });

  it("arrows still move, so the finished board stays explorable to aim a reaction", () => {
    const effect = keyEffect(frozenEnv, "ArrowRight", false);
    expect(effect?.mutations).toEqual([]);
    expect(effect?.selection.cell).toBe(1);
  });
});
