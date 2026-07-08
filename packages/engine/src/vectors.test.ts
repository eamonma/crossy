/**
 * Conformance vector runner (PROTOCOL.md §13; conventions in vectors/README.md).
 *
 * The engine is unimplemented until Wave 2.1a, so case execution is gated by a
 * checked skip manifest (../vectors.skip.json): every discovered family must be
 * either bound to an engine entry point or listed in the manifest, and guard tests
 * fail the build if the manifest goes stale (a listed family gains an engine
 * implementation, or loses its vector files). Skipped cases show up as skips in
 * the vitest summary instead of masquerading as passes.
 *
 * `it.fails` was rejected: vitest reports expected failures as passes, which reads
 * as an implemented engine, and it cannot tell "unimplemented" apart from a broken
 * runner or a malformed vector file. Here, discovery and shape validation are hard
 * passes; only execution is skipped, and only under the guarded manifest.
 *
 * Test files are exempt from the INV-9 purity rule (.dependency-cruiser.cjs), so
 * node:fs / node:path are allowed here; packages/engine/src non-test code still
 * imports nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as engine from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsRoot = resolve(here, "../../../vectors/v1");
const manifestPath = resolve(here, "../vectors.skip.json");

const FAMILIES = ["reducer", "comparator", "navigation", "completion"] as const;
type Family = (typeof FAMILIES)[number];

/**
 * Wave 2.1a binds implemented families to engine entry points here, removes them
 * from vectors.skip.json, and implements the per-family assertions.
 */
const bindings: Record<Family, ((vectorCase: JsonObject) => void) | null> = {
  reducer: null,
  comparator: null,
  navigation: null,
  completion: null,
};

type JsonObject = Record<string, unknown>;

function isObject(x: unknown): x is JsonObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

function isInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x);
}

function isIntArray(x: unknown): x is number[] {
  return Array.isArray(x) && x.every(isInt);
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every(isString);
}

/** Sparse map of decimal cell index to {v, by} (vectors/README.md). */
function isCellMap(x: unknown): boolean {
  if (!isObject(x)) return false;
  return Object.entries(x).every(([key, cell]) => {
    if (!/^\d+$/.test(key) || !isObject(cell)) return false;
    return (
      (cell.v === null || isString(cell.v)) &&
      (cell.by === null || isString(cell.by))
    );
  });
}

/** Sparse map of decimal cell index to string (navigation fills). */
function isFillMap(x: unknown): boolean {
  if (!isObject(x)) return false;
  return Object.entries(x).every(
    ([key, value]) => /^\d+$/.test(key) && isString(value),
  );
}

/** Sparse map of decimal cell index to a non-empty solution string. */
function isSolutionMap(x: unknown): boolean {
  if (!isObject(x)) return false;
  return Object.entries(x).every(
    ([key, value]) => /^\d+$/.test(key) && isString(value) && value.length > 0,
  );
}

function reducerShapeProblems(c: JsonObject): string[] {
  const problems: string[] = [];
  if (!isString(c.name)) problems.push("name: string required");
  if (!isObject(c.given)) {
    problems.push("given: object required");
  } else {
    const g = c.given;
    if (!isInt(g.cols)) problems.push("given.cols: integer required");
    if (!isInt(g.rows)) problems.push("given.rows: integer required");
    if (!isIntArray(g.blocks)) problems.push("given.blocks: int[] required");
    if (!isString(g.status)) problems.push("given.status: string required");
    if (!isInt(g.seq)) problems.push("given.seq: integer required");
    if (g.cells !== undefined && !isCellMap(g.cells))
      problems.push("given.cells: sparse map of cell index to {v, by}");
    if (
      g.firstFillAt !== undefined &&
      g.firstFillAt !== null &&
      !isString(g.firstFillAt)
    )
      problems.push("given.firstFillAt: string or null");
  }
  if (
    !Array.isArray(c.when) ||
    c.when.length === 0 ||
    !c.when.every((w) => isObject(w) && isString(w.type))
  ) {
    problems.push("when: non-empty array of commands, each with a string type");
  }
  if (!isObject(c.then)) {
    problems.push("then: object required");
  } else {
    const t = c.then;
    if (
      !Array.isArray(t.events) ||
      !t.events.every((e) => isObject(e) && isString(e.type) && isInt(e.seq))
    )
      problems.push("then.events: array of events, each with type and seq");
    if (!isObject(t.state)) problems.push("then.state: object required");
  }
  return problems;
}

