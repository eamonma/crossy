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
 * Two skip reasons live in the manifest, kept apart on purpose. `families` are
 * skipped-until-engine: bound to packages/engine at Wave 2.1a, then removed from the
 * manifest. `foreign.families` have a consumer that is never packages/engine (the
 * client-store family runs in apps/web and the iOS store; PROTOCOL.md §13,
 * vectors/README.md), so this runner discovers and shape-validates them but never
 * executes them, and they never leave the manifest. Separating the two means the
 * Wave 2.1a rebind (which drains `families` and replaces the coarse export guard with
 * per-family checks) never has to reason about the foreign set.
 *
 * Test files are exempt from the INV-9 purity rule (.dependency-cruiser.cjs), so
 * node:fs / node:path are allowed here; packages/engine/src non-test code still
 * imports nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  backspaceTarget,
  getNextCell,
  matches,
  reduce,
  tabTarget,
  typingAdvance,
  wordBounds,
} from "./index";
import type {
  BoardState,
  Cell,
  Command,
  Direction,
  Grid,
  Toward,
} from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsRoot = resolve(here, "../../../vectors/v1");
const manifestPath = resolve(here, "../vectors.skip.json");

const FAMILIES = [
  "reducer",
  "comparator",
  "navigation",
  "completion",
  "client-store",
] as const;
type Family = (typeof FAMILIES)[number];

/**
 * Wave 2.1a binds implemented families to engine entry points here, removes them
 * from vectors.skip.json, and implements the per-family assertions. A foreign family
 * (vectors.skip.json `foreign`, e.g. client-store) stays `null` forever: its consumer
 * is a client store, not packages/engine, so it is shape-validated here and executed
 * elsewhere.
 */
