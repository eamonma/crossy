/**
 * Runs firstCorrect against the first-correct conformance vectors (vectors/first-correct/),
 * the golden written before this projection (CLAUDE.md house rule; PROTOCOL.md §13). This is
 * a narrow per-family reader: it globs vectors/first-correct/*.json (skipping README.md),
 * deserializes each case's [cell, expected] pairs into the engine's Solution, runs
 * firstCorrect(given.events, solution), and asserts the OwnerMap equals then.owners.
 *
 * The family sits at the top level (not vectors/v1/), so the closed v1 runner never globs it;
 * this reader adopts it exactly as vectors/first-correct/README.md prescribes. The existing v1
 * runner (vectors.test.ts) and vectors.skip.json are untouched.
 *
 * Test files are exempt from INV-9 (.dependency-cruiser.cjs), so node:fs / node:path are
 * allowed here; the projection itself imports only ./comparator and ./types.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { firstCorrect } from "./index";
import type { Solution } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsRoot = resolve(here, "../../../vectors/first-correct");

interface WriteEventJson {
  readonly seq: number;
  readonly cell: number;
  readonly userId: string;
  readonly value: string | null;
}

interface FirstCorrectCase {
  readonly name: string;
  readonly given: {
    readonly solution: [number, string][];
    readonly events: WriteEventJson[];
  };
  readonly then: {
    readonly owners: Record<string, string>;
  };
}

/** Every case across every cluster file, README.md skipped (it is prose, not a fixture). */
function loadCases(): FirstCorrectCase[] {
  const cases: FirstCorrectCase[] = [];
  for (const file of readdirSync(vectorsRoot)) {
    if (!file.endsWith(".json")) continue;
    const raw: unknown = JSON.parse(
      readFileSync(join(vectorsRoot, file), "utf8"),
    );
    for (const c of raw as FirstCorrectCase[]) cases.push(c);
  }
  return cases;
}

/** Deserialize the [cell, expected] pairs into the engine's Solution (Map<number, string>). */
function buildSolution(pairs: [number, string][]): Solution {
  return new Map(pairs);
}

/**
 * then.owners keys are decimal strings; the OwnerMap keys are numbers. Serialize the map back
 * to the same string-keyed shape so equality is asserted on one consistent representation.
 */
function serializeOwners(
  owners: ReadonlyMap<number, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [cell, userId] of owners) out[String(cell)] = userId;
  return out;
}

describe("firstCorrect vectors (vectors/first-correct/)", () => {
  for (const c of loadCases()) {
    it(c.name, () => {
      const solution = buildSolution(c.given.solution);
      const owners = firstCorrect(c.given.events, solution);
      // INV-6: owners carries user ids only. Asserting against then.owners (userIds, never a
      // solution value) proves the projection never surfaces an expected letter.
      expect(serializeOwners(owners)).toEqual(c.then.owners);
    });
  }
});

// A few targeted assertions naming the invariants they defend, on top of the fixture sweep.
describe("firstCorrect invariants", () => {
  it("INV-6: the owner map carries user ids only, never a solution value", () => {
    // STAR is the only value that could leak; the map must never contain it.
    const solution: Solution = new Map([[0, "STAR"]]);
    const owners = firstCorrect(
      [{ seq: 1, cell: 0, userId: "u1", value: "STAR" }],
      solution,
    );
    expect([...owners.values()]).toEqual(["u1"]);
    expect([...owners.values()]).not.toContain("STAR");
  });

  it("INV-1: rebus first-character acceptance owns via matches, ASCII case-insensitively", () => {
    // matches("STAR", "s") is true (first char, ASCII casing); the S writer owns.
    const solution: Solution = new Map([[0, "STAR"]]);
    const owners = firstCorrect(
      [
        { seq: 4, cell: 0, userId: "u1", value: "s" },
        { seq: 8, cell: 0, userId: "u2", value: "STAR" },
      ],
      solution,
    );
    expect(owners.get(0)).toBe("u1");
  });
});
