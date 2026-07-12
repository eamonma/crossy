// NYT v6 puzzle extraction. The content script fetches the v6 endpoint (see detect.ts)
// and hands its response text here. This locates the document and nothing more (D21,
// extraction-only): the v6 endpoint returns the bare puzzle object {body:[...], ...}
// with no transport wrapper (confirmed from the page bundle, which destructures
// `body`/`assets` straight off the response), so the parsed object is handed on
// verbatim. The shape check stops at "an object carrying a `body` array", the form
// PROTOCOL.md section 12 pins for the `nyt` envelope. Translation, validation, and
// rejection are the server ACL's job.

import type { ExtractResult } from "../extract-result";

/**
 * Parse a fetched v6 puzzle response body into the raw puzzle document. No wrapper is
 * unwrapped: the endpoint serves the pinned object directly.
 */
export function parseNytPuzzle(responseText: string): ExtractResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return { ok: false, reason: "the NYT puzzle response is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "the NYT puzzle response is not an object" };
  }
  if (!Array.isArray((parsed as { readonly body?: unknown }).body)) {
    return { ok: false, reason: "the NYT puzzle response carries no body" };
  }
  return { ok: true, document: parsed };
}