function comparatorShapeProblems(c: JsonObject): string[] {
  const problems: string[] = [];
  if (!isString(c.solution) || c.solution.length === 0)
    problems.push("solution: non-empty string required");
  if (!isStringArray(c.accept)) problems.push("accept: string[] required");
  if (!isStringArray(c.reject)) problems.push("reject: string[] required");
  return problems;
}

function navigationShapeProblems(c: JsonObject): string[] {
  const problems: string[] = [];
  if (!isString(c.name)) problems.push("name: string required");
  if (!isObject(c.given)) {
    problems.push("given: object required");
  } else {
    const g = c.given;
    if (!isInt(g.cols) || g.cols < 0)
      problems.push("given.cols: non-negative integer required");
    if (!isInt(g.rows) || g.rows < 0)
      problems.push("given.rows: non-negative integer required");
    if (!isIntArray(g.blocks)) problems.push("given.blocks: int[] required");
    if (g.fills !== undefined && !isFillMap(g.fills))
      problems.push("given.fills: sparse map of cell index to string");
  }
  if (!isObject(c.when)) {
    problems.push("when: object required");
  } else {
    const w = c.when;
    if (w.direction !== "across" && w.direction !== "down")
      problems.push('when.direction: "across" or "down" required');
    if (!isInt(w.from)) problems.push("when.from: integer required");
    if (w.toward !== "forward" && w.toward !== "backward")
      problems.push('when.toward: "forward" or "backward" required');
    if (w.canEscapeWord !== undefined && typeof w.canEscapeWord !== "boolean")
      problems.push("when.canEscapeWord: boolean when present");
  }
  if (!isObject(c.then) || !isInt(c.then.cell))
    problems.push("then.cell: integer required");
  return problems;
}

/**
 * Completion cases carry the reducer fields plus `given.solution` (the comparator
 * needs it) and may assert a `gameCompleted` event, which the reducer shape never
 * emits. That is why completion is its own family (vectors/README.md).
 */
function completionShapeProblems(c: JsonObject): string[] {
  const problems: string[] = [];
  if (!isString(c.name)) problems.push("name: string required");
  if (!isObject(c.given)) {
    problems.push("given: object required");
  } else {
    const g = c.given;
    if (!isInt(g.cols)) problems.push("given.cols: integer required");
    if (!isInt(g.rows)) problems.push("given.rows: integer required");
    if (!isIntArray(g.blocks)) problems.push("given.blocks: int[] required");
    if (!isString(g.status)) problems.push("given.status: string required");
    if (!isInt(g.seq)) problems.push("given.seq: integer required");
    if (!isSolutionMap(g.solution))
      problems.push(
        "given.solution: sparse map of cell index to non-empty string",
      );
    if (g.cells !== undefined && !isCellMap(g.cells))
      problems.push("given.cells: sparse map of cell index to {v, by}");
    if (
      g.firstFillAt !== undefined &&
      g.firstFillAt !== null &&
      !isString(g.firstFillAt)
    )
      problems.push("given.firstFillAt: string or null");
  }
  if (
    !Array.isArray(c.when) ||
    c.when.length === 0 ||
    !c.when.every((w) => isObject(w) && isString(w.type))
  ) {
    problems.push("when: non-empty array of commands, each with a string type");
  }
  if (!isObject(c.then)) {
    problems.push("then: object required");
  } else {
    const t = c.then;
    if (
      !Array.isArray(t.events) ||
      !t.events.every((e) => isObject(e) && isString(e.type) && isInt(e.seq))
    )
      problems.push("then.events: array of events, each with type and seq");
    if (!isObject(t.state)) problems.push("then.state: object required");
  }
  return problems;
}

const shapeProblems: Record<Family, (c: JsonObject) => string[]> = {
  reducer: reducerShapeProblems,
  comparator: comparatorShapeProblems,
  navigation: navigationShapeProblems,
  completion: completionShapeProblems,
};

interface VectorFile {
  family: Family;
  cluster: string;
  cases: JsonObject[];
}

/**
 * Discovery is strict on purpose: an unknown family, a stray file, or a file that
 * is not a non-empty array of cases fails collection instead of being skipped
 * (vectors/README.md: skipping silently is forbidden).
 */
