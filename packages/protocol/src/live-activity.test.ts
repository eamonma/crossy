// Vector conformance for the Live Activity content-state payload (PROTOCOL.md "Live Activity
// push"; fixtures in vectors/live-activity/). This is the TypeScript-side pin, the same role
// the engine's vector runner plays for the reducer: every fixture must parse against the shared
// `LiveActivityContentState` type, and the load-bearing invariants (INV-6 counts-only, INV-1
// initial casing) are asserted directly on the parsed cases. The Swift widget's Codable decodes
// the same JSON in a later slice; these fixtures are the contract both sides meet.
//
// Test files are exempt from INV-9 purity, so node:fs / node:path are allowed here.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asciiUppercase } from "./values";
import type {
  LiveActivityContentState,
  LiveActivityStatus,
} from "./live-activity";
import { LIVE_ACTIVITY_MAX_PUCKS } from "./live-activity";

const here = dirname(fileURLToPath(import.meta.url));
const familyDir = resolve(here, "../../../vectors/live-activity");

type JsonObject = Record<string, unknown>;

function isObject(x: unknown): x is JsonObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isString(x: unknown): x is string {
  return typeof x === "string";
}

/** A 0-255 integer sRGB component. */
function isByte(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 255;
}

function isNonNegInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

const STATUSES: readonly LiveActivityStatus[] = [
  "ongoing",
  "completed",
  "abandoned",
];

interface VectorCase {
  readonly name: string;
  readonly contentState: LiveActivityContentState;
}

/**
 * Parse one fixture object into a typed case, throwing a located error on any shape violation.
 * This is the parse the emitter and the Swift decoder must both satisfy: if a fixture stops
 * parsing here, it stops decoding there.
 */
function parseCase(raw: unknown, where: string): VectorCase {
  if (!isObject(raw)) throw new Error(`${where}: case must be an object`);
  if (!isString(raw.name)) throw new Error(`${where}: name must be a string`);
  const cs = raw.contentState;
  if (!isObject(cs))
    throw new Error(`${where}: contentState must be an object`);

  if (!Array.isArray(cs.pucks))
    throw new Error(`${where}: contentState.pucks must be an array`);
  const pucks = cs.pucks.map((p, i) => {
    const at = `${where}.pucks[${i}]`;
    if (!isObject(p)) throw new Error(`${at}: puck must be an object`);
    if (!isString(p.initial))
      throw new Error(`${at}: initial must be a string`);
    if (!isByte(p.red)) throw new Error(`${at}: red must be a 0-255 integer`);
    if (!isByte(p.green))
      throw new Error(`${at}: green must be a 0-255 integer`);
    if (!isByte(p.blue)) throw new Error(`${at}: blue must be a 0-255 integer`);
    if (typeof p.connected !== "boolean")
      throw new Error(`${at}: connected must be a boolean`);
    return {
      initial: p.initial,
      red: p.red,
      green: p.green,
      blue: p.blue,
      connected: p.connected,
    };
  });

  if (!isNonNegInt(cs.filled))
    throw new Error(`${where}: filled must be a non-negative integer`);
  if (!isNonNegInt(cs.total))
    throw new Error(`${where}: total must be a non-negative integer`);
  if (
    !isString(cs.status) ||
    !STATUSES.includes(cs.status as LiveActivityStatus)
  )
    throw new Error(`${where}: status must be ongoing | completed | abandoned`);
  if (cs.completedAt !== null && !isString(cs.completedAt))
    throw new Error(`${where}: completedAt must be an ISO string or null`);

  return {
    name: raw.name,
    contentState: {
      pucks,
      filled: cs.filled,
      total: cs.total,
      status: cs.status as LiveActivityStatus,
      completedAt: cs.completedAt as string | null,
    },
  };
}

