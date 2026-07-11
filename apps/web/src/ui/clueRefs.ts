// Pure reference parser: given a clue's prose, find the entries it points at, like
// "See 42-Down" or "17, 20, 49, and 59 across". Parse only. It never checks whether a
// referenced entry exists; the call site filters against the puzzle's real clue list, so
// this stays a string-to-pairs function with no puzzle knowledge and no IO.
//
// The hard part is the distributed list: one trailing direction word governs every number
// before it ("5 and 12 down" is 5-Down and 12-Down). We scan for maximal runs of
// number-then-connector that close on a direction word, then read every number out of the
// run and pair each with that word. A direction word ends its run, so "17-Across and 3-Down"
// splits into two runs and yields one entry per axis.
import type { Direction } from "@crossy/engine";

export interface ClueRef {
  readonly number: number;
  readonly direction: Direction;
}

// One run: some numbers joined by list connectors (comma, "and", "&", hyphen, whitespace, in
// any run), closed by a direction word. The connector before the direction word is a hyphen or
// spaces ("17-Across", "17 Across"); requiring [\s-]+ there keeps "12down" glued prose out. The
// trailing \b stops "Downtown" or "Rundown" from reading as a direction. Case-insensitive per
// the direction-word requirement.
//
// [0-9]{1,3} caps a number at three digits (clue numbers never run longer), and the (?<![0-9])
// guard forbids a preceding digit, so a four-digit year ("in 1999") can never donate its last
// three digits to a run. Together they reject years and enumerations that carry no direction.
const RUN =
  /(?<![0-9])([0-9]{1,3}(?:(?:\s*(?:,|&|-|and|\s)\s*)+(?<![0-9])[0-9]{1,3})*)[\s-]+(across|down)\b/gi;

// The numbers inside a run, read left to right. Same three-digit cap and leading-digit guard
// as RUN so the two never disagree on what counts as one number.
const NUMBER = /(?<![0-9])[0-9]{1,3}/g;

/**
 * The (number, direction) pairs a clue's text references, in reading order, duplicates kept.
 * Returns [] when the text is empty or names no entry. A bare number, a year, or an
 * enumeration like "(17)" carries no direction word, so none of them produce a pair.
 */
export function parseClueRefs(text: string | undefined): ClueRef[] {
  if (text === undefined || text === "") return [];

  const refs: ClueRef[] = [];
  for (const run of text.matchAll(RUN)) {
    // Both groups are required by RUN, so a match always carries them; the guard only satisfies
    // the strict-null checker.
    const [, numbers, dir] = run;
    if (numbers === undefined || dir === undefined) continue;
    const direction = dir.toLowerCase() as Direction;
    for (const num of numbers.matchAll(NUMBER)) {
      refs.push({ number: Number.parseInt(num[0], 10), direction });
    }
  }
  return refs;
}
