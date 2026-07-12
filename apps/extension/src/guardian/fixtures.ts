// Test support: synthetic Guardian-shaped fixtures. Every clue, grid, and solution
// here is invented; no real Guardian puzzle content is ever committed (DESIGN.md
// section 7). The page shape mirrors what live pages serve (confirmed 2026-07-11):
// one <gu-island name="CrosswordComponent"> whose `props` attribute is
// HTML-attribute-escaped JSON of {data, canRenderAds}, `data` being the document.

/** A synthetic 3x3 crossword document in the Guardian's shape. */
export const syntheticCrossword = {
  id: "crosswords/quick/1",
  number: 1,
  name: "Quick crossword No 1",
  date: 0,
  webPublicationDate: 0,
  crosswordType: "quick",
  solutionAvailable: true,
  dateSolutionAvailable: 0,
  dimensions: { cols: 3, rows: 3 },
  entries: [
    {
      id: "1-across",
      number: 1,
      humanNumber: "1",
      clue: "Synthetic clue, across",
      direction: "across",
      length: 3,
      group: ["1-across"],
      position: { x: 0, y: 0 },
      separatorLocations: {},
      solution: "AAB",
    },
    {
      id: "1-down",
      number: 1,
      humanNumber: "1",
      clue: "Synthetic clue, down",
      direction: "down",
      length: 3,
      group: ["1-down"],
      position: { x: 0, y: 0 },
      separatorLocations: {},
      solution: "ABA",
    },
  ],
};

/** Escape a string the way a server renders it into a double-quoted HTML attribute. */
export function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** A minimal page embedding `propsJson` as CrosswordComponent island props. */
export function islandPage(propsJson: string): string {
  return (
    "<!DOCTYPE html><html><body><main>" +
    '<gu-island name="CrosswordComponent" priority="critical" deferUntil="visible" props="' +
    escapeAttribute(propsJson) +
    '"></gu-island>' +
    "</main></body></html>"
  );
}

/** A crossword page with the synthetic document embedded the way live pages embed it. */
export const syntheticPuzzlePage = islandPage(
  JSON.stringify({ data: syntheticCrossword, canRenderAds: false }),
);

/**
 * A pinned literal of the same embedding, escaped by hand, so the tests' attribute
 * decoding is checked against fixed text rather than only a round trip. The prefix
 * mirrors what live pages serve: props="{&quot;data&quot;:{&quot;id&quot;:...
 */
export const pinnedIslandPage =
  "<!DOCTYPE html><html><body>" +
  '<gu-island name="CrosswordComponent" priority="critical" deferUntil="visible" ' +
  'props="{&quot;data&quot;:{&quot;id&quot;:&quot;crosswords/quick/2&quot;,' +
  "&quot;name&quot;:&quot;Quick crossword No 2&quot;," +
  "&quot;clueHtml&quot;:&quot;a &amp;amp; b &amp;lt;i&amp;gt;&quot;," +
  '&quot;solutionAvailable&quot;:true},&quot;canRenderAds&quot;:false}"' +
  "></gu-island></body></html>";

/** A crosswords page with no crossword island (a series page, say). */
export const noIslandPage =
  "<!DOCTYPE html><html><body><main>" +
  '<gu-island name="ShareButton" props="{}"></gu-island>' +
  "</main></body></html>";
