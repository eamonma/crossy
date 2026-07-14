"use strict";
(() => {
  // src/messaging.ts
  var EXTRACT_REQUEST = "crossy/extract";
  function respondWith(format, result) {
    return result.ok ? { ok: true, format, document: result.document } : result;
  }

  // src/amuselabs/detect.ts
  function isAmuseLabsCrosswordFrame(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    if (host !== "amuselabs.com" && !host.endsWith(".amuselabs.com")) {
      return false;
    }
    return parsed.pathname.endsWith("/crossword");
  }

  // src/amuselabs/extract.ts
  var PARAMS_SCRIPT_SELECTOR = "script#params";
  var RAWC_ASSIGNMENT = /\brawc\s*=\s*(?:"([^"]*)"|'([^']*)')/;
  function parseAmuseParams(paramsJson) {
    if (paramsJson === null) {
      return { ok: false, reason: "no PuzzleMe params on this page" };
    }
    let parsed;
    try {
      parsed = JSON.parse(paramsJson);
    } catch {
      return { ok: false, reason: "PuzzleMe params are not JSON" };
    }
    if (typeof parsed !== "object" || parsed === null || !("rawc" in parsed)) {
      return { ok: false, reason: "PuzzleMe params carry no rawc" };
    }
    const rawc = parsed.rawc;
    if (typeof rawc !== "string" || rawc === "") {
      return { ok: false, reason: "PuzzleMe rawc is not a non-empty string" };
    }
    return { ok: true, document: rawc };
  }
  function extractRawcAssignment(scriptTexts) {
    for (const text of scriptTexts) {
      const match = RAWC_ASSIGNMENT.exec(text);
      if (match) {
        const blob = match[1] ?? match[2] ?? "";
        if (blob !== "") return { ok: true, document: blob };
      }
    }
    return { ok: false, reason: "no PuzzleMe rawc found on this page" };
  }

  // src/amuselabs/content.ts
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message?.type !== EXTRACT_REQUEST) return;
      if (!isAmuseLabsCrosswordFrame(location.href)) {
        sendResponse({ ok: false, reason: "not a PuzzleMe crossword frame" });
        return;
      }
      const params = document.querySelector(PARAMS_SCRIPT_SELECTOR);
      let result = parseAmuseParams(params ? params.textContent : null);
      if (!result.ok) {
        const inlineScripts = Array.from(
          document.querySelectorAll("script:not([src])"),
          (script) => script.textContent ?? ""
        );
        const classic = extractRawcAssignment(inlineScripts);
        if (classic.ok) result = classic;
      }
      sendResponse(respondWith("amuselabs", result));
    }
  );
})();