function discover(): VectorFile[] {
  const files: VectorFile[] = [];
  for (const entry of readdirSync(vectorsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory())
      throw new Error(
        `vectors/v1 must contain only family directories, found "${entry.name}"`,
      );
    const family = entry.name;
    if (!(FAMILIES as readonly string[]).includes(family))
      throw new Error(
        `unrecognized vector family "${family}"; update vectors/README.md and this runner`,
      );
    const familyDir = join(vectorsRoot, family);
    for (const file of readdirSync(familyDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json"))
        throw new Error(
          `vectors/v1/${family} must contain only .json files, found "${file.name}"`,
        );
      const raw: unknown = JSON.parse(
        readFileSync(join(familyDir, file.name), "utf8"),
      );
      if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isObject))
        throw new Error(
          `vectors/v1/${family}/${file.name} must be a non-empty JSON array of case objects`,
        );
      files.push({
        family: family as Family,
        cluster: file.name.replace(/\.json$/, ""),
        cases: raw,
      });
    }
  }
  return files;
}

function loadManifest(): { reason: string; families: Set<Family> } {
  const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isObject(raw) || !isString(raw.reason) || !Array.isArray(raw.families))
    throw new Error(
      "vectors.skip.json must be { reason: string, families: string[] }",
    );
  const families = raw.families.map((f) => {
    if (!isString(f) || !(FAMILIES as readonly string[]).includes(f))
      throw new Error(`vectors.skip.json lists unknown family "${String(f)}"`);
    return f as Family;
  });
  return { reason: raw.reason, families: new Set(families) };
}

function caseLabel(family: Family, c: JsonObject): string {
  if (family === "comparator") return `solution "${String(c.solution)}"`;
  return String(c.name);
}

function runCase(family: Family, c: JsonObject): void {
  const run = bindings[family];
  if (run === null)
    throw new Error(
      `no engine binding for vector family "${family}": packages/engine is unimplemented until Wave 2.1a`,
    );
  run(c);
}

const files = discover();
const skip = loadManifest();
const discoveredFamilies = [...new Set(files.map((f) => f.family))];

describe("vector suite (INV-1: one shared suite drives every port)", () => {
  it("discovers the reducer and navigation families under vectors/v1 (INV-1)", () => {
    expect(discoveredFamilies).toContain("reducer");
    expect(discoveredFamilies).toContain("navigation");
  });

  it("navigation/single-cell-advance encodes all 12 seed cases from PROTOCOL.md §13 (INV-1)", () => {
    const seed = files.find(
      (f) => f.family === "navigation" && f.cluster === "single-cell-advance",
    );
    expect(seed).toBeDefined();
    expect(seed?.cases).toHaveLength(12);
  });

  for (const file of files) {
    it(`${file.family}/${file.cluster}: every case matches the vectors/README.md shape (INV-1)`, () => {
      for (const c of file.cases) {
        expect(
          shapeProblems[file.family](c),
          `${file.family}/${file.cluster}: ${caseLabel(file.family, c)}`,
        ).toEqual([]);
      }
    });
  }
});

describe("skip manifest is checked, not trusted", () => {
  it("every skipped family has vector files on disk", () => {
    for (const family of skip.families) {
      expect(
        discoveredFamilies,
        `vectors.skip.json lists "${family}" but no vectors/v1/${family}/*.json exists; remove the dead entry`,
      ).toContain(family);
    }
  });

  it("every discovered family is bound to the engine or explicitly skipped", () => {
    for (const family of discoveredFamilies) {
      expect(
        bindings[family] !== null || skip.families.has(family),
        `family "${family}" has no engine binding and no vectors.skip.json entry; its cases would fail`,
      ).toBe(true);
    }
  });

  it("skipped families lose their manifest entry once the engine implements them", () => {
    // Coarse by design: the engine index exports nothing until Wave 2.1a. The
    // moment it exports anything, this fails; bind the implemented families,
    // remove them from vectors.skip.json, and replace this guard with per-family
    // checks against the decided engine API.
    if (skip.families.size > 0) {
      expect(
        Object.keys(engine),
        "packages/engine now has exports while vectors.skip.json still skips families; bind them in vectors.test.ts",
      ).toEqual([]);
    }
  });

  it("a vector run against the unimplemented engine fails honestly, never passes", () => {
    const file = files.find((f) => skip.families.has(f.family));
    if (!file) return; // nothing skipped: the guard above already forces bindings
    const first = file.cases[0];
    if (!first) throw new Error("discovery guarantees non-empty case arrays");
    expect(() => runCase(file.family, first)).toThrowError(/no engine binding/);
  });
});

describe("vector execution against packages/engine", () => {
  for (const file of files) {
    describe(`${file.family}/${file.cluster}`, () => {
      const run = skip.families.has(file.family) ? it.skip : it;
      for (const c of file.cases) {
        run(caseLabel(file.family, c), () => {
          runCase(file.family, c);
        });
      }
    });
  }
});
