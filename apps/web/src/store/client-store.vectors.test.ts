/**
 * Client-store conformance runner: the consumer-side executor for the foreign family
 * the engine runner only shape-validates (PROTOCOL.md section 13; vectors/README.md
 * "Foreign families"). Discovery is strict in the same spirit as the engine runner:
 * a stray file, a non-array file, or a case that fails the vectors/README.md shape
 * fails collection instead of being skipped.
 *
 * Every case executes against the real GameStore. Server stimuli are expanded from
 * the vector encoding (sparse cells map, abbreviated frames) into full wire frames
 * and decoded through packages/protocol's codec, so the store consumes exactly what
 * a socket would deliver and hand-rolled parsing cannot creep in.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeServerMessage } from "@crossy/protocol";
import type { Cell, ClientMessage } from "@crossy/protocol";
import { GameStore } from "./gameStore";
import type { PendingCommand, SyncState } from "./gameStore";

const here = dirname(fileURLToPath(import.meta.url));
const familyDir = resolve(here, "../../../../vectors/v1/client-store");

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

const SYNC_STATES = ["live", "resyncing", "reconnecting"] as const;

function isSyncState(x: unknown): x is SyncState {
  return isString(x) && (SYNC_STATES as readonly string[]).includes(x);
}

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

function isOverlayEntry(x: unknown): boolean {
  return (
    isObject(x) &&
    isString(x.commandId) &&
    isInt(x.cell) &&
    (x.value === null || isString(x.value))
  );
}

/** The vectors/README.md client-store case shape; mirrors the engine runner's check. */
function shapeProblems(c: JsonObject): string[] {
  const problems: string[] = [];
  if (!isString(c.name)) problems.push("name: string required");
  if (!isObject(c.given)) {
    problems.push("given: object required");
  } else {
    const g = c.given;
    if (!isInt(g.seq)) problems.push("given.seq: integer required");
    if (!isSyncState(g.sync)) {
      problems.push(
        'given.sync: "live" | "resyncing" | "reconnecting" required',
      );
    }
    if (!isInt(g.cols)) problems.push("given.cols: integer required");
    if (!isInt(g.rows)) problems.push("given.rows: integer required");
    if (!Array.isArray(g.blocks) || !(g.blocks as unknown[]).every(isInt)) {
      problems.push("given.blocks: int[] required");
    }
    if (g.cells !== undefined && !isCellMap(g.cells)) {
      problems.push("given.cells: sparse map of cell index to {v, by}");
    }
    if (
      !Array.isArray(g.overlay) ||
      !(g.overlay as unknown[]).every(
        (e) =>
          isOverlayEntry(e) &&
          ((e as JsonObject).agedOut === undefined ||
            typeof (e as JsonObject).agedOut === "boolean"),
      )
    ) {
      problems.push(
        "given.overlay: array of {commandId, cell, value, agedOut?}",
      );
    }
  }
  if (
    !Array.isArray(c.when) ||
    c.when.length === 0 ||
    !(c.when as unknown[]).every(
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
    if (!isSyncState(t.sync)) {
      problems.push(
        'then.sync: "live" | "resyncing" | "reconnecting" required',
      );
    }
    if (
      !Array.isArray(t.overlay) ||
      !(t.overlay as unknown[]).every(isOverlayEntry)
    ) {
      problems.push("then.overlay: array of {commandId, cell, value}");
    }
    if (!isObject(t.render)) problems.push("then.render: object required");
    if (
      !Array.isArray(t.send) ||
      !(t.send as unknown[]).every((f) => isObject(f) && isString(f.type))
    ) {
      problems.push("then.send: array of frames, each with a string type");
    }
    // then.firstFillAt is the store's derived timer origin (PROTOCOL.md §6), asserted
    // only where a case lists it; string or null when present.
    if (
      t.firstFillAt !== undefined &&
      t.firstFillAt !== null &&
      !isString(t.firstFillAt)
    ) {
      problems.push("then.firstFillAt: string or null when present");
    }
  }
  return problems;
}

interface VectorFile {
  cluster: string;
  cases: JsonObject[];
}

/** Strict discovery: only .json files, each a non-empty array of shape-valid cases. */
function discover(): VectorFile[] {
  const files: VectorFile[] = [];
  for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new Error(
        `vectors/v1/client-store must contain only .json files, found "${entry.name}"`,
      );
    }
    const raw: unknown = JSON.parse(
      readFileSync(join(familyDir, entry.name), "utf8"),
    );
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isObject)) {
      throw new Error(
        `vectors/v1/client-store/${entry.name} must be a non-empty JSON array of case objects`,
      );
    }
    const cluster = entry.name.replace(/\.json$/, "");
    for (const c of raw) {
      const problems = shapeProblems(c);
      if (problems.length > 0) {
        throw new Error(
          `vectors/v1/client-store/${entry.name}: "${String(c.name)}" fails the vectors/README.md shape: ${problems.join("; ")}`,
        );
      }
    }
    files.push({ cluster, cases: raw });
  }
  return files;
}

// --- Adapters: vector encoding to wire frames and store state ---

function buildCells(given: JsonObject): Map<number, Cell> {
  const cells = new Map<number, Cell>();
  const sparse = given.cells as
    Record<string, { v: string | null; by: string | null }> | undefined;
  if (sparse !== undefined) {
    for (const [index, cell] of Object.entries(sparse)) {
      cells.set(Number(index), { v: cell.v, by: cell.by });
    }
  }
  return cells;
}

function buildOverlay(given: JsonObject): PendingCommand[] {
  return (given.overlay as JsonObject[]).map((entry) => {
    const base = {
      commandId: entry.commandId as string,
      cell: entry.cell as number,
      value: entry.value as string | null,
    };
    return entry.agedOut === undefined
      ? base
      : { ...base, agedOut: entry.agedOut as boolean };
  });
}

