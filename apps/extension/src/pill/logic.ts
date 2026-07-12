// The pill's decisions, pure (the house pattern: DOM-touching code stays thin).
// The pill is an enhancement on top of the popup, which stays the invariant path
// (D22): it mounts only where an ingest can actually succeed, respects the
// per-site toggle, and never fights a page that keeps tearing it down.

import type { ExtractResponse } from "../messaging";
import type { PlayReply } from "./messages";
import type { PillDisabled, PillSite } from "./toggle";

/**
 * The mount gate: only a successful extraction on a site the solver has not
 * disabled earns a pill. Never mount on a page that cannot ingest.
 */
export function shouldMountPill(
  site: PillSite,
  extraction: ExtractResponse,
  disabled: PillDisabled,
): extraction is ExtractResponse & { ok: true } {
  return extraction.ok && disabled[site] !== true;
}

/** How long a detected removal sits before the re-append (SPA re-renders settle). */
export const REMOUNT_DEBOUNCE_MS = 250;

export const REMOUNT_WINDOW_MS = 60_000;
export const MAX_REMOUNTS_PER_WINDOW = 3;

/**
 * The give-up rule: re-append through the first few removals, but a page that
 * removes the pill more than MAX_REMOUNTS_PER_WINDOW times inside the window is
 * fighting on purpose; stop quietly. `removalTimesMs` includes the removal being
 * decided.
 */
export function shouldRemount(
  removalTimesMs: readonly number[],
  nowMs: number,
): boolean {
  const recent = removalTimesMs.filter((t) => nowMs - t < REMOUNT_WINDOW_MS);
  return recent.length <= MAX_REMOUNTS_PER_WINDOW;
}

/** What the pill renders; every outcome shows on the pill, never as page UI. */
export type PillView =
  | { readonly kind: "idle"; readonly label: string }
  | { readonly kind: "opening"; readonly label: string }
  | { readonly kind: "defer"; readonly label: string }
  | { readonly kind: "retry"; readonly label: string }
  | {
      readonly kind: "rejected";
      readonly label: string;
      readonly title: string;
    };

export const IDLE_VIEW: PillView = { kind: "idle", label: "Play in Crossy" };

export const OPENING_VIEW: PillView = {
  kind: "opening",
  label: "Opening Crossy...",
};

/** Idle and retry accept a click; every other view is terminal or in flight. */
export function isClickable(view: PillView): boolean {
  return view.kind === "idle" || view.kind === "retry";
}

export function pillViewForReply(reply: PlayReply): PillView {
  if (reply.ok) return OPENING_VIEW;
  if (reply.reason === "rejected") {
    // The named rejection: code compact on the pill, the verbatim line in the
    // tooltip (PROTOCOL.md section 12, never rewritten).
    return {
      kind: "rejected",
      label: reply.code,
      title: `${reply.code}: ${reply.message}`,
    };
  }
  if (reply.reason === "network") {
    return { kind: "retry", label: "Could not reach Crossy. Try again." };
  }
  // signed_out and no_permission: only the popup's click gesture can fix either.
  return { kind: "defer", label: "Finish in the Crossy toolbar button" };
}
