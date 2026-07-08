// Puzzle ingestion, walking-skeleton slice (DESIGN.md §7, ROADMAP Wave 2.1b). This slice
// accepts an already-internal `ServerPuzzle` fixture and validates its SHAPE only. The full
// anti-corruption layer that translates XWord Info JSON and applies the named G1 rejections
// (barred, diagramless, uniclue, oversize, degenerate, unsolvable-cell, rebus-too-long) is a
// later slice (ROADMAP Phase 3 Track C). Nothing here interprets the external format, and
// nothing here enforces gameplay validity beyond a well-formed fixture.
import type { ServerPuzzle } from "@crossy/protocol";

export type IngestResult =
  | { readonly ok: true; readonly puzzle: ServerPuzzle }
  | { readonly ok: false; readonly message: string };

function fail(message: string): IngestResult {
  return { ok: false, message };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isNonNegIntArray(x: unknown): x is number[] {
  return Array.isArray(x) && x.every((n) => Number.isInteger(n) && n >= 0);
}

function isClue(x: unknown): boolean {
  return (
    isObject(x) &&
    typeof x["number"] === "number" &&
    typeof x["text"] === "string" &&
    isNonNegIntArray(x["cellIndices"])
  );
}

function isClueList(x: unknown): boolean {
  return Array.isArray(x) && x.every(isClue);
}

/**
 * Validate a `ServerPuzzle` fixture's shape and return it typed, or a reason it is malformed.
 * Happy-path only: geometry is positive, index arrays are non-negative integers, clues carry
 * `{number, text, cellIndices}`, and the solution array is one entry per cell (string or null
 * for a block). This is not the solvability or feature-rejection suite.
 */
export function parseServerPuzzleFixture(body: unknown): IngestResult {
  if (!isObject(body)) return fail("puzzle must be a JSON object");
  const { rows, cols, blocks, circles, shadedCircles, clues, solution } = body;

  if (!Number.isInteger(rows) || (rows as number) <= 0) {
    return fail("rows must be a positive integer");
  }
  if (!Number.isInteger(cols) || (cols as number) <= 0) {
    return fail("cols must be a positive integer");
  }
  if (!isNonNegIntArray(blocks)) {
    return fail("blocks must be an array of cell indices");
  }
  if (!isNonNegIntArray(circles)) {
    return fail("circles must be an array of cell indices");
  }
  if (shadedCircles !== undefined && !isNonNegIntArray(shadedCircles)) {
    return fail("shadedCircles must be an array of cell indices");
  }
  if (
    !isObject(clues) ||
    !isClueList(clues["across"]) ||
    !isClueList(clues["down"])
  ) {
    return fail(
      "clues must carry across and down lists of {number, text, cellIndices}",
    );
  }
  if (!Array.isArray(solution)) {
    return fail("solution must be an array");
  }
  const cellCount = (rows as number) * (cols as number);
  if (solution.length !== cellCount) {
    return fail(`solution must have rows*cols (${cellCount}) entries`);
  }
  if (!solution.every((s) => s === null || typeof s === "string")) {
    return fail("solution entries must be a string or null");
  }

  return { ok: true, puzzle: body as unknown as ServerPuzzle };
}
