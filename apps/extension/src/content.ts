// Content script, Guardian crossword pages only (manifest matches). Deliberately dumb
// (D21): confirm the page, locate the embedded document, hand it to the popup verbatim.
// It never transforms the document and never talks to the network. (The NYT and
// AmuseLabs adapters have their own content scripts; this one is Guardian's.)
//
// This script also runs the extraction once at document_idle to gate the inline
// pill (D22): the pill mounts only when this page can actually ingest. Top-level
// pages only; the AmuseLabs frame script never grows pill logic.

import { isGuardianCrosswordPage } from "./guardian/detect";
import {
  CROSSWORD_ISLAND_SELECTOR,
  parseCrosswordIslandProps,
} from "./guardian/extract";
import { EXTRACT_REQUEST, respondWith } from "./messaging";
import type { ExtractRequest, ExtractResponse } from "./messaging";
import { maybeMountPill } from "./pill/mount";

function extract(): ExtractResponse {
  if (!isGuardianCrosswordPage(location.href)) {
    return { ok: false, reason: "not a Guardian crossword page" };
  }
  const island = document.querySelector(CROSSWORD_ISLAND_SELECTOR);
  return respondWith(
    "guardian",
    parseCrosswordIslandProps(island ? island.getAttribute("props") : null),
  );
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: ExtractResponse) => void,
  ) => {
    if ((message as ExtractRequest | null)?.type !== EXTRACT_REQUEST) return;
    sendResponse(extract());
  },
);

void maybeMountPill("guardian", () => Promise.resolve(extract()));
