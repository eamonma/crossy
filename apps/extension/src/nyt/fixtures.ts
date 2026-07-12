// Test support: synthetic NYT-v6-shaped fixtures. Every cell, clue, and answer here is
// invented; no real NYT puzzle content is ever committed (DESIGN.md section 7). The
// shape mirrors the v6 endpoint response probed 2026-07-11: a bare object whose `body`
// is an array of one board carrying cells, clues, and dimensions.

/** A synthetic 2x2 puzzle document in the NYT v6 shape. */
export const syntheticNytPuzzle = {
  body: [
    {
      board: "ABCD",
      cells: [
        { answer: "A", label: "1", type: 1 },
        { answer: "B", label: "2", type: 1 },
        { answer: "C", type: 1 },
        { answer: "D", type: 1 },
      ],
      clues: [
        {
          label: "1",
          direction: "Across",
          text: [{ plain: "Synthetic across" }],
        },
        { label: "1", direction: "Down", text: [{ plain: "Synthetic down" }] },
      ],
      dimensions: { width: 2, height: 2 },
    },
  ],
  constructors: ["Synthetic Constructor"],
  copyright: "2026",
  editor: "Synthetic Editor",
  id: 1,
  lastUpdated: "2026-07-11 00:00:00",
  publicationDate: "2026-07-11",
  title: "Synthetic Mini",
};

/** The same document serialized the way the v6 endpoint serves it (bare, no wrapper). */
export const syntheticNytResponse = JSON.stringify(syntheticNytPuzzle);
