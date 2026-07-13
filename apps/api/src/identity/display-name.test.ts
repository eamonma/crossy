// The display-name spec runner (DESIGN.md name-onboarding §8). Runs every case in
// vectors/identity/display-name.json through the authoritative canonicalize + validate path
// and the edge sanitize filter, so the API validator cannot drift from the vector the web and
// iOS sanitizers are pinned to. INV-1 (ASCII-only casing) is cell-values only and deliberately
// does NOT apply to names: the casing cases assert lowercase and uppercase are preserved.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalize, sanitize, validate } from "./display-name";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(
    resolve(here, "../../../../vectors/identity/display-name.json"),
    "utf8",
  ),
) as ReadonlyArray<{
  name: string;
  intent: "canonicalize" | "sanitize";
  input: string;
  then:
    | { ok: true; value: string }
    | { ok: false; code: string }
    | { value: string };
}>;

describe("display-name spec vectors (INV-1 casing does NOT apply to names; INV-7 single writer of users)", () => {
  it("has both canonicalize and sanitize cases so both paths are pinned", () => {
    const intents = new Set(vectors.map((v) => v.intent));
    expect(intents).toContain("canonicalize");
    expect(intents).toContain("sanitize");
  });

  for (const vector of vectors) {
    it(vector.name, () => {
      if (vector.intent === "canonicalize") {
        const result = validate(canonicalize(vector.input));
        const then = vector.then as
          { ok: true; value: string } | { ok: false; code: string };
        if (then.ok) {
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value).toBe(then.value);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.code).toBe(then.code);
        }
      } else {
        const then = vector.then as { value: string };
        expect(sanitize(vector.input)).toBe(then.value);
      }
    });
  }
});
