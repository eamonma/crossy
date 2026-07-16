// The room-actions derivations (docs/design/room-actions-control.md): the popover's gate,
// the sequenced-only grid-full count the check row rides (R9), the overlay-suppressed marks
// (R6, PROTOCOL.md §10), and the two quiet lines of copy.
import { describe, expect, it } from "vitest";
import type { PendingCommand } from "../store/gameStore";
import {
  checkedCountLabel,
  emptyCellsHint,
  emptyPlayableCount,
  showRoomActions,
  visibleCheckMarks,
} from "./roomActions";

/** A sequenced-value reader over a plain map, the shape GameStore.sequencedValue serves. */
function reader(
  values: ReadonlyMap<number, string>,
): (cell: number) => string | null {
  return (cell) => values.get(cell) ?? null;
}

function pending(cell: number, value: string | null = "A"): PendingCommand {
  return { commandId: `c-${cell}`, cell, value };
}

describe("showRoomActions (R4: the popover renders only while ongoing)", () => {
  it("stands for a host or solver in an ongoing game", () => {
    expect(showRoomActions("ongoing", false, "live")).toBe(true);
  });
  it("hides once completed", () => {
    expect(showRoomActions("completed", false, "live")).toBe(false);
  });
  it("hides once abandoned: terminal means terminal, not completed (R4)", () => {
    expect(showRoomActions("abandoned", false, "live")).toBe(false);
  });
  it("hides from spectators, who see neither row (design doc §5)", () => {
    expect(showRoomActions("ongoing", true, "live")).toBe(false);
  });
  it("waits for the first welcome: pre-handshake `ongoing` is a placeholder, not a status", () => {
    expect(showRoomActions("ongoing", false, "connecting")).toBe(false);
  });
  it("stands through resync and reconnect, which are real states of a known room", () => {
    expect(showRoomActions("ongoing", false, "resyncing")).toBe(true);
    expect(showRoomActions("ongoing", false, "reconnecting")).toBe(true);
  });
});

describe("emptyPlayableCount (R9: the client mirrors the server's grid-full gate, PROTOCOL.md §10)", () => {
  it("counts only playable cells: blocks are excluded from the gate", () => {
    // 2x2 board, one block, one filled playable cell: two playable cells stay empty.
    const blocks = new Set([3]);
    const values = new Map([[0, "A"]]);
    expect(emptyPlayableCount(4, blocks, reader(values))).toBe(2);
  });
  it("reads zero when every playable cell holds a sequenced value (the row enables)", () => {
    const blocks = new Set([1]);
    const values = new Map([
      [0, "A"],
      [2, "B"],
      [3, "C"],
    ]);
    expect(emptyPlayableCount(4, blocks, reader(values))).toBe(0);
  });
  it("an all-blocks column contributes nothing (no playable cells, trivially full)", () => {
    expect(emptyPlayableCount(2, new Set([0, 1]), reader(new Map()))).toBe(0);
  });
});

describe("visibleCheckMarks (R6, PROTOCOL.md §10: a pending overlay entry renders the overlay, not the mark)", () => {
  it("suppresses the mark on a cell with a pending optimistic entry", () => {
    const marks = visibleCheckMarks(new Set([3, 7]), [pending(3)]);
    expect([...marks].sort()).toEqual([7]);
  });
  it("suppresses under a pending clear too: null-valued entries are still pending overlay", () => {
    const marks = visibleCheckMarks(new Set([3]), [pending(3, null)]);
    expect(marks.size).toBe(0);
  });
  it("passes the standing set through untouched when nothing is pending", () => {
    const standing = new Set([1, 2]);
    const marks = visibleCheckMarks(standing, []);
    expect([...marks].sort()).toEqual([1, 2]);
  });
  it("is display only: the store's standing set is never mutated (suppression is not clearing)", () => {
    const standing = new Set([3, 7]);
    visibleCheckMarks(standing, [pending(3), pending(7)]);
    expect([...standing].sort()).toEqual([3, 7]);
  });
  it("an unrelated pending cell suppresses nothing", () => {
    const marks = visibleCheckMarks(new Set([3]), [pending(9)]);
    expect([...marks]).toEqual([3]);
  });
});

describe("the check row's copy (design doc §5, R10)", () => {
  it("the remaining-cells hint counts quietly, singular and plural", () => {
    expect(emptyCellsHint(1)).toBe("1 cell empty");
    expect(emptyCellsHint(3)).toBe("3 cells empty");
  });
  it("the checked-count line is absent before the first check (R10)", () => {
    expect(checkedCountLabel(0)).toBeNull();
  });
  it("reads 'Checked once', then 'Checked N times' (R10)", () => {
    expect(checkedCountLabel(1)).toBe("Checked once");
    expect(checkedCountLabel(4)).toBe("Checked 4 times");
  });
});
