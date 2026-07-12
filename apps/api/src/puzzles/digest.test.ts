// Runs the digest function against the puzzle-digest conformance vectors (vectors/puzzle-digest/),
// the golden written before this code (CLAUDE.md house rule). Three layers, one per file:
// canon.json pins the exact canonical string, digest.json pins its sha256, equivalence.json pins
// which ServerPuzzle pairs MUST or MUST NOT collapse. canon + digest compose to equivalence, and
// the anchor below ties puzzleDigest end to end to an independently computed hex (INV-6: the
// digest is solution-derived and stays server-only, so a vector may carry a solution grid).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ServerPuzzle } from "@crossy/protocol";
import { canonPuzzle, puzzleDigest } from "./digest";

const here = dirname(fileURLToPath(import.meta.url));
const vectorsRoot = resolve(here, "../../../../vectors/puzzle-digest");

function load<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(vectorsRoot, file), "utf8")) as T;
}

interface CanonCase {
  readonly name: string;
  readonly puzzle: unknown;
  readonly canon: string;
}
interface DigestCase {
  readonly name: string;
  readonly canon: string;
  readonly algorithm: string;
  readonly digest: string;
}
interface EquivalenceCase {
  readonly name: string;
  readonly a: unknown;
  readonly b: unknown;
  readonly sameDigest: boolean;
}

describe("puzzle-digest vectors: canon (canon.json)", () => {
  for (const c of load<CanonCase[]>("canon.json")) {
    it(c.name, () => {
      expect(canonPuzzle(c.puzzle as ServerPuzzle)).toBe(c.canon);
    });
  }
});

describe("puzzle-digest vectors: digest (digest.json)", () => {
  for (const c of load<DigestCase[]>("digest.json")) {
    it(c.name, () => {
      expect(c.algorithm).toBe("sha256");
      expect(createHash("sha256").update(c.canon, "utf8").digest("hex")).toBe(
        c.digest,
      );
    });
  }
});

describe("puzzle-digest vectors: equivalence (equivalence.json)", () => {
  for (const c of load<EquivalenceCase[]>("equivalence.json")) {
    it(c.name, () => {
      const collapse =
        puzzleDigest(c.a as ServerPuzzle) === puzzleDigest(c.b as ServerPuzzle);
      expect(collapse).toBe(c.sameDigest);
    });
  }
});

it("INV-6 anchor: puzzleDigest composes canon + sha256 to the independently pinned hex", () => {
  const open = load<CanonCase[]>("canon.json")[0]!.puzzle as ServerPuzzle;
  expect(puzzleDigest(open)).toBe(
    "19bee53524490ca260dc17c879ee7eaf423b917267c311755343e010474ae3ce",
  );
});
