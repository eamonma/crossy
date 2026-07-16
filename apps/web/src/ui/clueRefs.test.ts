// The clue reference parser: prose in, (number, direction) pairs out. These tests pin the
// grammar the owner asked for (single refs hyphenated or spaced, "See N-Down" prose, distributed
// lists sharing one trailing direction word, mixed axes in one clue, case-insensitivity) and the
// hard "never match" line: bare numbers, years, and "(17)" enumerations carry no direction word,
// so they yield nothing. Existence is not this module's job; the call site filters against the
// real clue list, so a parsed ref for a clue that does not exist is correct behavior here.
//
// The starred-clue predicates (D26) are pinned the same way, and the same division of labor
// holds: they answer "is this clue starred?" and "does this prose name the starred set?" and
// nothing more. referencedKeys is where both kinds of reference meet a real clue list, so the
// existence and self-exclusion guards are pinned there. These cases are normative for the Swift
// port; referencedKeys maps to ClueBook.referencedIds(for:).
import { describe, expect, it } from "vitest";
import type { Clue } from "../domain/types";
import {
  isStarredClue,
  parseClueRefs,
  referencedCells,
  referencedKeys,
  referencesStarredClues,
} from "./clueRefs";

describe("parseClueRefs", () => {
  it("reads a hyphenated single ref", () => {
    expect(parseClueRefs("42-Down")).toEqual([
      { number: 42, direction: "down" },
    ]);
  });

  it("reads a spaced single ref", () => {
    expect(parseClueRefs("17 Across")).toEqual([
      { number: 17, direction: "across" },
    ]);
  });

  it("reads a ref buried in prose, like 'See 42-Down'", () => {
    expect(parseClueRefs("See 42-Down")).toEqual([
      { number: 42, direction: "down" },
    ]);
  });

  it("is case-insensitive on the direction word", () => {
    expect(parseClueRefs("42-DOWN and 8-across and 3 AcRoSs")).toEqual([
      { number: 42, direction: "down" },
      { number: 8, direction: "across" },
      { number: 3, direction: "across" },
    ]);
  });

  it("distributes one trailing direction word over a comma-and list", () => {
    expect(parseClueRefs("17, 20, 49, and 59 across")).toEqual([
      { number: 17, direction: "across" },
      { number: 20, direction: "across" },
      { number: 49, direction: "across" },
      { number: 59, direction: "across" },
    ]);
  });

  it("distributes over a short 'and' list", () => {
    expect(parseClueRefs("5 and 12 down")).toEqual([
      { number: 5, direction: "down" },
      { number: 12, direction: "down" },
    ]);
  });

  it("distributes over an ampersand list", () => {
    expect(parseClueRefs("1, 5 & 9 Down")).toEqual([
      { number: 1, direction: "down" },
      { number: 5, direction: "down" },
      { number: 9, direction: "down" },
    ]);
  });

  it("keeps mixed axes in one clue on their own direction words", () => {
    expect(parseClueRefs("17-Across and 3-Down")).toEqual([
      { number: 17, direction: "across" },
      { number: 3, direction: "down" },
    ]);
  });

  it("keeps a distributed list and a later single ref apart", () => {
    expect(parseClueRefs("17, 20, and 49 across, plus 3 down")).toEqual([
      { number: 17, direction: "across" },
      { number: 20, direction: "across" },
      { number: 49, direction: "across" },
      { number: 3, direction: "down" },
    ]);
  });

  it("reads refs in the order they appear, duplicates kept for the call site to dedupe", () => {
    expect(parseClueRefs("8-Down, see also 8-Down")).toEqual([
      { number: 8, direction: "down" },
      { number: 8, direction: "down" },
    ]);
  });

  it("reads a three-digit clue number", () => {
    expect(parseClueRefs("With 100-Across")).toEqual([
      { number: 100, direction: "across" },
    ]);
  });

  // The "never match" line the owner drew.
  it("does not match a bare number with no direction word", () => {
    expect(parseClueRefs("Just the number 5 alone")).toEqual([]);
  });

  it("does not match a year", () => {
    expect(parseClueRefs("Event of 1999")).toEqual([]);
    expect(parseClueRefs("In 1066 across the channel")).toEqual([]);
  });

  it("does not read a four-digit number's tail as a reference", () => {
    expect(parseClueRefs("1000 down")).toEqual([]);
    expect(parseClueRefs("12345 across")).toEqual([]);
  });

  it("does not match an enumeration like '(17)'", () => {
    expect(parseClueRefs("Some answer (17)")).toEqual([]);
  });

  it("does not read a direction word alone as a reference", () => {
    expect(parseClueRefs("ACROSS the wide river")).toEqual([]);
    expect(parseClueRefs("A quiet rundown of the day")).toEqual([]);
    expect(parseClueRefs("Downtown at dusk")).toEqual([]);
  });

  it("does not match a number glued to a direction word with no separator", () => {
    expect(parseClueRefs("12down")).toEqual([]);
  });

  it("returns [] for empty or absent text", () => {
    expect(parseClueRefs("")).toEqual([]);
    expect(parseClueRefs(undefined)).toEqual([]);
  });

  it("returns [] for prose with no reference at all", () => {
    expect(parseClueRefs("Capital of France")).toEqual([]);
  });
});

