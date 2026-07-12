// Test support: synthetic AmuseLabs-shaped fixtures. The blob content here is invented,
// not a real encoded puzzle from any outlet (DESIGN.md section 7). The page shape
// mirrors a live PuzzleMe frame (confirmed 2026-07-11): a server-rendered
// <script type="application/json" id="params"> whose JSON carries a string `rawc`.

/** An invented encoded blob, standing in for the real base64-ish rawc string. */
export const SYNTHETIC_RAWC = "U1lOVEhFVElDX0FNVVNFX0JMT0Jf-abc_DEF123==";

/** The params JSON as the current PuzzleMe frame server-renders it. */
export const syntheticParamsJson = JSON.stringify({
  puzzleId: "synthetic-1",
  rawp: "U1lOVEhFVElDX1BST0dSRVNT",
  rawc: SYNTHETIC_RAWC,
  rawConf: "U1lOVEhFVElDX0NPTkY=",
  updateLoadTable: true,
});

/** A full frame embedding the params script the way live frames embed it. */
export const syntheticParamsPage =
  "<!DOCTYPE html><html><head>" +
  '<script type="application/json" id="params">' +
  syntheticParamsJson +
  "</script></head><body></body></html>";

/** The classic form: an inline script assigning window.rawc. */
export const classicRawcScript = `  window.rawc = '${SYNTHETIC_RAWC}';\n  window.puzzleEnv = {};`;

/**
 * A synthetic decoded PuzzleMe document, as the MAIN-world capture (page-capture.ts)
 * hands it over. Invented content, never a real outlet puzzle (DESIGN.md section 7).
 */
export function syntheticCapturedDoc(): Record<string, unknown> {
  return {
    title: "Synthetic Captured No 1",
    w: 2,
    h: 1,
    box: [["C"], ["Y"]],
    placedWords: [
      { clue: { clue: "Two letters (2)" }, acrossNotDown: true, x: 0, y: 0 },
    ],
  };
}
