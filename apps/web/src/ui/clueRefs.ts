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
//
// The starred-clue convention is the second kind of reference (D26). A theme clue opens with a
// literal `*` and a revealer names the whole set collectively ("...the starred clues"), so the
// pair below is a predicate on the clue and a predicate on the prose, not a parse: a starred ref
// carries no number and no direction to read out. The call site resolves both kinds into one key
// set, so they union and paint the same tier.
import type { Direction } from "@crossy/engine";
import type { Clue } from "../domain/types";

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

// A revealer naming the starred set. The noun is required: "starred" alone is ordinary prose
// ("Starred in a movie"), and only the adjacent noun separates the convention from the verb. The
// asymmetry is why this is biased hard toward precision: a missed revealer degrades to no
// highlight, while a false one paints roughly a quarter of the grid. [\s-]+ is the same connector
// idiom RUN uses, so a hyphenated "starred-clue" reads like "17-Across" does. Case-insensitive:
// the revealer opens a sentence as often as not.
const STARRED =
  /\b(?:starred|asterisked)[\s-]+(?:clues?|answers?|entries|entry|squares?)\b/i;

// The convention's mark: a literal `*` opening the clue, leading whitespace tolerated. PROTOCOL
// section 12 law 11 carries the star through ingestion verbatim, so plain `text` is the whole
// story here. Read `text`, never `runs`: the runs concatenate to `text` (law 1), so a star split
// into its own styled run still shows up at the front of `text`.
const STARRED_MARK = /^\s*\*/;

/**
 * Whether a clue wears the starred-clue convention, meaning its prose opens with a literal `*`.
 * A clue with no text is not starred.
 */
export function isStarredClue(clue: Clue): boolean {
  return clue.text !== undefined && STARRED_MARK.test(clue.text);
}

/**
 * Whether a clue's text is a revealer, meaning it names the starred clues collectively. The link
 * is one-way by ruling (D26): this answers "does this prose name the starred set?", and a starred
 * clue's own prose names nothing, so a starred clue is never a revealer by virtue of its star.
 * Returns false for empty or absent text.
 */
export function referencesStarredClues(text: string | undefined): boolean {
  return text !== undefined && STARRED.test(text);
}

/**
 * The keys of every clue the active clue references, keyed `${direction}-${number}` like the
 * presence map so a row looks itself up in O(1). This is the chokepoint: both kinds of reference
 * resolve here and union into one set (D26), the numbers the prose names and, when the prose is a
 * revealer, every starred clue. `mark` is the single gate, so a reference to an entry this grid
 * lacks, or the active clue naming itself, never lights a row. The parsers above read intent only;
 * existence is decided here, against the puzzle's real clue lists.
 *
 * Empty when there is no active clue, or when the clue names no entry that exists.
 *
 * The Swift twin is `ClueBook.referencedIds(for:)`: same guards, same shape, different key scheme
 * (`18A` there, `across-18` here).
 */
export function referencedKeys(
  activeClue: Clue | undefined,
  acrossClues: readonly Clue[],
  downClues: readonly Clue[],
): Set<string> {
  const marks = new Set<string>();
  if (activeClue === undefined) return marks;

  const exists = new Set<string>();
  for (const c of acrossClues) exists.add(`across-${c.number}`);
  for (const c of downClues) exists.add(`down-${c.number}`);
  const self = `${activeClue.direction}-${activeClue.number}`;
  const mark = (key: string): void => {
    if (exists.has(key) && key !== self) marks.add(key);
  };

  for (const ref of parseClueRefs(activeClue.text)) {
    mark(`${ref.direction}-${ref.number}`);
  }
  // A revealer names the theme set collectively, so it resolves to every clue wearing the star.
  // One-way by ruling, so a starred clue lights nothing on its own.
  if (referencesStarredClues(activeClue.text)) {
    for (const c of [...acrossClues, ...downClues]) {
      if (isStarredClue(c)) mark(`${c.direction}-${c.number}`);
    }
  }
  return marks;
}

/**
 * The cells a set of referenced clues covers, unioned across both axes. `keys` is `referencedKeys`
 * output, already existence-filtered, so a key naming a clue this puzzle lacks simply matches
 * nothing and contributes no cells. Same key scheme the presence map and clue rail use, so a clue
 * looks itself up in O(1).
 */
export function referencedCells(
  keys: ReadonlySet<string>,
  acrossClues: readonly Clue[],
  downClues: readonly Clue[],
): Set<number> {
  const cells = new Set<number>();
  for (const clue of acrossClues) {
    if (keys.has(`across-${clue.number}`)) {
      for (const cell of clue.cells) cells.add(cell);
    }
  }
  for (const clue of downClues) {
    if (keys.has(`down-${clue.number}`)) {
      for (const cell of clue.cells) cells.add(cell);
    }
  }
  return cells;
}
