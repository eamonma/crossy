import { describe, expect, it } from "vitest";
import {
  extractAmuseDocument,
  extractRawcAssignment,
  parseAmuseParams,
} from "./extract";
import {
  SYNTHETIC_RAWC,
  classicRawcScript,
  syntheticCapturedDoc,
  syntheticParamsJson,
} from "./fixtures";

// Test-side stand-in for document.querySelector("script#params").textContent over a
// fixture page string.
function paramsTextFrom(html: string): string | null {
  const match =
    /<script type="application\/json" id="params">([^<]*)<\/script>/.exec(html);
  return match ? match[1]! : null;
}

describe("parseAmuseParams", () => {
  it("hands the raw rawc STRING over verbatim (D21: extraction-only, no decoding)", () => {
    const result = parseAmuseParams(syntheticParamsJson);
    expect(result).toEqual({ ok: true, document: SYNTHETIC_RAWC });
    // PROTOCOL section 12: the amuselabs document is a string, never decoded here.
    expect(typeof (result as { document: unknown }).document).toBe("string");
  });

  it("reads the params tag as the DOM returns its text content", () => {
    const page =
      '<script type="application/json" id="params">' +
      syntheticParamsJson +
      "</script>";
    expect(parseAmuseParams(paramsTextFrom(page))).toEqual({
      ok: true,
      document: SYNTHETIC_RAWC,
    });
  });

  it("reports no params when the tag is absent", () => {
    expect(parseAmuseParams(null)).toEqual({
      ok: false,
      reason: "no PuzzleMe params on this page",
    });
  });

  it("rejects params that are not JSON", () => {
    expect(parseAmuseParams("{not json")).toEqual({
      ok: false,
      reason: "PuzzleMe params are not JSON",
    });
  });

  it("rejects params without a rawc, or a non-string rawc", () => {
    expect(parseAmuseParams('{"puzzleId":"x"}')).toEqual({
      ok: false,
      reason: "PuzzleMe params carry no rawc",
    });
    expect(parseAmuseParams('{"rawc":123}').ok).toBe(false);
    expect(parseAmuseParams('{"rawc":""}').ok).toBe(false);
  });
});

describe("extractAmuseDocument (capture preference, PROTOCOL.md section 12)", () => {
  it("prefers the captured decoded document over any rawc source (the page already decoded it)", () => {
    const doc = syntheticCapturedDoc();
    expect(
      extractAmuseDocument(doc, syntheticParamsJson, () => [classicRawcScript]),
    ).toEqual({ ok: true, document: doc });
  });

  it("falls back to the rawc string exactly as before when nothing was captured", () => {
    expect(extractAmuseDocument(null, syntheticParamsJson, () => [])).toEqual({
      ok: true,
      document: SYNTHETIC_RAWC,
    });
    expect(extractAmuseDocument(null, null, () => [classicRawcScript])).toEqual(
      { ok: true, document: SYNTHETIC_RAWC },
    );
  });

  it("keeps the existing no-puzzle reply when neither source exists", () => {
    expect(extractAmuseDocument(null, null, () => [])).toEqual({
      ok: false,
      reason: "no PuzzleMe params on this page",
    });
  });

  it("never reads inline scripts when the params rawc suffices (lazy fallback)", () => {
    let read = false;
    extractAmuseDocument(null, syntheticParamsJson, () => {
      read = true;
      return [];
    });
    expect(read).toBe(false);
  });
});

describe("extractRawcAssignment", () => {
  it("locates a classic window.rawc assignment verbatim", () => {
    expect(extractRawcAssignment([classicRawcScript])).toEqual({
      ok: true,
      document: SYNTHETIC_RAWC,
    });
  });

  it("handles double-quoted assignments and scans across scripts", () => {
    expect(
      extractRawcAssignment([
        "var x = 1;",
        `window.rawc = "${SYNTHETIC_RAWC}";`,
      ]),
    ).toEqual({ ok: true, document: SYNTHETIC_RAWC });
  });

  it("reports none when no script assigns rawc", () => {
    expect(extractRawcAssignment(["window.puzzleEnv = {};"])).toEqual({
      ok: false,
      reason: "no PuzzleMe rawc found on this page",
    });
  });
});
