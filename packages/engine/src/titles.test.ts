/**
 * Runs the solver-titles reducers against vectors/analysis/titles.json, the golden
 * written before this implementation (CLAUDE.md house rule; design/post-game/TITLES.md;
 * vectors/analysis/README.md). The file is the family's one keyed fixture: two case
 * clusters, `titleStats` and `awardTitles`, each in the house shape, each bound here to
 * its reducer. Every case runs; skipping silently is forbidden, so each cluster's count
 * is asserted too.
 *
 * Assertion rule (vectors/README.md): a `then.solvers` row constrains exactly the fields
 * it lists; an absent field is unasserted; an asserted absence is an explicit null. The
 * award cluster's `then.titles` is the full ordered array, matched exactly.
 *
 * Below the fixture sweep: targeted tests naming the TITLES.md rule or invariant they
 * defend (purity and defensive ordering under INV-9, the universal tie-break chain, the
 * floor-tier coverage theorem, the ladder constant's pinned shape, INV-6, and the
 * brokeStall byte-identity to the shipped moments()).
 *
 * Test files are exempt from INV-9 (.dependency-cruiser.cjs), so node:fs / node:path are
 * allowed here; the reducers themselves import only ./analysis, ./comparator, ./types.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  awardTitles,
  BULLSEYE_MIN_FILLS,
  BURST_WINDOW_MS,
  MARQUEE_MIN_LENGTH,
  MEDDLER_MIN,
  moments,
  OPENING_SHARE,
  SABOTEUR_MIN,
  SPRINTER_MIN_BURST,
  STALL_FLOOR_SECONDS,
  TITLE_LADDER,
  titleStats,
} from "./index";
import type {
  Geometry,
  Solution,
  SolveEvent,
  TitleAward,
  TitleRow,
  TitleSlot,
} from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsRoot = resolve(here, "../../../vectors/analysis");

interface TitleStatsCase {
  readonly name: string;
  readonly given: {
    readonly rows: number;
    readonly cols: number;
    readonly solution: [number, string][];
    readonly slots: TitleSlot[];
    readonly events: SolveEvent[];
  };
  readonly then: {
    readonly solvers: Record<string, Record<string, unknown>>;
    readonly room?: { readonly stallSeconds: number };
  };
}

interface AwardTitlesCase {
  readonly name: string;
  readonly given: {
    readonly solvers: Record<string, TitleRow>;
    readonly room: { readonly stallSeconds: number };
  };
  readonly then: { readonly titles: TitleAward[] };
}

// One keyed fixture, two clusters (the family's documented departure from bare arrays).
const titlesFixture = JSON.parse(
  readFileSync(join(vectorsRoot, "titles.json"), "utf8"),
) as {
  readonly titleStats: TitleStatsCase[];
  readonly awardTitles: AwardTitlesCase[];
};

/** Run one titleStats vector's given through the reducer. */
function runStats(given: TitleStatsCase["given"]) {
  const solution: Solution = new Map(given.solution);
  const geometry: Geometry = { rows: given.rows, cols: given.cols };
  return titleStats(given.events, solution, given.slots, geometry);
}

/** Project an actual row onto the fields an expected row asserts (assertion rule). */
function pick(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): Record<string, unknown> {
  const projection: Record<string, unknown> = {};
  for (const key of Object.keys(expected)) projection[key] = actual[key];
  return projection;
}

describe("titleStats vectors (vectors/analysis/titles.json, titleStats cluster)", () => {
  it("adopts all 15 cases; a miscount means a case was silently skipped", () => {
    expect(titlesFixture.titleStats).toHaveLength(15);
  });

  for (const c of titlesFixture.titleStats) {
    it(c.name, () => {
      const result = runStats(c.given);
      // The pool is event membership: exactly the asserted solvers own rows.
      expect(Object.keys(result.solvers).sort()).toEqual(
        Object.keys(c.then.solvers).sort(),
      );
      for (const [userId, expectedRow] of Object.entries(c.then.solvers)) {
        const actualRow = result.solvers[userId];
        if (actualRow === undefined) throw new Error(`missing row: ${userId}`);
        expect(
          pick(actualRow as unknown as Record<string, unknown>, expectedRow),
        ).toEqual(expectedRow);
      }
      if (c.then.room !== undefined) {
        expect(result.room).toEqual(c.then.room);
      }
    });
  }
});

