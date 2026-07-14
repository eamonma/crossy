"use strict";
(() => {
  // src/messaging.ts
  var EXTRACT_REQUEST = "crossy/extract";
  function respondWith(format, result) {
    return result.ok ? { ok: true, format, document: result.document } : result;
  }

  // src/pill/logic.ts
  function shouldMountPill(site, extraction, disabled) {
    return extraction.ok && disabled[site] !== true;
  }
  var REMOUNT_DEBOUNCE_MS = 250;
  var REMOUNT_WINDOW_MS = 6e4;
  var MAX_REMOUNTS_PER_WINDOW = 3;
  function shouldRemount(removalTimesMs, nowMs) {
    const recent = removalTimesMs.filter((t) => nowMs - t < REMOUNT_WINDOW_MS);
    return recent.length <= MAX_REMOUNTS_PER_WINDOW;
  }
  var IDLE_VIEW = { kind: "idle", label: "Play in Crossy" };
  var OPENING_VIEW = {
    kind: "opening",
    label: "Opening Crossy..."
  };
  function isClickable(view) {
    return view.kind === "idle" || view.kind === "retry";
  }
  function pillViewForReply(reply) {
    if (reply.ok) return OPENING_VIEW;
    if (reply.reason === "rejected") {
      return {
        kind: "rejected",
        label: reply.code,
        title: `${reply.code}: ${reply.message}`
      };
    }
    if (reply.reason === "network") {
      return { kind: "retry", label: "Could not reach Crossy. Try again." };
    }
    return { kind: "defer", label: "Open Crossy to finish" };
  }

  // src/pill/messages.ts
  var PLAY_REQUEST = "crossy/play";

  // src/pill/toggle.ts
  var PILL_DISABLED_KEY = "pillDisabled";
  var SITES = ["guardian", "nyt"];
  function parsePillDisabled(raw) {
    if (typeof raw !== "object" || raw === null) return {};
    const disabled = {};
    for (const site of SITES) {
      if (raw[site] === true) disabled[site] = true;
    }
    return disabled;
  }
  async function loadPillDisabled() {
    const stored = await chrome.storage.local.get(PILL_DISABLED_KEY);
    return parsePillDisabled(stored[PILL_DISABLED_KEY]);
  }
  async function setPillDisabled(site, disabled) {
    const current = await loadPillDisabled();
    const next = { ...current };
    if (disabled) next[site] = true;
    else delete next[site];
    await chrome.storage.local.set({ [PILL_DISABLED_KEY]: next });
  }

  // src/pill/mount.ts
  var IDLE_RETURN_MS = 4e3;
  var HOST_Z_INDEX = 999999;
  var PILL_STYLES = `
  .pill {
    --bg: #fdfdfc;
    --text: #21201c;
    --text-muted: #63635e;
    --text-subtle: #82827c;
    --border: #dad9d6;
    --wash: #f1f0ef;
    --gold-text: #71624b;
    --danger: #ce2c31;
    --shadow: 0 2px 12px rgba(33, 32, 28, 0.14);
    --shadow-hover: 0 4px 16px rgba(33, 32, 28, 0.2);
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 320px;
    padding: 8px 8px 8px 14px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: var(--shadow);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica,
      Arial, sans-serif;
    font-size: 13px;
    line-height: 1.2;
    -webkit-font-smoothing: antialiased;
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity 180ms ease-out,
      transform 180ms ease-out,
      box-shadow 180ms ease-out;
  }
  .pill.in {
    opacity: 1;
    transform: none;
  }
  .pill:hover {
    box-shadow: var(--shadow-hover);
  }
  @media (prefers-reduced-motion: reduce) {
    .pill {
      transition: none;
    }
  }
  @media (prefers-color-scheme: dark) {
    .pill {
      --bg: #111110;
      --text: #eeeeec;
      --text-muted: #b5b3ad;
      --text-subtle: #7c7b74;
      --border: #3b3a37;
      --wash: #222221;
      --gold-text: #cbb990;
      --danger: #ff9592;
      --shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
      --shadow-hover: 0 4px 16px rgba(0, 0, 0, 0.5);
    }
  }
  button {
    appearance: none;
    margin: 0;
    border: 0;
    padding: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .play {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .play:disabled {
    cursor: default;
    color: var(--text-muted);
  }
  .play:hover:not(:disabled) {
    color: var(--gold-text);
  }
  .play .mark {
    flex: none;
    display: block;
  }
  .pill.error .play,
  .pill.error .play:disabled {
    color: var(--danger);
  }
  .hide {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--text-subtle);
    font-size: 14px;
    line-height: 1;
  }
  .hide:hover {
    background: var(--wash);
    color: var(--text);
  }
  /* Touch devices (iOS Safari, the reason the pill ships to phones): grow the hit
     areas toward the 44px finger target. The padding moves onto the buttons so the
     tap area itself grows, not just the look; the pill sheds its own inner padding
     so the shape does not balloon (the 14px mark inset holds: 8 pill + 6 play). */
  @media (pointer: coarse) {
    .pill {
      gap: 2px;
      padding: 4px 4px 4px 8px;
      font-size: 15px;
    }
    .play {
      padding: 10px 6px;
      gap: 10px;
    }
    .hide {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      font-size: 18px;
    }
  }
`;
  var MARK_SVG = `<svg class="mark" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="16" width="8" height="8" fill="currentColor"/><rect x="8" y="8" width="8" height="8" fill="currentColor"/><rect y="16" width="8" height="8" fill="currentColor"/><rect x="16" y="16" width="8" height="8" fill="#978365"/><path d="M8 0v24M16 0v24M0 8h24M0 16h24" stroke="currentColor" stroke-width="1.25" fill="none"/></svg>`;
  async function maybeMountPill(site, extract2) {
    const disabled = await loadPillDisabled();
    if (disabled[site] === true) return;
    const extraction = await extract2();
    if (!shouldMountPill(site, extraction, disabled)) return;
    if (!document.body) return;
    mountPill(site, extraction);
  }
  function mountPill(site, extraction) {
    const host = document.createElement("div");
    host.setAttribute(
      "style",
      `position: fixed; right: 16px; bottom: 16px; z-index: ${HOST_Z_INDEX}; margin: 0; padding: 0;`
    );
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${PILL_STYLES}</style><div class="pill"><button class="play" type="button">${MARK_SVG}<span class="label"></span></button><button class="hide" type="button" title="Hide on this site" aria-label="Hide on this site">&#215;</button></div>`;
    const pill = root.querySelector(".pill");
    const play = root.querySelector(".play");
    const label = root.querySelector(".label");
    const hide = root.querySelector(".hide");
    let inFlight = false;
    const render = (view) => {
      label.textContent = view.label;
      pill.classList.toggle("error", view.kind === "rejected");
      play.disabled = inFlight || !isClickable(view);
      if (view.kind === "rejected") play.title = view.title;
      else play.removeAttribute("title");
    };
    play.addEventListener("click", () => {
      if (inFlight) return;
      inFlight = true;
      render(OPENING_VIEW);
      void (async () => {
        let reply;
        try {
          reply = await chrome.runtime.sendMessage({
            type: PLAY_REQUEST,
            format: extraction.format,
            document: extraction.document
          });
        } catch {
          reply = { ok: false, reason: "network" };
        }
        inFlight = false;
        render(pillViewForReply(reply));
        if (reply.ok) {
          setTimeout(() => {
            if (!inFlight) render(IDLE_VIEW);
          }, IDLE_RETURN_MS);
        }
      })();
    });
    let removals = [];
    let remountTimer = null;
    const observer = new MutationObserver(() => {
      if (host.isConnected || remountTimer !== null) return;
      remountTimer = setTimeout(() => {
        remountTimer = null;
        if (host.isConnected) return;
        const now = Date.now();
        removals = removals.filter((t) => now - t < REMOUNT_WINDOW_MS);
        removals.push(now);
        if (!shouldRemount(removals, now)) {
          observer.disconnect();
          return;
        }
        document.body.appendChild(host);
      }, REMOUNT_DEBOUNCE_MS);
    });
    const stopObserving = () => {
      observer.disconnect();
      if (remountTimer !== null) {
        clearTimeout(remountTimer);
        remountTimer = null;
      }
    };
    hide.addEventListener("click", () => {
      stopObserving();
      host.remove();
      void setPillDisabled(site, true);
    });
    render(IDLE_VIEW);
    document.body.appendChild(host);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => pill.classList.add("in"));
    });
  }

  // src/nyt/detect.ts
  function isNytCrosswordGamePage(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname !== "www.nytimes.com") return false;
    return /^\/crosswords\/game\/[a-z]/.test(parsed.pathname);
  }
  var V6_PUZZLE_PREFIX = "/svc/crosswords/v6/puzzle/";
  function nytPuzzleEndpoint(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const match = /^\/crosswords\/game\/([a-z][a-z0-9-]*)(?:\/(\d{4})\/(\d{2})\/(\d{2}))?\/?$/.exec(
      parsed.pathname
    );
    if (match === null) return null;
    const [, stream, year, month, day] = match;
    if (year === void 0) return `${V6_PUZZLE_PREFIX}${stream}.json`;
    return `${V6_PUZZLE_PREFIX}${stream}/${year}-${month}-${day}.json`;
  }

  // src/nyt/extract.ts
  function parseNytPuzzle(responseText) {
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      return { ok: false, reason: "the NYT puzzle response is not JSON" };
    }
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, reason: "the NYT puzzle response is not an object" };
    }
    if (!Array.isArray(parsed.body)) {
      return { ok: false, reason: "the NYT puzzle response carries no body" };
    }
    return { ok: true, document: parsed };
  }

  // src/nyt/content.ts
  async function extract() {
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
          reason: `could not read the NYT puzzle (${response.status})`
        };
      }
      return respondWith("nyt", parseNytPuzzle(await response.text()));
    } catch {
      return { ok: false, reason: "could not reach the NYT puzzle" };
    }
  }
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message?.type !== EXTRACT_REQUEST) return;
      void extract().then(sendResponse);
      return true;
    }
  );
  void maybeMountPill("nyt", extract);
})();
