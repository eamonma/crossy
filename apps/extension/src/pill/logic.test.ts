// The pill is an enhancement on top of the popup, the invariant path (D22).
import { describe, expect, it } from "vitest";
import type { ExtractResponse } from "../messaging";
import {
  isClickable,
  OPENING_VIEW,
  pillViewForReply,
  REMOUNT_WINDOW_MS,
  shouldMountPill,
  shouldRemount,
} from "./logic";

const OK_EXTRACTION: ExtractResponse = {
  ok: true,
  format: "guardian",
  document: { some: "document" },
};

describe("shouldMountPill", () => {
  it("mounts only after an ok extraction, never on a page that cannot ingest (D22)", () => {
    expect(shouldMountPill("guardian", OK_EXTRACTION, {})).toBe(true);
    expect(
      shouldMountPill(
        "guardian",
        { ok: false, reason: "not a Guardian crossword page" },
        {},
      ),
    ).toBe(false);
  });

  it("never mounts on a site the solver disabled", () => {
    const nytExtraction: ExtractResponse = {
      ok: true,
      format: "nyt",
      document: {},
    };
    expect(shouldMountPill("nyt", nytExtraction, { nyt: true })).toBe(false);
    expect(shouldMountPill("nyt", nytExtraction, { guardian: true })).toBe(
      true,
    );
  });
});

describe("shouldRemount", () => {
  it("re-appends through the first few removals in a minute", () => {
    expect(shouldRemount([0], 0)).toBe(true);
    expect(shouldRemount([0, 1_000, 2_000], 2_000)).toBe(true);
  });

  it("gives up quietly once the page tears the pill down too often", () => {
    expect(shouldRemount([0, 1_000, 2_000, 3_000], 3_000)).toBe(false);
  });

  it("forgets removals older than the window", () => {
    const later = REMOUNT_WINDOW_MS + 5_000;
    expect(shouldRemount([0, 1_000, 2_000, later], later)).toBe(true);
  });
});

describe("pillViewForReply", () => {
  it("success shows the brief opening state, not clickable while the tab opens", () => {
    const view = pillViewForReply({ ok: true });
    expect(view).toBe(OPENING_VIEW);
    expect(view.label).toBe("Opening Crossy...");
    expect(isClickable(view)).toBe(false);
  });

  it("defers to the toolbar popup on signed_out and on a missing API grant", () => {
    for (const reason of ["signed_out", "no_permission"] as const) {
      const view = pillViewForReply({ ok: false, reason });
      expect(view.kind).toBe("defer");
      expect(view.label).toBe("Finish in the Crossy toolbar button");
      expect(isClickable(view)).toBe(false);
    }
  });

  it("keeps the named rejection verbatim: code compact, full line in the tooltip (PROTOCOL.md section 12)", () => {
    const view = pillViewForReply({
      ok: false,
      reason: "rejected",
      code: "UNSUPPORTED_FORMAT",
      message: "the server's exact words",
    });
    expect(view).toEqual({
      kind: "rejected",
      label: "UNSUPPORTED_FORMAT",
      title: "UNSUPPORTED_FORMAT: the server's exact words",
    });
    expect(isClickable(view)).toBe(false);
  });

  it("a transient failure invites a retry, pill clickable again", () => {
    const view = pillViewForReply({ ok: false, reason: "network" });
    expect(view.kind).toBe("retry");
    expect(view.label).toBe("Could not reach Crossy. Try again.");
    expect(isClickable(view)).toBe(true);
  });
});