describe("awardTitles vectors (vectors/analysis/titles.json, awardTitles cluster)", () => {
  it("adopts all 12 cases; a miscount means a case was silently skipped", () => {
    expect(titlesFixture.awardTitles).toHaveLength(12);
  });

  for (const c of titlesFixture.awardTitles) {
    it(c.name, () => {
      // The full award array, exact: ladder order, one title per solver, evidence pinned.
      expect(awardTitles(c.given)).toEqual(c.then.titles);
    });
  }
});

// ---------------------------------------------------------------------------
// Targeted tests beyond the vectors, each naming the rule or invariant it defends.
// ---------------------------------------------------------------------------

/** A zero row that passes no gate; partial overrides shape each scenario. */
function row(partial: Partial<TitleRow> = {}): TitleRow {
  return {
    fills: 0,
    firstFill: null,
    openingFills: 0,
    closingFills: 0,
    writes: 0,
    burst: 0,
    wrongWrites: 0,
    overwrites: 0,
    meddles: 0,
    slotsTouched: 0,
    marqueeLeads: 0,
    spread: 0,
    focus: 0,
    homeQuadrantFills: 0,
    span: 0,
    brokeStall: 0,
    ...partial,
  };
}

const quietRoom = { stallSeconds: 0 };

describe("the ladder constant (TITLES.md v1 ladder, pinned)", () => {
  it("TITLES.md ladder: 15 rungs in the pinned rank order, keys unique lowercase ASCII kebab-case", () => {
    expect(TITLE_LADDER).toHaveLength(15);
    const keys = TITLE_LADDER.map((rung) => rung.key);
    expect(keys).toEqual([
      "saboteur",
      "one-hit-wonder",
      "ice-breaker",
      "bullseye",
      "headliner",
      "sprinter",
      "meddler",
      "quick-starter",
      "closer",
      "specialist",
      "long-hauler",
      "wanderer",
      "scribbler",
      "collector",
      "workhorse",
    ]);
    expect(new Set(keys).size).toBe(15);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("TITLES.md tiers: rungs 1-9 are specialty, 10-15 the floor; every floor gate is fills >= 1 and nothing else", () => {
    expect(TITLE_LADDER.slice(0, 9).map((rung) => rung.tier)).toEqual(
      new Array(9).fill("specialty"),
    );
    const floor = TITLE_LADDER.slice(9);
    expect(floor.map((rung) => rung.tier)).toEqual(new Array(6).fill("floor"));
    // A single fill and nothing else passes every floor gate, whatever the room header;
    // a zero-fill row passes none. That arithmetic is the whole coverage theorem.
    const oneFill = row({ fills: 1 });
    const zeroFill = row();
    for (const rung of floor) {
      expect(rung.gate(oneFill, { stallSeconds: 0, maxFills: 1 })).toBe(true);
      expect(rung.gate(zeroFill, { stallSeconds: 9999, maxFills: 99 })).toBe(
        false,
      );
    }
  });

  it("TITLES.md pinned constants: the named values the vectors cite, never re-derived", () => {
    expect(OPENING_SHARE).toBe(0.2);
    expect(BURST_WINDOW_MS).toBe(30_000);
    expect(STALL_FLOOR_SECONDS).toBe(120);
    expect(SABOTEUR_MIN).toBe(3);
    expect(BULLSEYE_MIN_FILLS).toBe(5);
    expect(SPRINTER_MIN_BURST).toBe(4);
    expect(MEDDLER_MIN).toBe(2);
    expect(MARQUEE_MIN_LENGTH).toBe(7);
  });
});

describe("purity and determinism (INV-9)", () => {
  // The reference solve doubles as the purity fixture: the richest room in the family.
  const reference = titlesFixture.titleStats.find((c) =>
    c.name.startsWith("THE REFERENCE SOLVE"),
  );
  if (reference === undefined) throw new Error("reference solve case missing");

  it("INV-9: titleStats is pure — frozen inputs, two runs, identical output, inputs untouched", () => {
    const events = Object.freeze(
      reference.given.events.map((event) => Object.freeze({ ...event })),
    );
    const slots = Object.freeze(
      reference.given.slots.map((slot) =>
        Object.freeze({
          cells: Object.freeze([...slot.cells]) as unknown as number[],
          starred: slot.starred,
        }),
      ),
    );
    const solution: Solution = new Map(reference.given.solution);
    const geometry: Geometry = { rows: 5, cols: 5 };
    const eventsBefore = structuredClone(reference.given.events);
    const solutionBefore = [...solution.entries()];

    const first = titleStats(events, solution, slots, geometry);
    const second = titleStats(events, solution, slots, geometry);
    expect(first).toEqual(second);
    expect(events).toEqual(eventsBefore);
    expect([...solution.entries()]).toEqual(solutionBefore);
  });

  it("INV-9: titleStats sorts defensively — reversed and interleaved event orders produce the identical sheet, keys included (the solveTrace posture)", () => {
    const baseline = runStats(reference.given);
    const reversed = [...reference.given.events].reverse();
    // A fixed odd/even interleave: deterministic, no RNG anywhere.
    const interleaved = [
      ...reference.given.events.filter((_, i) => i % 2 === 1),
      ...reference.given.events.filter((_, i) => i % 2 === 0),
    ];
    for (const shuffled of [reversed, interleaved]) {
      const result = titleStats(
        shuffled,
        new Map(reference.given.solution),
        reference.given.slots,
        { rows: 5, cols: 5 },
      );
      expect(result).toEqual(baseline);
      // Row key order is deterministic too (first appearance by seq), so downstream
      // walks over Object.entries never depend on the caller's array order.
      expect(Object.keys(result.solvers)).toEqual(
        Object.keys(baseline.solvers),
      );
    }
  });

  it("INV-9/INV-1: awardTitles is repeatable and insensitive to the solvers record's key insertion order (ASCII userId order, never object order)", () => {
    const showcase = titlesFixture.awardTitles.find((c) =>
      c.name.startsWith("the specialty showcase"),
    );
    if (showcase === undefined) throw new Error("showcase case missing");
    const first = awardTitles(showcase.given);
    expect(awardTitles(showcase.given)).toEqual(first);
    const reversedKeys = {
      solvers: Object.fromEntries(
        Object.entries(showcase.given.solvers).reverse(),
      ),
      room: showcase.given.room,
    };
    expect(awardTitles(reversedKeys)).toEqual(first);
  });
});

describe("the universal tie-break chain (TITLES.md determinism, INV-1)", () => {
  /** Award a two-solver room and return the first title's winner. */
  function firstWinner(solvers: Record<string, TitleRow>): TitleAward {
    const awards = awardTitles({ solvers, room: quietRoom });
    const first = awards[0];
    if (first === undefined) throw new Error("no award");
    return first;
  }

  it("TITLES.md tie-break, every link in order: claim value, tie-by-fills, earlier at, lower seq, fill-beats-no-fill, ascending ASCII userId", () => {
    // Link 0, the claim itself: a higher column value wins outright (saboteur).
    expect(
      firstWinner({
        low: row({ overwrites: 3, fills: 1, firstFill: { at: 0, seq: 1 } }),
        high: row({ overwrites: 5 }),
      }),
    ).toEqual({ userId: "high", title: "saboteur", evidence: 5 });

    // Link 1, "tie by fills": equal focus resolves to MORE fills (specialist), even
    // though the universal rule alone would prefer the earlier firstFill.
    expect(
      firstWinner({
        early: row({
          fills: 2,
          focus: 0.5,
          homeQuadrantFills: 1,
          firstFill: { at: 1000, seq: 1 },
        }),
        late: row({
          fills: 4,
          focus: 0.5,
          homeQuadrantFills: 2,
          firstFill: { at: 9000, seq: 9 },
        }),
      }),
    ).toEqual({ userId: "late", title: "specialist", evidence: 2 });

    // Link 2, earlier firstFill.at: focus and fills exhausted, at is primary.
    expect(
      firstWinner({
        zafter: row({
          fills: 2,
          focus: 0.5,
          homeQuadrantFills: 1,
          firstFill: { at: 8000, seq: 1 },
        }),
        before: row({
          fills: 2,
          focus: 0.5,
          homeQuadrantFills: 1,
          firstFill: { at: 2000, seq: 9 },
        }),
      }),
    ).toEqual({ userId: "before", title: "specialist", evidence: 1 });

    // Link 3, lower seq: same at, seq is the secondary key.
    expect(
      firstWinner({
        zlateseq: row({
          fills: 2,
          focus: 0.5,
          homeQuadrantFills: 1,
          firstFill: { at: 5000, seq: 9 },
        }),
        earlyseq: row({
          fills: 2,
          focus: 0.5,
          homeQuadrantFills: 1,
          firstFill: { at: 5000, seq: 4 },
        }),
      }),
    ).toEqual({ userId: "earlyseq", title: "specialist", evidence: 1 });

    // Link 4, a solver with a fill sorts before every zero-fill solver, however late
    // the fill (saboteur, where zero-fill rows are still eligible).
    expect(
      firstWinner({
        afill: row({
          overwrites: 3,
          fills: 1,
          focus: 1,
          homeQuadrantFills: 1,
          firstFill: { at: 900000, seq: 90 },
        }),
        aanone: row({ overwrites: 3 }),
      }),
    ).toEqual({ userId: "afill", title: "saboteur", evidence: 3 });

    // Link 5, the last resort: identical zero-fill rows resolve by ascending ASCII
    // userId ("ua" < "ub"), so even the degenerate room is deterministic.
    expect(
      firstWinner({
        ub: row({ overwrites: 3 }),
        ua: row({ overwrites: 3 }),
      }),
    ).toEqual({ userId: "ua", title: "saboteur", evidence: 3 });
  });
});

describe("the coverage theorem (TITLES.md floor tier)", () => {
  /**
   * A filler whose every specialty gate fails at its boundary: overwrites under
   * SABOTEUR_MIN, a wrongWrite (kills one-hit-wonder and bullseye), no stall break,
   * marquee dark, burst under SPRINTER_MIN_BURST, meddles under MEDDLER_MIN, no
   * opening or closing fills. Stats vary by index so every floor argmax is exercised.
   */
  function filler(index: number): TitleRow {
    return row({
      fills: index + 1,
      firstFill: { at: 1000 * (index + 1), seq: index + 1 },
      writes: 2 * (index + 1),
      burst: Math.min(index + 1, SPRINTER_MIN_BURST - 1),
      wrongWrites: 1,
      overwrites: Math.min(index, SABOTEUR_MIN - 1),
      meddles: Math.min(index, MEDDLER_MIN - 1),
      slotsTouched: index + 1,
      spread: index + 2,
      focus: 1 / (index + 1),
      homeQuadrantFills: 1,
      span: 10 * (index + 1),
    });
  }

  const floorKeys = TITLE_LADDER.slice(9).map((rung) => rung.key);

  it("TITLES.md coverage: hand-built rooms of 2..6 fillers with every specialty gate failing title every filler off the floor (no RNG anywhere)", () => {
    for (let size = 2; size <= 6; size++) {
      const solvers: Record<string, TitleRow> = {};
      for (let i = 0; i < size; i++) solvers[`filler-${i}`] = filler(i);
      const awards = awardTitles({
        solvers,
        room: { stallSeconds: STALL_FLOOR_SECONDS - 1 },
      });
      // Everyone who landed a square gets a superlative: n fillers, n titles, all
      // distinct solvers, all floor keys, in ladder order.
      expect(awards).toHaveLength(size);
      expect(new Set(awards.map((award) => award.userId)).size).toBe(size);
      for (const award of awards) {
        expect(floorKeys).toContain(award.title);
      }
      const ranks = awards.map((award) => floorKeys.indexOf(award.title));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("TITLES.md coverage + determinism: six byte-identical rows (only the userId differs) still resolve to six titles by the ASCII last resort (INV-1)", () => {
    const solvers: Record<string, TitleRow> = {};
    for (const id of ["ua", "ub", "uc", "ud", "ue", "uf"]) {
      solvers[id] = filler(0);
    }
    const awards = awardTitles({ solvers, room: quietRoom });
    expect(awards).toHaveLength(6);
    // Each rung's full tie resolves to the ASCII-least untitled solver, walking down.
    expect(awards.map((award) => award.userId)).toEqual([
      "ua",
      "ub",
      "uc",
      "ud",
      "ue",
      "uf",
    ]);
    expect(awards.map((award) => award.title)).toEqual(floorKeys);
  });

  it("TITLES.md solo rule boundary: an empty sheet and a one-member sheet both award nothing", () => {
    expect(awardTitles({ solvers: {}, room: quietRoom })).toEqual([]);
    expect(
      awardTitles({ solvers: { solo: filler(3) }, room: quietRoom }),
    ).toEqual([]);
  });
});

describe("titleStats corners beyond the vectors", () => {
  it("pinned corner: no events at all is an empty sheet with a zero stall (null turningPoint convention)", () => {
    const result = titleStats([], new Map([[0, "A"]]), [], {
      rows: 1,
      cols: 1,
    });
    expect(result).toEqual({ solvers: {}, room: { stallSeconds: 0 } });
  });

  it("INV-6: the stat sheet carries userIds and numbers only, never a solution value (rebus ground)", () => {
    const solution: Solution = new Map([
      [0, "QZJ"],
      [1, "XK"],
    ]);
    const events: SolveEvent[] = [
      { seq: 1, cell: 0, userId: "u1", value: "Q", at: 1000 },
      { seq: 2, cell: 1, userId: "u2", value: "XK", at: 2000 },
    ];
    const slots: TitleSlot[] = [{ cells: [0, 1], starred: false }];
    const serialized = JSON.stringify(
      titleStats(events, solution, slots, { rows: 1, cols: 2 }),
    );
    expect(serialized).not.toContain("QZJ");
    expect(serialized).not.toContain("XK");
    expect(serialized).not.toContain('"Q"');
  });

  it("TITLES.md brokeStall byte-identity: a tied largest gap keeps moments()'s first-wins break, never the later duplicate", () => {
    const solution: Solution = new Map([
      [0, "A"],
      [1, "A"],
      [2, "A"],
    ]);
    const events: SolveEvent[] = [
      { seq: 1, cell: 0, userId: "u1", value: "A", at: 0 },
      { seq: 2, cell: 1, userId: "u2", value: "A", at: 50_000 },
      { seq: 3, cell: 2, userId: "u3", value: "A", at: 100_000 },
    ];
    const slots: TitleSlot[] = [{ cells: [0, 1, 2], starred: false }];
    const result = titleStats(events, solution, slots, { rows: 1, cols: 3 });
    // moments() keeps the FIRST largest gap (strict >): the break is u2's fill.
    expect(
      moments(
        [...events].map((e) => ({
          cell: e.cell,
          userId: e.userId,
          seq: e.seq,
          at: e.at,
        })),
      ).turningPoint?.stallSeconds,
    ).toBe(50);
    expect(result.room.stallSeconds).toBe(50);
    expect(result.solvers["u2"]?.brokeStall).toBe(1);
    expect(result.solvers["u1"]?.brokeStall).toBe(0);
    expect(result.solvers["u3"]?.brokeStall).toBe(0);
  });

  it("TITLES.md brokeStall byte-identity: a break timestamp shared by two entries resolves by the consecutive pair, not by matching the clock", () => {
    const solution: Solution = new Map([
      [0, "A"],
      [1, "A"],
      [2, "A"],
    ]);
    const events: SolveEvent[] = [
      { seq: 1, cell: 0, userId: "u1", value: "A", at: 0 },
      { seq: 2, cell: 1, userId: "u2", value: "A", at: 100_000 },
      { seq: 3, cell: 2, userId: "u3", value: "A", at: 100_000 },
    ];
    const slots: TitleSlot[] = [{ cells: [0, 1, 2], starred: false }];
    const result = titleStats(events, solution, slots, { rows: 1, cols: 3 });
    // The gap scan's break is seq 2 (the pair 1->2 holds the 100s gap; 2->3 is zero).
    // An implementation matching "any entry at the break's at" could name u3: forbidden.
    expect(result.room.stallSeconds).toBe(100);
    expect(result.solvers["u2"]?.brokeStall).toBe(1);
    expect(result.solvers["u3"]?.brokeStall).toBe(0);
  });

  it("TITLES.md marquee signal 1: a starred slot of ANY length is the marquee set; the length tier never engages beside stars", () => {
    // A starred length-2 slot beside an unstarred length-8: signal 1 has no length
    // gate, so the marquee is exactly the starred slot and the long slot counts for
    // nothing.
    const solution: Solution = new Map(
      Array.from({ length: 10 }, (_, i) => [i, "A"] as [number, string]),
    );
    const events: SolveEvent[] = Array.from({ length: 10 }, (_, i) => ({
      seq: i + 1,
      cell: i,
      userId: i < 8 ? "longleader" : "starleader",
      value: "A",
      at: (i + 1) * 1000,
    }));
    const slots: TitleSlot[] = [
      { cells: [0, 1, 2, 3, 4, 5, 6, 7], starred: false },
      { cells: [8, 9], starred: true },
    ];
    const result = titleStats(events, solution, slots, { rows: 1, cols: 10 });
    expect(result.solvers["starleader"]?.marqueeLeads).toBe(1);
    expect(result.solvers["longleader"]?.marqueeLeads).toBe(0);
  });
});
