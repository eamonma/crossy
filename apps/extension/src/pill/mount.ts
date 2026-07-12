// The inline "Play in Crossy" pill (D22): an enhancement on top of the popup,
// which stays the invariant path. Top-level publisher pages only (Guardian, NYT);
// the AmuseLabs adapter runs inside the publisher's iframe and never grows pill
// logic. The pill lives in an open shadow root on a body-appended host so page
// styles cannot bleed in and these cannot bleed out; the styles are inlined here
// because ui.css must never be injected into the page. Every outcome renders ON
// the pill, never as page-level UI. Decisions live in logic.ts; this file is the
// thin DOM layer.

import type { ExtractResponse } from "../messaging";
import {
  IDLE_VIEW,
  isClickable,
  OPENING_VIEW,
  pillViewForReply,
  REMOUNT_DEBOUNCE_MS,
  REMOUNT_WINDOW_MS,
  shouldMountPill,
  shouldRemount,
} from "./logic";
import type { PillView } from "./logic";
import { PLAY_REQUEST } from "./messages";
import type { PlayReply, PlayRequest } from "./messages";
import { loadPillDisabled, setPillDisabled } from "./toggle";
import type { PillSite } from "./toggle";

/** After a success the new tab takes over; return to idle quietly for a comeback. */
const IDLE_RETURN_MS = 4000;

// High enough to clear ordinary page chrome, deliberately short of the 2^31 - 1
// arms race: a page that wants to cover the pill wins, and that is fine.
const HOST_Z_INDEX = 999999;

// ui.css tokens (Sand neutral, one Gold accent), copied by value: the shadow root
// cannot see the page's or the popup's custom properties, by design.
const PILL_STYLES = `
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
`;

// The 3x3 brand mark at pill scale; currentColor tracks the label, gold is gold.
const MARK_SVG = `<svg class="mark" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="16" width="8" height="8" fill="currentColor"/><rect x="8" y="8" width="8" height="8" fill="currentColor"/><rect y="16" width="8" height="8" fill="currentColor"/><rect x="16" y="16" width="8" height="8" fill="#978365"/><path d="M8 0v24M16 0v24M0 8h24M0 16h24" stroke="currentColor" stroke-width="1.25" fill="none"/></svg>`;

/**
 * The document_idle entry point for a top-level adapter: mount only after the
 * page's own extraction succeeds and only where the solver has not hidden the
 * pill (logic.ts). The extraction is captured once and rides the play click.
 */
export async function maybeMountPill(
  site: PillSite,
  extract: () => Promise<ExtractResponse>,
): Promise<void> {
  const disabled = await loadPillDisabled();
  if (disabled[site] === true) return;
  const extraction = await extract();
  if (!shouldMountPill(site, extraction, disabled)) return;
  if (!document.body) return;
  mountPill(site, extraction);
}

function mountPill(
  site: PillSite,
  extraction: ExtractResponse & { ok: true },
): void {
  const host = document.createElement("div");
  // Inline host styles, not :host rules: page stylesheets outrank :host, and the
  // corner placement has to survive whatever the page declares.
  host.setAttribute(
    "style",
    `position: fixed; right: 16px; bottom: 16px; z-index: ${HOST_Z_INDEX}; margin: 0; padding: 0;`,
  );
  const root = host.attachShadow({ mode: "open" });
  // Static markup only; every dynamic string lands via textContent or title.
  root.innerHTML = `<style>${PILL_STYLES}</style><div class="pill"><button class="play" type="button">${MARK_SVG}<span class="label"></span></button><button class="hide" type="button" title="Hide on this site" aria-label="Hide on this site">&#215;</button></div>`;
  const pill = root.querySelector(".pill") as HTMLDivElement;
  const play = root.querySelector(".play") as HTMLButtonElement;
  const label = root.querySelector(".label") as HTMLSpanElement;
  const hide = root.querySelector(".hide") as HTMLButtonElement;

  let inFlight = false;

  const render = (view: PillView): void => {
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
      let reply: PlayReply;
      try {
        reply = (await chrome.runtime.sendMessage({
          type: PLAY_REQUEST,
          format: extraction.format,
          document: extraction.document,
        } satisfies PlayRequest)) as PlayReply;
      } catch {
        // The worker was unreachable; same face as any transient failure.
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

  // Re-mount on SPA re-renders: watch for the host leaving the DOM, debounce the
  // re-append, and give up quietly once the page has torn it down too often
  // (shouldRemount). The isConnected check leads because this callback fires for
  // every page mutation and must stay cheap.
  let removals: number[] = [];
  let remountTimer: ReturnType<typeof setTimeout> | null = null;
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
  const stopObserving = (): void => {
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
    subtree: true,
  });
  // Two frames so the initial state paints before the entrance transition runs.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => pill.classList.add("in"));
  });
}