// The reference puzzle, shared by the grammar cases below and the resolution cases further down:
// revealer 61-Across names the set, four theme entries wear the star, and 1-Down is ordinary.
const REVEALER =
  "Question during a brainstorming session ... or of the answers to the starred clues";
const REF_ACROSS: Clue[] = [
  {
    number: 18,
    direction: "across",
    cells: [0, 1],
    text: "*Yes — three arduous ones",
  },
  {
    number: 29,
    direction: "across",
    cells: [2, 3],
    text: "*Yes — sometimes more than 1,000",
  },
  {
    number: 37,
    direction: "across",
    cells: [4, 5],
    text: "*Yes — exactly one, in common usage",
  },
  {
    number: 50,
    direction: "across",
    cells: [6, 7],
    text: "*No — but it does have three feet",
  },
  { number: 61, direction: "across", cells: [8, 9], text: REVEALER },
];
const REF_DOWN: Clue[] = [
  { number: 1, direction: "down", cells: [0, 2], text: "Capital of France" },
];

// The starred-clue grammar: what the prose means, independent of any puzzle. Resolution against a
// clue list is referencedKeys' job and is pinned there.
describe("the starred-clue convention", () => {
  it("reads the reference puzzle's revealer", () => {
    expect(referencesStarredClues(REVEALER)).toBe(true);
  });

  it("marks the reference puzzle's four theme entries and nothing else", () => {
    expect(REF_ACROSS.filter(isStarredClue).map((c) => c.number)).toEqual([
      18, 29, 37, 50,
    ]);
    expect(REF_DOWN.filter(isStarredClue)).toEqual([]);
  });

  it("does not read 'starred' as a verb: 'Starred in a movie' names nothing", () => {
    expect(referencesStarredClues("Starred in a movie")).toBe(false);
    expect(referencesStarredClues("She starred alongside him")).toBe(false);
  });

  it("takes every noun the convention uses", () => {
    expect(referencesStarredClues("starred answers")).toBe(true);
    expect(referencesStarredClues("asterisked clues")).toBe(true);
    expect(referencesStarredClues("the four starred entries")).toBe(true);
    expect(referencesStarredClues("the starred entry")).toBe(true);
    expect(referencesStarredClues("the starred squares")).toBe(true);
    expect(referencesStarredClues("a starred-clue theme")).toBe(true);
  });

  it('reads the possessive: "the starred clues\' answers"', () => {
    expect(referencesStarredClues("the starred clues' answers")).toBe(true);
  });

  it("is case-insensitive on the revealer phrase", () => {
    expect(referencesStarredClues("... of the STARRED CLUES")).toBe(true);
  });

  // The one-way ruling (D26). A highlight answers "what does the active clue's own text name?",
  // and a starred clue's text names nothing, so a starred clue lights nothing. Reverse linking
  // would need a reverse index and a revealer concept; pinned here so any change is deliberate.
  it("is one-way: a starred clue as the active clue names nothing", () => {
    for (const clue of REF_ACROSS.filter(isStarredClue)) {
      expect(referencesStarredClues(clue.text)).toBe(false);
    }
  });

  // PROTOCOL section 12 law 11: the leading `*` survives ingestion verbatim, and law 1 makes the
  // runs concatenate to `text`. So a star split into its own styled run is still the first
  // character of `text`, and reading `text` alone sees it.
  it("sees the star through styled prose, since law 11 keeps it verbatim in text", () => {
    const styled: Clue = {
      number: 18,
      direction: "across",
      cells: [0],
      text: "*bold star",
      runs: [{ t: "*" }, { t: "bold star", s: ["b"] }],
    };
    expect(isStarredClue(styled)).toBe(true);
  });

  it("tolerates leading whitespace before the star", () => {
    expect(
      isStarredClue({
        number: 1,
        direction: "across",
        cells: [0],
        text: " *Themed",
      }),
    ).toBe(true);
  });

  it("is not starred for a mid-prose asterisk or absent text", () => {
    expect(
      isStarredClue({
        number: 1,
        direction: "across",
        cells: [0],
        text: "Not *this",
      }),
    ).toBe(false);
    expect(
      isStarredClue({ number: 1, direction: "across", cells: [0], text: "" }),
    ).toBe(false);
    expect(isStarredClue({ number: 1, direction: "across", cells: [0] })).toBe(
      false,
    );
  });

  it("returns false for empty or absent revealer text", () => {
    expect(referencesStarredClues("")).toBe(false);
    expect(referencesStarredClues(undefined)).toBe(false);
  });
});

