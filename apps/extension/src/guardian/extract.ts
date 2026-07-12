// Guardian embed extraction. The crossword JSON is server-rendered into the page as
// island props: <gu-island name="CrosswordComponent" props="..."> where `props` is an
// HTML-attribute-escaped JSON string of {data, canRenderAds} and `data` is the raw
// crossword document (confirmed against live quick and cryptic pages, 2026-07-11).
//
// Extraction locates the document and nothing more (D21, extraction-only): the island
// wrapper is dotcom-rendering plumbing, so `data` is handed on verbatim and the shape
// checks below stop at "an object", the form PROTOCOL.md section 12 pins for the
// `guardian` envelope. Translation, validation, and rejection are the server ACL's job.

import type { ExtractResult } from "../extract-result";

/** The island that carries the crossword document in its `props` attribute. */
export const CROSSWORD_ISLAND_SELECTOR = 'gu-island[name="CrosswordComponent"]';

/**
 * Parse a `props` attribute value (as the DOM returns it, entities already decoded)
 * into the raw crossword document. `null` means the island was absent.
 */
export function parseCrosswordIslandProps(props: string | null): ExtractResult {
  if (props === null) {
    return { ok: false, reason: "no crossword found on this page" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(props);
  } catch {
    return { ok: false, reason: "crossword island props are not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) {
    return { ok: false, reason: "crossword island props carry no data" };
  }
  const document = (parsed as { readonly data: unknown }).data;
  if (typeof document === "undefined" || document === null) {
    return { ok: false, reason: "crossword island data is empty" };
  }
  if (typeof document !== "object") {
    return { ok: false, reason: "crossword island data is not an object" };
  }
  return { ok: true, document };
}
