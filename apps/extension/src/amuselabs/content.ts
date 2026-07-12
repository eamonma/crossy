// Content script, AmuseLabs (PuzzleMe) crossword frames only (manifest matches,
// all_frames:true so it runs inside the embedded iframe; document_start so the
// capture listener below exists before the page's first JSON.parse). Deliberately
// dumb (D21): confirm the frame, locate the puzzle document, hand it to the popup
// verbatim. Two sources, one preference (extract.ts): the page's own decoded
// document when the MAIN-world capture script (page-capture.ts) announced one,
// else the raw encoded rawc blob, params script tag first, then a classic
// window.rawc assignment. It never decodes the blob and never talks to the network.

import { EXTRACT_REQUEST, respondWith } from "../messaging";
import type { ExtractRequest, ExtractResponse } from "../messaging";
import { readCapturedDocMessage } from "./capture";
import { isAmuseLabsCrosswordFrame } from "./detect";
import { extractAmuseDocument, PARAMS_SCRIPT_SELECTOR } from "./extract";

// The first captured document wins and holds (the capture script posts at most
// one); readCapturedDocMessage checks source, origin, and shape (capture.ts).
let captured: Record<string, unknown> | null = null;

window.addEventListener("message", (event) => {
  if (captured !== null) return;
  captured = readCapturedDocMessage(event, window, location.origin);
});

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender,
    sendResponse: (response: ExtractResponse) => void,
  ) => {
    if ((message as ExtractRequest | null)?.type !== EXTRACT_REQUEST) return;

    if (!isAmuseLabsCrosswordFrame(location.href)) {
      sendResponse({ ok: false, reason: "not a PuzzleMe crossword frame" });
      return;
    }

    const params = document.querySelector(PARAMS_SCRIPT_SELECTOR);
    const result = extractAmuseDocument(
      captured,
      params ? params.textContent : null,
      () =>
        Array.from(
          document.querySelectorAll("script:not([src])"),
          (script) => script.textContent ?? "",
        ),
    );
    sendResponse(respondWith("amuselabs", result));
  },
);
