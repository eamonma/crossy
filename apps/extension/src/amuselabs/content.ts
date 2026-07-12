// Content script, AmuseLabs (PuzzleMe) crossword frames only (manifest matches,
// all_frames:true so it runs inside the embedded iframe). Deliberately dumb (D21):
// confirm the frame, locate the raw encoded blob, hand it to the popup verbatim. It
// never decodes the blob and never talks to the network. Both known blob forms are
// tried: the params script tag first (current), then a classic window.rawc assignment.

import { EXTRACT_REQUEST, respondWith } from "../messaging";
import type { ExtractRequest, ExtractResponse } from "../messaging";
import { isAmuseLabsCrosswordFrame } from "./detect";
import {
  PARAMS_SCRIPT_SELECTOR,
  extractRawcAssignment,
  parseAmuseParams,
} from "./extract";

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
    let result = parseAmuseParams(params ? params.textContent : null);
    if (!result.ok) {
      const inlineScripts = Array.from(
        document.querySelectorAll("script:not([src])"),
        (script) => script.textContent ?? "",
      );
      const classic = extractRawcAssignment(inlineScripts);
      if (classic.ok) result = classic;
    }
    sendResponse(respondWith("amuselabs", result));
  },
);