/**
 * Expand the vector's abbreviated board (sparse cells map, only seq / status /
 * cells / recentCommandIds) into the full PROTOCOL.md section 4 payload the codec
 * requires. The geometry comes from the case's `given`.
 */
function expandBoard(
  board: JsonObject,
  cols: number,
  rows: number,
): JsonObject {
  const sparse = (board.cells ?? {}) as Record<
    string,
    { v: string | null; by: string | null }
  >;
  const cells = Array.from({ length: cols * rows }, (_, index) => {
    const cell = sparse[String(index)];
    return cell === undefined ? { v: null, by: null } : cell;
  });
  return {
    seq: board.seq,
    status: board.status,
    // A snapshot may pin firstFillAt (PROTOCOL.md §4); absent means null, the pre-first-fill state.
    firstFillAt: board.firstFillAt ?? null,
    completedAt: null,
    abandonedAt: null,
    cells,
    // The room-check facts ride every §4 board; the client-store vectors predate them and
    // assert nothing about check state, so the no-checks defaults complete the wire shape.
    checkedWrongCells: board.checkedWrongCells ?? [],
    checkCount: board.checkCount ?? 0,
    participants: [],
    cursors: [],
    recentCommandIds: board.recentCommandIds ?? [],
    stats: null,
  };
}

/** Expand one `source: "server"` step into the full wire frame the codec accepts. */
function expandServerFrame(
  step: JsonObject,
  cols: number,
  rows: number,
): JsonObject {
  switch (step.type) {
    case "cellSet":
      return {
        type: "cellSet",
        seq: step.seq,
        cell: step.cell,
        value: step.value,
        by: step.by,
        commandId: step.commandId,
        // The vector encoding omits `at` (unasserted); the wire requires it.
        at: "2026-07-07T00:00:00Z",
        // firstFillAt rides only the first fill (PROTOCOL.md §6); pass it through when present.
        ...(step.firstFillAt !== undefined
          ? { firstFillAt: step.firstFillAt }
          : {}),
      };
    case "error":
      return {
        type: "error",
        code: step.code,
        // The vector encoding omits the human-readable message; the wire requires it.
        message: String(step.code),
        fatal: step.fatal,
        ...(step.commandId !== undefined ? { commandId: step.commandId } : {}),
      };
    case "sync":
      return {
        type: "sync",
        board: expandBoard(step.board as JsonObject, cols, rows),
      };
    case "welcome":
      return {
        type: "welcome",
        protocolVersion: 1,
        self: { userId: "vector-self", role: "solver" },
        board: expandBoard(step.board as JsonObject, cols, rows),
      };
    default:
      throw new Error(
        `unhandled server stimulus type "${String(step.type)}"; widen the runner`,
      );
  }
}

/** vectors/README.md assertion rule: expected constrains exactly the fields it lists. */
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
  for (const [key, value] of Object.entries(expected as JsonObject)) {
    expectMatch(obj[key], value, `${path}.${key}`);
  }
}

function runCase(c: JsonObject): void {
  const given = c.given as JsonObject;
  const cols = given.cols as number;
  const rows = given.rows as number;

  const sent: ClientMessage[] = [];
  const store = new GameStore({
    transport: { send: (message) => sent.push(message) },
    initial: {
      seq: given.seq as number,
      sync: given.sync as SyncState,
      cells: buildCells(given),
      overlay: buildOverlay(given),
    },
  });

  for (const step of c.when as JsonObject[]) {
    if (step.source === "local") {
      if (step.type === "placeLetter") {
        store.placeLetter(
          step.cell as number,
          step.value as string,
          step.commandId as string,
        );
      } else if (step.type === "clearCell") {
        store.clearCell(step.cell as number, step.commandId as string);
      } else {
        throw new Error(`unhandled local stimulus type "${String(step.type)}"`);
      }
      continue;
    }
    // Round-trip through JSON so the codec sees exactly what a text frame carries.
    const raw: unknown = JSON.parse(
      JSON.stringify(expandServerFrame(step, cols, rows)),
    );
    const decoded = decodeServerMessage(raw);
    if (!decoded.ok) {
      throw new Error(
        `stimulus did not decode through packages/protocol: ${decoded.error.detail}`,
      );
    }
    store.receive(decoded.value);
  }

  const then = c.then as JsonObject;
  expect(store.seq, "then.seq").toBe(then.seq);
  expect(store.sync, "then.sync").toBe(then.sync);
  expectMatch(store.overlay, then.overlay, "then.overlay");
  for (const [key, value] of Object.entries(then.render as JsonObject)) {
    expect(store.renderValue(Number(key)), `then.render.${key}`).toBe(value);
  }
  expectMatch(sent, then.send, "then.send");
  // The store's derived timer origin, asserted only where a case pins it (PROTOCOL.md §6).
  if ("firstFillAt" in then) {
    expect(store.firstFillAt, "then.firstFillAt").toBe(then.firstFillAt);
  }
}

const files = discover();

describe("client-store vectors execute against the real store (INV-10; sync states live/resyncing/reconnecting)", () => {
  it("discovers all 20 cases (14 Wave 1.1e + 6 first-fill-at); a vector addition updates this count deliberately", () => {
    const total = files.reduce((n, f) => n + f.cases.length, 0);
    expect(total).toBe(20);
  });

  for (const file of files) {
    describe(`client-store/${file.cluster}`, () => {
      for (const c of file.cases) {
        it(String(c.name), () => {
          runCase(c);
        });
      }
    });
  }
});
