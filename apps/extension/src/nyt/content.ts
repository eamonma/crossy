// Content script, NYT crossword game pages only (manifest match). Deliberately dumb
// (D21): confirm the page, read the v6 puzzle document, hand it to the popup verbatim.
//
// Unlike the Guardian adapter, the document is not in the DOM: the NYT page fetches it
// at runtime and keeps only a transformed store shape, so the only place the pinned raw
// v6 object exists is the same-origin endpoint response (detect.ts). This script
// therefore re-fetches that endpoint with the tab's own session (credentials:
// "same-origin"): the user exercises the NYT access they already hold (D21). This is
// the least-privileged mechanism that yields the pinned document. A main-world
// injection would only reach the store's transformed shape (not the raw v6 object) and
// grant page-context execution; a script-tag read is impossible because the puzzle is
// never embedded. The fetch is same-origin, so it needs no host permission and sends
// no fabricated header (the page's internal X-Games-Auth-Bypass is not replicated).
//
// DAILY UNVERIFIED: only the free mini endpoint was probed (served HTML). A signed-in
// subscriber's cookies authorize the daily fetch, but that path is unconfirmed here.
//
// This script also runs the extraction once at document_idle to gate the inline
// pill (D22): the pill mounts only when this page can actually ingest. Top-level
// pages only; the AmuseLabs frame script never grows pill logic.

import { EXTRACT_REQUEST, respondWith } from "../messaging";
import type { ExtractRequest, ExtractResponse } from "../messaging";
import { maybeMountPill } from "../pill/mount";
import { isNytCrosswordGamePage, nytPuzzleEndpoint } from "./detect";
import { parseNytPuzzle } from "./extract";

async function extract(): Promise<ExtractResponse> {
  if (!isNytCrosswordGamePage(location.href)) {
    return { ok: false, reason: "not a NYT crossword game page" };
  }
  const endpoint = nytPuzzleEndpoint(location.href);
  if (endpoint === null) {
    return { ok: false, reason: "unsupported NYT crossword URL" };
  }
  try {
    const response = await fetch(endpoint, { credentials: "same-origin" });
    if (!response.ok) {
      return {
        ok: false,
        reason: `could not read the NYT puzzle (${response.status})`,
      };
    }
    return respondWith("nyt", parseNytPuzzle(await response.text()));
  } catch {
    return { ok: false, reason: "could not reach the NYT puzzle" };
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: ExtractResponse) => void,
  ): boolean | undefined => {
    if ((message as ExtractRequest | null)?.type !== EXTRACT_REQUEST) return;
    void extract().then(sendResponse);
    return true; // keep the reply channel open for the async fetch
  },
);

void maybeMountPill("nyt", extract);