// referencedKeys is the chokepoint: prose plus a clue list in, the key set both the clue rail and
// the board tint read out. Existence filtering and self-exclusion live here, so this is where
// they are pinned. The Swift twin is ClueBook.referencedIds(for:), same guards on the `18A` key
// scheme. Empty for no active clue, and empty for a clue that names nothing that exists.
describe("referencedKeys", () => {
  const activeOn = (number: number): Clue | undefined =>
    REF_ACROSS.find((c) => c.number === number);

  it("resolves the reference puzzle's revealer to exactly the four starred entries", () => {
    expect(referencedKeys(activeOn(61), REF_ACROSS, REF_DOWN)).toEqual(
      new Set(["across-18", "across-29", "across-37", "across-50"]),
    );
  });

  it("is one-way: a starred clue as the active clue resolves to empty", () => {
    expect(referencedKeys(activeOn(18), REF_ACROSS, REF_DOWN)).toEqual(
      new Set(),
    );
  });

  it("resolves a revealer to empty when the puzzle has no starred clues", () => {
    const starless: Clue[] = [
      { number: 61, direction: "across", cells: [8, 9], text: REVEALER },
    ];
    expect(referencedKeys(starless[0], starless, REF_DOWN)).toEqual(new Set());
  });

  // The existence filter. The parser reads intent only, so a ref to a clue this grid lacks is a
  // correct parse and a wrong highlight; this is the guard that drops it.
  it("drops a numeric ref naming a clue the grid lacks", () => {
    const clue: Clue = {
      number: 1,
      direction: "down",
      cells: [0, 2],
      text: "With 99-Across and 18-Across",
    };
    expect(referencedKeys(clue, REF_ACROSS, [clue])).toEqual(
      new Set(["across-18"]),
    );
  });

  // Self-exclusion, the starred case: a revealer that itself wears the star satisfies both
  // predicates, so without the guard it would light itself. It lights its siblings only, exactly
  // as "8-Down, see also 8-Down" on 8-Down lights nothing.
  it("excludes a starred revealer from the set it names, keeping its siblings", () => {
    const selfNaming: Clue = {
      number: 61,
      direction: "across",
      cells: [8, 9],
      text: "*A hint to the starred clues",
    };
    const across = [...REF_ACROSS.slice(0, 4), selfNaming];
    expect(referencedKeys(selfNaming, across, REF_DOWN)).toEqual(
      new Set(["across-18", "across-29", "across-37", "across-50"]),
    );
  });

  it("excludes a numeric self-reference", () => {
    const clue: Clue = {
      number: 18,
      direction: "across",
      cells: [0, 1],
      text: "See 18-Across and 1-Down",
    };
    expect(referencedKeys(clue, [clue], REF_DOWN)).toEqual(new Set(["down-1"]));
  });

  it("unions a numeric ref and a starred ref from one clue into one set", () => {
    const clue: Clue = {
      number: 1,
      direction: "down",
      cells: [0, 2],
      text: "With 61-Across, a hint to the starred answers",
    };
    expect(referencedKeys(clue, REF_ACROSS, [clue])).toEqual(
      new Set([
        "across-61",
        "across-18",
        "across-29",
        "across-37",
        "across-50",
      ]),
    );
  });

  it("resolves plain prose and an absent active clue to empty", () => {
    expect(referencedKeys(REF_DOWN[0], REF_ACROSS, REF_DOWN)).toEqual(
      new Set(),
    );
    expect(referencedKeys(undefined, REF_ACROSS, REF_DOWN)).toEqual(new Set());
  });
});

// referencedCells turns the call site's existence-filtered key set into the cells to paint. The
// keys are already `${direction}-${number}` and already trimmed to entries this puzzle has, so
// the union is the whole job: gather the cells of every clue whose key is in the set.
describe("referencedCells", () => {
  const across: Clue[] = [
    { number: 1, direction: "across", cells: [0, 1, 2] },
    { number: 5, direction: "across", cells: [10, 11] },
  ];
  const down: Clue[] = [
    { number: 1, direction: "down", cells: [0, 3, 6] },
    { number: 2, direction: "down", cells: [1, 4] },
  ];

  it("unions the cells of referenced clues across both axes", () => {
    const keys = new Set(["across-5", "down-1"]);
    expect(referencedCells(keys, across, down)).toEqual(
      new Set([10, 11, 0, 3, 6]),
    );
  });

  it("contributes nothing for a key that names no existing clue", () => {
    const keys = new Set(["across-1", "down-9"]);
    expect(referencedCells(keys, across, down)).toEqual(new Set([0, 1, 2]));
  });

  it("returns an empty set for an empty key set", () => {
    expect(referencedCells(new Set(), across, down)).toEqual(new Set());
  });
});
