// The API's copy of the cross-client solver-title LABELS (design/post-game/TITLES.md; PROTOCOL.md
// §12; frozen in vectors/analysis/title-labels.json). The wire (GET /games/{id}/analysis `titles`)
// carries only a lowercase-kebab key and an evidence number; the label is the film-credit name a
// surface paints for that key. The server-rendered share card now renders these labels in its
// credits block (SHARE.md wave S1's credits, on the server card since native apps consume the PNG),
// so the labels are shared normative ground rather than client-owned prose.
//
// apps never import apps (DESIGN.md layering), so this cannot import apps/web's titlesReadout.ts; it
// is a deliberate duplication pinned to the same vector by titleLabels.test.ts, the exact pattern
// identityRoster.ts follows for the color roster. LABELS ONLY: the evidence/detail line under a
// label ("Overwrote 7 correct squares") interpolates the solve's stats and stays client-owned, so
// the server card renders the label and not the detail (the og variant compresses credits to titles
// only anyway; packages/share-card).

/** The pinned title labels, keyed by the wire's lowercase-kebab title key
 * (vectors/analysis/title-labels.json, the web TITLE_COPY labels verbatim). */
export const TITLE_LABELS: Readonly<Record<string, string>> = {
  saboteur: "The saboteur",
  "one-hit-wonder": "The one-hit wonder",
  "ice-breaker": "The ice breaker",
  bullseye: "The bullseye",
  headliner: "The headliner",
  sprinter: "The sprinter",
  meddler: "The meddler",
  marathoner: "The marathoner",
  "quick-starter": "The quick starter",
  closer: "The closer",
  specialist: "The specialist",
  "long-hauler": "The long hauler",
  wanderer: "The wanderer",
  scribbler: "The scribbler",
  collector: "The collector",
  workhorse: "The workhorse",
};

/**
 * The label for a wire title key, or null for a key this build does not know (a newer server's
 * ladder). Object.hasOwn guards the lookup so a hostile key ("constructor") can never reach the
 * record's prototype, and the null return is the PROTOCOL.md §12 MUST-ignore rule: the card credits
 * the solver with no title line rather than inventing copy.
 */
export function titleLabelOf(key: string): string | null {
  return Object.hasOwn(TITLE_LABELS, key) ? TITLE_LABELS[key]! : null;
}
