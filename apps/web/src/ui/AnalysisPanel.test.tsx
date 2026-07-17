// The Analysis legend's isolation contract as rendered markup (react-dom/server runs clean under
// the node test environment; no jsdom, the GameToolbar.test.tsx idiom): with isolation wired each
// legend row is a REAL toggle button (keyboard operable for free) carrying aria-pressed, and the
// pressed row is exactly the isolated solver. Without the wiring the legend stays the plain rows
// it always was, so a panel with no mosaic to drive renders byte-identical to before. The toggle
// arithmetic itself (tap isolates, same tap clears, another tap switches) lives in
// mosaicIsolation.test.ts; this covers the row's rendered contract.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnalysisPanel } from "./AnalysisPanel";
import type { AnalysisResponse } from "./completionAttribution";
import type { StackMember } from "./primitives";

const bundle: AnalysisResponse = {
  owners: { 0: "u-1", 1: "u-2", 2: "u-1" },
  momentum: {
    durationSeconds: 90,
    samples: Array.from({ length: 40 }, () => 0.5),
  },
  moments: { firstToFall: null, lastSquare: null, turningPoint: null },
  sequence: [],
  titles: [],
};

function member(userId: string, name: string, color: string): StackMember {
  return {
    userId,
    name,
    initial: name.slice(0, 1),
    avatarUrl: null,
    color,
    connected: true,
    role: "solver",
  };
}

const members = [
  member("u-1", "Ada", "#3e63dd"),
  member("u-2", "Brin", "#e5484d"),
];

describe("the legend's isolation rows (owner ruling: tap a solver to spotlight their squares)", () => {
  it("renders each legend row as a toggle button with aria-pressed when isolation is wired", () => {
    const html = renderToStaticMarkup(
      <AnalysisPanel
        bundle={bundle}
        members={members}
        selfId={null}
        idBase="t"
        isolation={{ isolatedId: null, onToggle: () => {} }}
      />,
    );
    // Two owning solvers, two rows, both unpressed while nothing is isolated.
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(2);
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("presses exactly the isolated solver's row (quiet selected state, the same row a tap clears)", () => {
    const html = renderToStaticMarkup(
      <AnalysisPanel
        bundle={bundle}
        members={members}
        selfId={null}
        idBase="t"
        isolation={{ isolatedId: "u-2", onToggle: () => {} }}
      />,
    );
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(1);
    // The pressed button is Brin's: the true row carries the name.
    const pressed = /<button[^>]*aria-pressed="true"[^>]*>.*?<\/button>/.exec(
      html,
    );
    expect(pressed?.[0]).toContain("Brin");
  });

  it("self-isolation is just your own row: the self row ('You') is the pressed one", () => {
    const html = renderToStaticMarkup(
      <AnalysisPanel
        bundle={bundle}
        members={members}
        selfId="u-1"
        idBase="t"
        isolation={{ isolatedId: "u-1", onToggle: () => {} }}
      />,
    );
    const pressed = /<button[^>]*aria-pressed="true"[^>]*>.*?<\/button>/.exec(
      html,
    );
    expect(pressed?.[0]).toContain("You");
  });

  it("without isolation wiring the legend keeps its plain rows (no buttons, no aria-pressed)", () => {
    const html = renderToStaticMarkup(
      <AnalysisPanel
        bundle={bundle}
        members={members}
        selfId={null}
        idBase="t"
      />,
    );
    expect(html).not.toContain("aria-pressed");
  });
});

describe("the Time stat's sittings context (D29: count is context at 2+, never a second stat)", () => {
  it("renders the quiet 'N sittings' context under the time when the room sat down twice", () => {
    const html = renderToStaticMarkup(
      <AnalysisPanel
        bundle={{
          ...bundle,
          sittings: {
            count: 2,
            spans: [
              { startSeconds: 0, endSeconds: 45 },
              { startSeconds: 45, endSeconds: 90 },
            ],
            wallSeconds: 29160,
          },
        }}
        members={members}
        selfId={null}
        idBase="t"
      />,
    );
    expect(html).toContain("2 sittings");
    // Wall clock is flavor only, never a competing stat: the old 8:06:00 span appears nowhere.
    expect(html).not.toContain("8:06:00");
  });

  it("renders no suffix for a single sitting: markup identical to a bundle without the field", () => {
    const single = renderToStaticMarkup(
      <AnalysisPanel
        bundle={{
          ...bundle,
          sittings: {
            count: 1,
            spans: [{ startSeconds: 0, endSeconds: 90 }],
            wallSeconds: 90,
          },
        }}
        members={members}
        selfId={null}
        idBase="t"
      />,
    );
    const absent = renderToStaticMarkup(
      <AnalysisPanel
        bundle={bundle}
        members={members}
        selfId={null}
        idBase="t"
      />,
    );
    expect(single).toBe(absent);
    expect(single).not.toContain("sittings");
  });
});
