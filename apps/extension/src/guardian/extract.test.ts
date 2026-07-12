import { describe, expect, it } from "vitest";
import { parseCrosswordIslandProps } from "./extract";
import {
  noIslandPage,
  pinnedIslandPage,
  syntheticCrossword,
  syntheticPuzzlePage,
} from "./fixtures";

// Test-side stand-in for document.querySelector(...).getAttribute("props") over a
// fixture string: locate the island, decode the attribute the way the DOM does
// (exactly one entity-decoding pass).
const ENTITIES: Record<string, string> = {
  quot: '"',
  amp: "&",
  lt: "<",
  gt: ">",
  "#39": "'",
  "#x27": "'",
};

function decodeAttribute(value: string): string {
  return value.replace(
    /&(quot|amp|lt|gt|#39|#x27);/g,
    (_, entity: string) => ENTITIES[entity]!,
  );
}

function islandPropsFrom(html: string): string | null {
  const match =
    /<gu-island name="CrosswordComponent"[^>]*\sprops="([^"]*)"/.exec(html);
  return match ? decodeAttribute(match[1]!) : null;
}

describe("parseCrosswordIslandProps", () => {
  it("extracts the embedded document from a synthetic page, verbatim (D21: extraction-only)", () => {
    const result = parseCrosswordIslandProps(
      islandPropsFrom(syntheticPuzzlePage),
    );
    expect(result).toEqual({ ok: true, document: syntheticCrossword });
  });

  it("decodes exactly one attribute layer: entity text inside the document survives", () => {
    const result = parseCrosswordIslandProps(islandPropsFrom(pinnedIslandPage));
    expect(result.ok).toBe(true);
    const document = (result as { document: Record<string, unknown> }).document;
    expect(document["id"]).toBe("crosswords/quick/2");
    // The clue carried HTML entities inside the JSON; extraction must not touch them.
    expect(document["clueHtml"]).toBe("a &amp; b &lt;i&gt;");
  });

  it("reports no crossword when the island is absent", () => {
    expect(parseCrosswordIslandProps(islandPropsFrom(noIslandPage))).toEqual({
      ok: false,
      reason: "no crossword found on this page",
    });
  });

  it("rejects props that are not JSON", () => {
    const result = parseCrosswordIslandProps("{not json");
    expect(result).toEqual({
      ok: false,
      reason: "crossword island props are not JSON",
    });
  });

  it("rejects props without a data key", () => {
    const result = parseCrosswordIslandProps('{"canRenderAds":false}');
    expect(result).toEqual({
      ok: false,
      reason: "crossword island props carry no data",
    });
  });

  it("rejects data that is not an object, the form PROTOCOL section 12 pins", () => {
    expect(parseCrosswordIslandProps('{"data":null}').ok).toBe(false);
    expect(parseCrosswordIslandProps('{"data":"nope"}').ok).toBe(false);
  });
});
