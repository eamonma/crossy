// Puzzle-identity digest for ingest dedup (DESIGN.md D23, PROTOCOL.md section 12). A per-account
// content digest computed at the ACL boundary once a document has translated to a ServerPuzzle
// and passed every named domain check. Identity is the whole puzzle (owner ruling 2026-07-12: a
// false positive costs far more than a false negative, so the match is strict): every field a
// solver sees is in the hash, so a collision is a near-certain true duplicate.
//
// INV-6: the digest takes the solution as an input, so two documents hashing equal reveals they
// are the same puzzle. The digest is a solution oracle. It lives only in a server-side column and
// never crosses the wire, off every ClientPuzzle and every POST /puzzles response, the same
// discipline as the solution itself.
//
// The canon grammar and the sha256 goldens are pinned by vectors/puzzle-digest/ BEFORE this code
// (the house rule); digest.test.ts runs this function against that suite.
import { createHash } from "node:crypto";
import { asciiUppercase } from "@crossy/protocol";
import type { ServerPuzzle } from "@crossy/protocol";

/** Line 1 of the canon; a future grammar change is a new tag, never a silent digest shift. */
const CANON_VERSION = "crossy-puzzle-digest/v1";
/** The solution sentinel for a black square. `#` is outside the A-Z0-9 solution charset. */
const BLACK_SQUARE = "#";

/** Sorted-ascending, de-duplicated, comma-joined cell indices; empty string when none. */
function sortedSet(indices: readonly number[] | undefined): string {
  if (!indices || indices.length === 0) return "";
  return [...new Set(indices)].sort((a, b) => a - b).join(",");
}

/**
 * The canonical string a ServerPuzzle reduces to (vectors/puzzle-digest/canon.json). Line order
 * is fixed and there is NO trailing newline. `blocks`, `circles`, and `shadedCircles` are sorted
 * sets; the solution is row-major with a `#` sentinel for a black square and each answer
 * ASCII-uppercased (INV-1); clues are across then down, each ascending by number, carrying only
 * the normalized plain `text` (runs are excluded, so the digest is stable across the clue-runs
 * wave; cell indices are grid-derived and add no identity the geometry does not already carry).
 */
export function canonPuzzle(puzzle: ServerPuzzle): string {
  const lines: string[] = [
    CANON_VERSION,
    `dims=${puzzle.rows}x${puzzle.cols}`,
    `blocks=${sortedSet(puzzle.blocks)}`,
    `circles=${sortedSet(puzzle.circles)}`,
    `shaded=${sortedSet(puzzle.shadedCircles)}`,
    `solution=${puzzle.solution
      .map((cell) => (cell === null ? BLACK_SQUARE : asciiUppercase(cell)))
      .join("|")}`,
  ];
  for (const [axis, clues] of [
    ["A", puzzle.clues?.across],
    ["D", puzzle.clues?.down],
  ] as const) {
    const ordered = [...(clues ?? [])].sort((x, y) => x.number - y.number);
    for (const clue of ordered) {
      lines.push(`clue=${axis}:${clue.number}:${clue.text}`);
    }
  }
  return lines.join("\n");
}

/** The per-account content digest: lowercase sha256 hex of the canonical string. Server-only. */
export function puzzleDigest(puzzle: ServerPuzzle): string {
  return createHash("sha256").update(canonPuzzle(puzzle), "utf8").digest("hex");
}
