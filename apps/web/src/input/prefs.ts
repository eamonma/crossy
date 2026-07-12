// Personal navigation preferences (settings slice 1) and the pure typing-advance they
// steer. These are per-device, client-local choices that shape where the cursor lands
// after a letter is placed; they never cross the wire and never enter packages/engine
// (INV-9: the engine stays pure and vector-pinned). The engine's typingAdvance is the
// vector-locked default path; this module composes the engine's primitives to offer the
// two opt-in variations, and the default of both prefs reproduces typingAdvance exactly
// so a solver who never opens Settings sees zero change.
//
// The two dimensions:
//  - skipFilledInWord (default ON, the NYT default): while typing within a word, advance
//    to the next EMPTY cell of the word, skipping already-filled cells. OFF advances to
//    the immediately next cell of the word regardless of fill.
//  - endOfWord (default "first-blank", which is what the web app does today): what happens
//    when forward motion reaches the word's end. "first-blank" jumps back to the word's
//    first remaining blank (staying on the last cell when the word is full). "next-clue"
//    advances to the next clue in the Tab traversal order the moment the word completes.
import { tabTarget, wordBounds } from "@crossy/engine";
import type { Direction, Grid } from "@crossy/engine";

/** Skip already-filled cells while advancing within a word (the NYT default, ON). */
export type SkipFilledInWord = boolean;

/** Where the cursor goes when forward motion reaches the end of a word. */
export type EndOfWord = "next-clue" | "first-blank";

export interface NavPrefs {
  readonly skipFilledInWord: SkipFilledInWord;
  readonly endOfWord: EndOfWord;
}

/**
 * The defaults reproduce the web app's behavior before this slice existed, which is also
 * what the engine's vector-pinned typingAdvance encodes: filled-skip ON, and at the word's
 * end wrap back to the first blank (staying put on a full word). A solver who never touches
 * Settings gets exactly this.
 */
export const DEFAULT_NAV_PREFS: NavPrefs = {
  skipFilledInWord: true,
  endOfWord: "first-blank",
};

/** The landing after a letter is placed: a cell to select, plus the axis it belongs to.
 * The axis only changes when advancing across a clue boundary (an end-of-word jump to the
 * next clue, whose axis the Tab cycle may flip); an in-word advance keeps the current axis. */
export interface Advance {
  readonly cell: number;
  readonly direction: Direction;
}

/**
 * The cursor move after a letter is placed at `from`, steered by the two prefs. `filled` is
 * the board AFTER the keystroke, so `from` is filled. `direction` is the current axis. The
 * result carries the axis because an end-of-word jump to the next clue can cross axes.
 *
 * The rules, by pref combination:
 *  - skipFilledInWord ON: scan forward within the word for the next empty cell.
 *  - skipFilledInWord OFF: step to the immediately next cell of the word, ignoring fill,
 *    clamping at the word's last cell.
 *  - On reaching the word's end (no empty cell ahead under ON, or the last cell under OFF):
 *      endOfWord "first-blank": if a blank remains in the word, jump back to its FIRST blank.
 *        If the word is full, stay on the last cell. This is exactly today's web behavior.
 *      endOfWord "next-clue": advance to the next clue (the Tab traversal), blanks behind or
 *        not. The NYT "move to next word" rule: the point of the setting is that the cursor
 *        never wraps back. The iOS twin (CrossyEngine typingAdvance, .nextClue) matches.
 *
 * With the defaults (skipFilledInWord ON + endOfWord "first-blank") this is byte-identical to
 * the engine's vector-pinned typingAdvance: next empty ahead, else first blank behind, else
 * stay on the full word's last cell. Only "next-clue" introduces motion the engine never had.
 * See prefs.test.ts.
 *
 * SPEC RESOLUTION (twin-reconciled): the wave spec's "first-blank" said a FULL word should
 * "advance to the next clue exactly like next-clue". Today's behavior in both ports (the
 * engines' typingAdvance, locked by vectors/v1/navigation/full-word-asymmetry.json: typing the
 * last cell of a full word STAYS on it) does not, and vectors win. So "first-blank" keeps the
 * stay-put on a full word, and every advance-to-next-clue behavior is "next-clue"'s job,
 * explicit opt-in only. Both ports implement this identically.
 */
export function typingAdvanceWithPrefs(
  grid: Grid,
  direction: Direction,
  from: number,
  filled: ReadonlySet<number>,
  prefs: NavPrefs,
): Advance {
  const { start, end } = wordBounds(grid, direction, from);
  const stride = direction === "across" ? 1 : grid.cols;

  // Forward motion within the word.
  if (prefs.skipFilledInWord) {
    // Skip filled: land on the next empty cell ahead in the word, if any.
    for (let cell = from + stride; cell <= end; cell += stride)
      if (!filled.has(cell)) return here(cell, direction);
  } else {
    // No skip: the immediately next cell of the word, ignoring fill, clamping at the last
    // cell. When a next cell exists we stop there regardless of whether it is filled.
    if (from < end) return here(from + stride, direction);
  }

  // Reached the end of the word (nothing empty ahead under ON, or the last cell under OFF).
  if (prefs.endOfWord === "next-clue") {
    // Advance to the next clue, blanks behind or not: the NYT "move to next word" rule, the
    // point of the setting being that the cursor never wraps back. The iOS twin implements
    // exactly this (CrossyEngine typingAdvance, .nextClue arm).
    return nextClue(grid, direction, from, filled);
  }

  // endOfWord === "first-blank" (today's behavior): jump back to the word's first remaining
  // blank; a full word stays on its last cell (byte-identical to the engine's typingAdvance).
  const firstBlank = firstBlankInWord(start, end, stride, filled);
  if (firstBlank !== null) return here(firstBlank, direction);
  return here(end, direction);
}

/** The word's first blank cell scanned from its start, or null when the word is full. */
function firstBlankInWord(
  start: number,
  end: number,
  stride: number,
  filled: ReadonlySet<number>,
): number | null {
  for (let cell = start; cell <= end; cell += stride)
    if (!filled.has(cell)) return cell;
  return null;
}

/** Advance to the next clue in the Tab traversal order (the same path Tab/auto-advance uses),
 * landing on that clue's first empty cell. When nothing is empty anywhere, tabTarget moves to
 * the adjacent clue without skipping, so navigation stays live after a full solve. */
function nextClue(
  grid: Grid,
  direction: Direction,
  from: number,
  filled: ReadonlySet<number>,
): Advance {
  const target = tabTarget(grid, direction, from, "forward", filled);
  return { cell: target.cell, direction: target.direction };
}

function here(cell: number, direction: Direction): Advance {
  return { cell, direction };
}
