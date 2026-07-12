import { describe, expect, it } from "vitest";
import { parseNytPuzzle } from "./extract";
import { syntheticNytPuzzle, syntheticNytResponse } from "./fixtures";

describe("parseNytPuzzle", () => {
  it("hands the v6 object over verbatim, no wrapper dropped (D21: extraction-only)", () => {
    const result = parseNytPuzzle(syntheticNytResponse);
    expect(result).toEqual({ ok: true, document: syntheticNytPuzzle });
  });

  it("accepts only an object carrying a body array, the form PROTOCOL section 12 pins", () => {
    expect(parseNytPuzzle('{"body":[]}').ok).toBe(true);
    expect(parseNytPuzzle('{"body":{}}')).toEqual({
      ok: false,
      reason: "the NYT puzzle response carries no body",
    });
    expect(parseNytPuzzle("[]")).toEqual({
      ok: false,
      reason: "the NYT puzzle response carries no body",
    });
  });

  it("rejects a non-object response", () => {
    expect(parseNytPuzzle("null")).toEqual({
      ok: false,
      reason: "the NYT puzzle response is not an object",
    });
    expect(parseNytPuzzle('"nope"')).toEqual({
      ok: false,
      reason: "the NYT puzzle response is not an object",
    });
  });

  it("rejects a response that is not JSON", () => {
    expect(parseNytPuzzle("<html>404</html>")).toEqual({
      ok: false,
      reason: "the NYT puzzle response is not JSON",
    });
  });
});
