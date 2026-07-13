// The web display-name spec runner (DESIGN.md name-onboarding §8, §13). Runs every case in
// vectors/identity/display-name.json through the client's canonicalize + completeness path and
// the edge sanitize filter, so the web sanitizer cannot drift from the vector the API validator
// (apps/api/src/identity/display-name.ts) and the iOS sanitizer are pinned to. Client and
// server agree on the same file.
//
// INV-1 (ASCII-only casing) is cell-values only and deliberately does NOT apply to names: the
// casing cases assert lowercase and uppercase are preserved, never folded.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_DISPLAY_NAME_GRAPHEMES,
  isAlwaysDisallowedScalar,
  isZeroWidthScalar,
} from "@crossy/protocol";
import {
  canonicalizeDisplayName,
  isCompleteDisplayName,
  sanitizeDisplayName,
} from "./name";

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

// A code-returning validator for the test only, mirroring the API's validate against the same
// protocol constants, so the web test can assert the vector's NAME_* codes. Production web code
// keys on the code the server returns (profile/api.ts); this local copy exists purely to prove
// the client's canonicalize + completeness lands on the same verdict the vector pins.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function graphemes(s: string): string[] {
  return Array.from(segmenter.segment(s), (seg) => seg.segment);
}
function clusterHasDisallowedScalar(cluster: string): boolean {
  let allZeroWidth = true;
  let hasZeroWidth = false;
  for (const ch of cluster) {
    const cp = ch.codePointAt(0)!;
    if (isAlwaysDisallowedScalar(cp)) return true;
    if (isZeroWidthScalar(cp)) hasZeroWidth = true;
    else allZeroWidth = false;
  }
  return hasZeroWidth && allZeroWidth;
}
function validateCanonical(
  canonical: string,
): { ok: true; value: string } | { ok: false; code: string } {
  if (canonical.length === 0) return { ok: false, code: "NAME_REQUIRED" };
  const clusters = graphemes(canonical);
  if (clusters.length > MAX_DISPLAY_NAME_GRAPHEMES) {
    return { ok: false, code: "NAME_TOO_LONG" };
  }
  for (const cluster of clusters) {
    if (clusterHasDisallowedScalar(cluster)) {
      return { ok: false, code: "NAME_INVALID" };
    }
  }
  return { ok: true, value: canonical };
}

describe("web display-name spec vectors (INV-1 casing does NOT apply to names)", () => {
  it("has both canonicalize and sanitize cases so both client paths are pinned", () => {
    const intents = new Set(vectors.map((v) => v.intent));
    expect(intents).toContain("canonicalize");
    expect(intents).toContain("sanitize");
  });

  for (const vector of vectors) {
    it(vector.name, () => {
      if (vector.intent === "canonicalize") {
        const canonical = canonicalizeDisplayName(vector.input);
        const result = validateCanonical(canonical);
        const then = vector.then as
          { ok: true; value: string } | { ok: false; code: string };
        if (then.ok) {
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value).toBe(then.value);
          // A vector `ok:true` value is a complete, submittable name by construction.
          expect(isCompleteDisplayName(vector.input)).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.code).toBe(then.code);
          // Anything the vector rejects is not submittable, so the client never PATCHes it.
          expect(isCompleteDisplayName(vector.input)).toBe(false);
        }
      } else {
        const then = vector.then as { value: string };
        expect(sanitizeDisplayName(vector.input)).toBe(then.value);
      }
    });
  }
});