function loadFixtures(): { cluster: string; cases: VectorCase[] }[] {
  const files: { cluster: string; cases: VectorCase[] }[] = [];
  for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue; // README.md and friends
    const raw: unknown = JSON.parse(
      readFileSync(join(familyDir, entry.name), "utf8"),
    );
    if (!Array.isArray(raw) || raw.length === 0)
      throw new Error(
        `vectors/live-activity/${entry.name} must be a non-empty JSON array`,
      );
    const cluster = entry.name.replace(/\.json$/, "");
    files.push({
      cluster,
      cases: raw.map((c, i) => parseCase(c, `${cluster}[${i}]`)),
    });
  }
  return files;
}

const fixtures = loadFixtures();

describe("Live Activity content-state vectors (PROTOCOL.md Live Activity push)", () => {
  it("discovers the content-state cluster with the required scenarios", () => {
    const clusters = fixtures.map((f) => f.cluster);
    expect(clusters).toContain("content-state");
    const names = fixtures.flatMap((f) => f.cases.map((c) => c.name));
    // The brief's required coverage: mixed presence, at-cap, completed, abandoned, minimal.
    expect(names.some((n) => /mixed/i.test(n))).toBe(true);
    expect(names.some((n) => /at-cap|four/i.test(n))).toBe(true);
    expect(names.some((n) => /completed/i.test(n))).toBe(true);
    expect(names.some((n) => /abandoned/i.test(n))).toBe(true);
    expect(names.some((n) => /minimal|single-puck/i.test(n))).toBe(true);
  });

  for (const file of fixtures) {
    describe(file.cluster, () => {
      for (const c of file.cases) {
        // parseCase already ran during load; a re-parse here keeps the assertion local and
        // proves every case decodes against LiveActivityContentState (the emitter/widget shape).
        it(`${c.name}: parses against LiveActivityContentState`, () => {
          const cs: LiveActivityContentState = c.contentState;
          expect(cs.pucks.length).toBeGreaterThanOrEqual(1);
          expect(STATUSES).toContain(cs.status);
        });

        it(`${c.name}: INV-6 carries counts only, never letters or cells`, () => {
          // filled/total are plain counts; filled never exceeds total; nothing on the payload
          // spells or locates a solution cell. The only strings are the render-only initial and
          // the ISO timestamp, neither of which is board content.
          expect(Number.isInteger(c.contentState.filled)).toBe(true);
          expect(Number.isInteger(c.contentState.total)).toBe(true);
          expect(c.contentState.filled).toBeLessThanOrEqual(
            c.contentState.total,
          );
          // The payload has exactly these keys: no `cells`, no `board`, no `solution`, no `value`.
          expect(Object.keys(c.contentState).sort()).toEqual(
            ["completedAt", "filled", "pucks", "status", "total"].sort(),
          );
        });

        it(`${c.name}: INV-1 each puck initial is a single ASCII-uppercased letter`, () => {
          for (const puck of c.contentState.pucks) {
            expect(puck.initial).toHaveLength(1);
            // ASCII-uppercase is idempotent on an already-uppercased ASCII letter, and never
            // locale-folds; a lowercase or non-ASCII initial would fail one of these.
            expect(asciiUppercase(puck.initial)).toBe(puck.initial);
            expect(/^[A-Z]$/.test(puck.initial)).toBe(true);
          }
        });

        it(`${c.name}: the cluster holds at most ${LIVE_ACTIVITY_MAX_PUCKS} pucks`, () => {
          expect(c.contentState.pucks.length).toBeLessThanOrEqual(
            LIVE_ACTIVITY_MAX_PUCKS,
          );
        });

        it(`${c.name}: completedAt is set iff status is completed`, () => {
          if (c.contentState.status === "completed") {
            expect(c.contentState.completedAt).not.toBeNull();
            // A real ISO-8601 UTC instant.
            expect(
              Number.isNaN(Date.parse(c.contentState.completedAt as string)),
            ).toBe(false);
          } else {
            expect(c.contentState.completedAt).toBeNull();
          }
        });
      }
    });
  }
});
