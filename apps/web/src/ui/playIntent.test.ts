// The play intent's contract (D22): landing on `/puzzles?play=<id>` opens the create flow for
// that library puzzle and never creates anything by itself; the param is consumed once so a
// refresh does not re-fire; an unknown id degrades to a message, never a blank screen.
import { describe, expect, it } from "vitest";
import type { PuzzleSummary } from "./homeData";
import type { Resource } from "./useResource";
import { resolvePlayIntent, strippedPlaySearch } from "./playIntent";

function puzzle(puzzleId: string): PuzzleSummary {
  return {
    puzzleId,
    createdAt: "2026-07-11T12:00:00Z",
    rows: 15,
    cols: 15,
    features: null,
    title: "Saturday Stumper",
    author: "Ada",
    mask: ["#..", ".#.", "..#"],
  };
}

const ready = (puzzles: PuzzleSummary[]): Resource<PuzzleSummary[]> => ({
  phase: "ready",
  data: puzzles,
});

describe("resolvePlayIntent (the intent opens the flow, the click creates the game)", () => {
  it("preselects the library puzzle for the intent id; resolution is pure, no server call", () => {
    const target = puzzle("p-1");
    const resolved = resolvePlayIntent("p-1", ready([puzzle("p-0"), target]));
    // The panel renders this puzzle preselected with the existing New game button; the one
    // POST /games stays behind that explicit click, so a drive-by GET mints nothing.
    expect(resolved).toEqual({ kind: "found", puzzle: target });
  });

  it("resolves an unknown or foreign id to the inline message, never a blank screen", () => {
    expect(resolvePlayIntent("p-9", ready([puzzle("p-1")]))).toEqual({
      kind: "unknown",
    });
    expect(resolvePlayIntent("p-9", ready([]))).toEqual({ kind: "unknown" });
  });

  it("stays pending while the library read is in flight or errored", () => {
    expect(resolvePlayIntent("p-1", { phase: "loading" })).toEqual({
      kind: "pending",
    });
    expect(resolvePlayIntent("p-1", { phase: "error" })).toEqual({
      kind: "pending",
    });
  });

  it("resolves to none without an intent, so a plain library visit is untouched", () => {
    expect(resolvePlayIntent(null, ready([puzzle("p-1")]))).toEqual({
      kind: "none",
    });
  });
});

describe("strippedPlaySearch (the param strips after consumption, so refresh never re-fires)", () => {
  it("strips play and keeps every other param", () => {
    expect(strippedPlaySearch("?play=p-1")).toBe("");
    expect(strippedPlaySearch("?play=p-1&api=http%3A%2F%2Fa&token=T")).toBe(
      "?api=http%3A%2F%2Fa&token=T",
    );
  });

  it("returns null on a clean URL, so consumption is idempotent", () => {
    expect(strippedPlaySearch("")).toBeNull();
    expect(strippedPlaySearch("?api=http%3A%2F%2Fa")).toBeNull();
  });
});
