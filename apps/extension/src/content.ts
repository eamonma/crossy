// Content script, Guardian crossword pages only (manifest matches). Deliberately dumb
// (D21): confirm the page, locate the embedded document, hand it to the popup verbatim.
// It never transforms the document and never talks to the network.

import { isGuardianCrosswordPage } from "./guardian/detect";
import {
  CROSSWORD_ISLAND_SELECTOR,
  parseCrosswordIslandProps,
} from "./guardian/extract";
import { EXTRACT_REQUEST } from "./messaging";
import type { ExtractRequest, ExtractResponse } from "./messaging";

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: ExtractResponse) => void,
  ) => {
    if ((message as ExtractRequest | null)?.type !== EXTRACT_REQUEST) return;

    if (!isGuardianCrosswordPage(location.href)) {
      sendResponse({ ok: false, reason: "not a Guardian crossword page" });
      return;
    }

    const island = document.querySelector(CROSSWORD_ISLAND_SELECTOR);
    sendResponse(
      parseCrosswordIslandProps(island ? island.getAttribute("props") : null),
    );
  },
);