const bindings: Record<Family, ((vectorCase: JsonObject) => void) | null> = {
  reducer: runReducer,
  comparator: runComparator,
  navigation: runNavigation,
  completion: null,
  "client-store": null,
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

/** The store sync states (client-store family; vectors/README.md). */
const SYNC_STATES = ["live", "resyncing", "reconnecting"] as const;

/** An overlay entry: {commandId, cell, value}; extra fields ignored. */
function isOverlayEntry(x: unknown): boolean {
  return (
    isObject(x) &&
    isString(x.commandId) &&
    isInt(x.cell) &&
    (x.value === null || isString(x.value))
  );
}

/** given.overlay entries may carry an optional boolean `agedOut`. */
function isGivenOverlay(x: unknown): boolean {
  return (
    Array.isArray(x) &&
    x.every(
      (e) =>
        isOverlayEntry(e) &&
        ((e as JsonObject).agedOut === undefined ||
          typeof (e as JsonObject).agedOut === "boolean"),
    )
  );
}

/** Sparse map of decimal cell index to a rendered value (string or null). */
function isRenderMap(x: unknown): boolean {
  if (!isObject(x)) return false;
  return Object.entries(x).every(
    ([key, value]) => /^\d+$/.test(key) && (value === null || isString(value)),
  );
}

/** then.send is an ordered list of outbound frames, each with a string type. */
function isSendList(x: unknown): boolean {
  return Array.isArray(x) && x.every((f) => isObject(f) && isString(f.type));
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

/**
 * The navigation operations (vectors/README.md `when.op`). Absent `op` means
 * `advance`, the seed's single-cell getNextCell, so the 12 seed cases stay
 * byte-identical. Each op fixes its own `when` inputs and `then` outputs.
 */
const NAV_OPS = [
  "advance",
  "wordBounds",
  "tab",
  "typing",
  "backspace",
] as const;

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
    return problems;
  }
  const w = c.when;
  const op = w.op === undefined ? "advance" : w.op;
  if (!isString(op) || !(NAV_OPS as readonly string[]).includes(op))
    problems.push(
      `when.op: one of ${NAV_OPS.join(", ")} (absent means advance)`,
    );
  // Every op names a direction and a starting cell.
  if (w.direction !== "across" && w.direction !== "down")
    problems.push('when.direction: "across" or "down" required');
  if (!isInt(w.from)) problems.push("when.from: integer required");
  if (!isObject(c.then)) {
    problems.push("then: object required");
    return problems;
  }
  const t = c.then;
  // Op-specific `when` inputs and `then` outputs (vectors/README.md table).
  switch (op) {
    case "advance":
      if (w.toward !== "forward" && w.toward !== "backward")
        problems.push('when.toward: "forward" or "backward" required');
      if (w.canEscapeWord !== undefined && typeof w.canEscapeWord !== "boolean")
        problems.push("when.canEscapeWord: boolean when present");
      if (!isInt(t.cell)) problems.push("then.cell: integer required");
      break;
    case "tab":
      if (w.toward !== "forward" && w.toward !== "backward")
        problems.push('when.toward: "forward" or "backward" required');
      if (!isInt(t.cell)) problems.push("then.cell: integer required");
      // tab pins the unchanged axis on a clue-list wrap (vectors/README.md).
      if (t.direction !== "across" && t.direction !== "down")
        problems.push('then.direction: "across" or "down" required');
      break;
    case "wordBounds":
      if (!isInt(t.start)) problems.push("then.start: integer required");
      if (!isInt(t.end)) problems.push("then.end: integer required");
      break;
    case "typing":
    case "backspace":
      if (!isInt(t.cell)) problems.push("then.cell: integer required");
      break;
  }
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

/**
 * Client-store cases carry a store state (sequenced `seq` + `sync` + sparse `cells`
 * plus an `overlay`), a `when` sequence of local commands and server messages, and
 * the resulting `overlay`, `render`, `send`, `seq`, and `sync`. The encoding is
 * defined and normative in vectors/README.md. This family is foreign to the engine
 * (see the manifest `foreign` set); the runner shape-validates it but never executes
 * it here.
 */
function clientStoreShapeProblems(c: JsonObject): string[] {
  const problems: string[] = [];
  if (!isString(c.name)) problems.push("name: string required");
  if (!isObject(c.given)) {
    problems.push("given: object required");
  } else {
    const g = c.given;
    if (!isInt(g.seq)) problems.push("given.seq: integer required");
    if (
      !isString(g.sync) ||
      !(SYNC_STATES as readonly string[]).includes(g.sync)
    )
      problems.push(
        'given.sync: "live" | "resyncing" | "reconnecting" required',
      );
    if (!isInt(g.cols)) problems.push("given.cols: integer required");
    if (!isInt(g.rows)) problems.push("given.rows: integer required");
    if (!isIntArray(g.blocks)) problems.push("given.blocks: int[] required");
    if (g.cells !== undefined && !isCellMap(g.cells))
      problems.push("given.cells: sparse map of cell index to {v, by}");
    if (!isGivenOverlay(g.overlay))
      problems.push(
        "given.overlay: array of {commandId, cell, value, agedOut?}",
      );
  }
  if (
    !Array.isArray(c.when) ||
    c.when.length === 0 ||
    !c.when.every(
      (w) =>
        isObject(w) &&
        (w.source === "local" || w.source === "server") &&
        isString(w.type),
    )
  ) {
    problems.push(
      'when: non-empty array of steps, each { source: "local" | "server", type, ... }',
    );
  }
  if (!isObject(c.then)) {
    problems.push("then: object required");
  } else {
    const t = c.then;
    if (!isInt(t.seq)) problems.push("then.seq: integer required");
    if (
      !isString(t.sync) ||
      !(SYNC_STATES as readonly string[]).includes(t.sync)
    )
      problems.push(
        'then.sync: "live" | "resyncing" | "reconnecting" required',
      );
    if (!Array.isArray(t.overlay) || !t.overlay.every(isOverlayEntry))
      problems.push("then.overlay: array of {commandId, cell, value}");
    if (!isRenderMap(t.render))
      problems.push("then.render: sparse map of cell index to string or null");
    if (!isSendList(t.send))
      problems.push(
        "then.send: array of outbound frames, each with a string type",
      );
  }
  return problems;
}

const shapeProblems: Record<Family, (c: JsonObject) => string[]> = {
  reducer: reducerShapeProblems,
  comparator: comparatorShapeProblems,
  navigation: navigationShapeProblems,
  completion: completionShapeProblems,
  "client-store": clientStoreShapeProblems,
};

// --- Engine binding: adapters between the vector JSON and the engine's own types ---
//
// The vectors are the shared source of truth; the engine owns a separate type world
// (INV-9, README.md). These adapters are the boundary that keeps them in agreement,
// exactly as an app adapter would: parse `given` into engine types, call the engine,
// serialize the result back to plain JSON, and assert it against `then`.

/** Build the immutable grid geometry from a case's `given`. */
function buildGrid(given: JsonObject): Grid {
  return {
    cols: given.cols as number,
    rows: given.rows as number,
    blocks: new Set(given.blocks as number[]),
  };
}

/** Build the reducer's starting board state; filledCount is derived from the fills. */
function buildBoardState(given: JsonObject): BoardState {
  const cells = new Map<number, Cell>();
  let filledCount = 0;
  const givenCells = given.cells as
    Record<string, { v: string | null; by: string | null }> | undefined;
  if (givenCells !== undefined) {
    for (const [index, cell] of Object.entries(givenCells)) {
      cells.set(Number(index), { v: cell.v, by: cell.by });
      if (cell.v !== null) filledCount += 1;
    }
  }
  return {
    grid: buildGrid(given),
    status: given.status as BoardState["status"],
    seq: given.seq as number,
    firstFillAt:
      given.firstFillAt === undefined
        ? null
        : (given.firstFillAt as string | null),
    cells,
    filledCount,
  };
}

/** A `when` entry (wire command plus server meta) is the engine command as plain data. */
function asCommand(w: JsonObject): Command {
  if (w.type === "placeLetter")
    return {
      type: "placeLetter",
      commandId: w.commandId as string,
      cell: w.cell as number,
      value: w.value as string,
      by: w.by as string,
      at: w.at as string,
    };
  return {
    type: "clearCell",
    commandId: w.commandId as string,
    cell: w.cell as number,
    by: w.by as string,
    at: w.at as string,
  };
}

/** Serialize a board state to the `then.state` JSON shape (cells as a sparse map). */
function serializeState(state: BoardState): JsonObject {
  const cells: JsonObject = {};
  for (const [index, cell] of state.cells)
    cells[String(index)] = { v: cell.v, by: cell.by };
  return {
    status: state.status,
    seq: state.seq,
    filledCount: state.filledCount,
    firstFillAt: state.firstFillAt,
    cells,
  };
}

/**
 * The assertion rule (vectors/README.md): an expected object constrains exactly the
 * fields it lists; an absent field is unasserted. Arrays match in length and order,
 * each element under the same rule.
 */
function expectMatch(actual: unknown, expected: unknown, path: string): void {
  if (expected === null || typeof expected !== "object") {
    expect(actual, path).toBe(expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: expected an array`).toBe(true);
    const arr = actual as unknown[];
    expect(arr.length, `${path}: array length`).toBe(expected.length);
    expected.forEach((element, i) =>
      expectMatch(arr[i], element, `${path}[${i}]`),
    );
    return;
  }
  expect(isObject(actual), `${path}: expected an object`).toBe(true);
  const obj = actual as JsonObject;
  for (const [key, value] of Object.entries(expected as JsonObject))
    expectMatch(obj[key], value, `${path}.${key}`);
}

/**
 * Reducer runner: apply each command in `when` in mailbox order, threading state and
 * accumulating events (INV-2). A rejection carries the PROTOCOL §11 code; the sequence
 * has at most one, since every rejection case is a single command (vectors/README.md).
 */
function runReducer(c: JsonObject): void {
  let state = buildBoardState(c.given as JsonObject);
  const events: unknown[] = [];
  let error: string | undefined;
  for (const w of c.when as JsonObject[]) {
    const result = reduce(state, asCommand(w));
    state = result.state;
    for (const e of result.events) events.push(e);
    if (result.error !== undefined) error = result.error;
  }
  const then = c.then as JsonObject;
  expectMatch(events, then.events, "then.events");
  expectMatch(serializeState(state), then.state, "then.state");
  if ("error" in then) expect(error, "then.error").toBe(then.error);
}

/** The set of filled cell indices from a navigation case's `given.fills`. */
function buildFilled(given: JsonObject): Set<number> {
  const fills = given.fills as Record<string, string> | undefined;
  if (fills === undefined) return new Set();
  return new Set(Object.keys(fills).map(Number));
}

/**
 * Navigation runner: dispatch on `when.op` (absent means `advance`, the seed's
 * single-cell getNextCell). Each op fixes its own `when` inputs and `then` outputs
 * (vectors/README.md). `then.direction` is asserted only for `tab`, the one op that
 * can change axis.
 */
function runNavigation(c: JsonObject): void {
  const grid = buildGrid(c.given as JsonObject);
  const w = c.when as JsonObject;
  const then = c.then as JsonObject;
  const op = (w.op as string | undefined) ?? "advance";
  const direction = w.direction as Direction;
  const from = w.from as number;

  switch (op) {
    case "advance": {
      const cell = getNextCell(
        grid,
        direction,
        from,
        w.toward as Toward,
        w.canEscapeWord as boolean | undefined,
      );
      expect(cell, "then.cell").toBe(then.cell);
      break;
    }
    case "wordBounds": {
      const bounds = wordBounds(grid, direction, from);
      expect(bounds.start, "then.start").toBe(then.start);
      expect(bounds.end, "then.end").toBe(then.end);
      break;
    }
    case "tab": {
      const result = tabTarget(
        grid,
        direction,
        from,
        w.toward as Toward,
        buildFilled(c.given as JsonObject),
      );
      expect(result.cell, "then.cell").toBe(then.cell);
      expect(result.direction, "then.direction").toBe(then.direction);
      break;
    }
    case "typing": {
      const cell = typingAdvance(
        grid,
        direction,
        from,
        buildFilled(c.given as JsonObject),
      );
      expect(cell, "then.cell").toBe(then.cell);
      break;
    }
    case "backspace": {
      const cell = backspaceTarget(
        grid,
        direction,
        from,
        buildFilled(c.given as JsonObject),
      );
      expect(cell, "then.cell").toBe(then.cell);
      break;
    }
    default:
      throw new Error(`unknown navigation op "${op}"`);
  }
}

/**
 * Comparator runner: every value in `accept` must pass and every value in `reject` must
 * fail for the case's `solution`. Casing is ASCII-only (INV-1); the Turkish dotted and
 * dotless i in the suite prove a locale-aware port cannot slip through.
 */
function runComparator(c: JsonObject): void {
  const solution = c.solution as string;
  for (const value of c.accept as string[])
    expect(matches(solution, value), `accept "${value}"`).toBe(true);
  for (const value of c.reject as string[])
    expect(matches(solution, value), `reject "${value}"`).toBe(false);
}

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

interface Manifest {
  reason: string;
  families: Set<Family>;
  foreign: { reason: string; families: Set<Family> };
}

function parseFamilyList(raw: unknown, where: string): Family[] {
  if (!Array.isArray(raw))
    throw new Error(`vectors.skip.json ${where} must be a string[]`);
  return raw.map((f) => {
    if (!isString(f) || !(FAMILIES as readonly string[]).includes(f))
      throw new Error(`vectors.skip.json lists unknown family "${String(f)}"`);
    return f as Family;
  });
}

function loadManifest(): Manifest {
  const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isObject(raw) || !isString(raw.reason))
    throw new Error(
      "vectors.skip.json must be { reason, families, foreign: { reason, families } }",
    );
  const families = parseFamilyList(raw.families, "families");
  // `foreign` is optional; absent means no foreign families.
  let foreignReason = "";
  let foreignFamilies: Family[] = [];
  if (raw.foreign !== undefined) {
    if (!isObject(raw.foreign) || !isString(raw.foreign.reason))
      throw new Error(
        "vectors.skip.json `foreign` must be { reason: string, families: string[] }",
      );
    foreignReason = raw.foreign.reason;
    foreignFamilies = parseFamilyList(raw.foreign.families, "foreign.families");
  }
  const overlap = foreignFamilies.filter((f) => families.includes(f));
  if (overlap.length > 0)
    throw new Error(
      `vectors.skip.json family "${overlap[0]}" is both skipped-until-engine and foreign; a family is one or the other`,
    );
  return {
    reason: raw.reason,
    families: new Set(families),
    foreign: { reason: foreignReason, families: new Set(foreignFamilies) },
  };
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

  it("discovers the client-store family and treats it as foreign, not engine-bound (INV-10)", () => {
    expect(discoveredFamilies).toContain("client-store");
    expect(skip.foreign.families.has("client-store")).toBe(true);
    // Foreign: never a skipped-until-engine family, never an engine binding. This is
    // the distinction the Wave 2.1a rebind relies on (PROTOCOL.md §13).
    expect(skip.families.has("client-store")).toBe(false);
    expect(bindings["client-store"]).toBe(null);
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
  it("every skipped or foreign family has vector files on disk", () => {
    for (const family of [...skip.families, ...skip.foreign.families]) {
      expect(
        discoveredFamilies,
        `vectors.skip.json lists "${family}" but no vectors/v1/${family}/*.json exists; remove the dead entry`,
      ).toContain(family);
    }
  });

  it("every discovered family is bound to the engine, skipped until it binds, or foreign", () => {
    for (const family of discoveredFamilies) {
      expect(
        bindings[family] !== null ||
          skip.families.has(family) ||
          skip.foreign.families.has(family),
        `family "${family}" has no engine binding and no vectors.skip.json entry; its cases would fail`,
      ).toBe(true);
    }
  });

  it("a foreign family is never bound to the engine (its consumer is a client store)", () => {
    // Foreign families execute in apps/web + iOS, never here. This holds through the
    // Wave 2.1a rebind: that wave binds `families`, never `foreign.families`.
    for (const family of skip.foreign.families) {
      expect(
        bindings[family],
        `family "${family}" is foreign but has an engine binding; foreign families run in their own consumer's suite, not packages/engine`,
      ).toBe(null);
    }
  });

  it("each engine family is bound iff it is drained from the skip manifest (per-family rebind)", () => {
    // Replaces Wave 1.1's coarse "engine has exports while families are skipped"
    // guard, per its own instruction. That guard fired the moment packages/engine
    // exported anything; Wave 2.1a binds each family to an engine entry point and
    // drains it from vectors.skip.json. The invariant now is per family: a family the
    // engine implements is bound here and absent from the manifest; a family still
    // awaiting the engine is unbound and listed. Never both, never neither. This holds
    // at every intermediate commit as the families drain one at a time.
    for (const family of discoveredFamilies) {
      if (skip.foreign.families.has(family)) continue; // foreign: its own guards below
      const bound = bindings[family] !== null;
      const skipped = skip.families.has(family);
      expect(
        bound !== skipped,
        `family "${family}" must be bound-and-drained or unbound-and-skipped, not bound=${bound} skipped=${skipped}`,
      ).toBe(true);
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
    if (skip.foreign.families.has(file.family)) continue; // executed elsewhere; see below
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

// Foreign families are shape-validated above but never executed here: their consumer
// is a client store (apps/web, then iOS), not packages/engine (PROTOCOL.md §13,
// vectors/README.md). Listing them as explicit skips keeps them visible in the vitest
// summary instead of silently absent.
describe("foreign vector families (executed by their consumer's suite, shape-only here)", () => {
  for (const file of files) {
    if (!skip.foreign.families.has(file.family)) continue;
    describe(`${file.family}/${file.cluster} [foreign: apps/web + iOS store]`, () => {
      for (const c of file.cases) {
        it.skip(caseLabel(file.family, c), () => {
          runCase(file.family, c);
        });
      }
    });
  }
});
