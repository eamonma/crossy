// The completion overlay's action row (SHARE.md wave S1): the Share card action rides
// beside Copy link only when the caller wires it (the analysis bundle is ready);
// absent, the row is exactly the two actions it always had. Rendered markup through
// react-dom/server (node-clean, the GameToolbar.test.tsx idiom); the confetti canvas
// is an effect and never runs under static render.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompletionOverlay } from "./Completion";
import type { StackMember } from "./primitives";
import type { AnalysisResponse } from "./completionAttribution";

const members: StackMember[] = [
  {
    userId: "u-1",
    name: "Ada",
    initial: "A",
    avatarUrl: null,
    color: "#3e63dd",
    connected: true,
    role: "solver",
  },
];

const bundle: AnalysisResponse = {
  owners: { 0: "u-1" },
  momentum: { durationSeconds: 90, samples: [] },
  moments: { firstToFall: null, lastSquare: null, turningPoint: null },
  sequence: [],
  titles: [],
};

function overlay(share: boolean, copyShareLink = false): string {
  return renderToStaticMarkup(
    <CompletionOverlay
      stats={null}
      fallbackSeconds={12}
      title="Friday night"
      members={members}
      selfId="u-1"
      shareUrl="https://crossy.ing/ABCDEF"
      onCopyShareLink={
        copyShareLink
          ? () => Promise.resolve("https://crossy.ing/s/abc")
          : undefined
      }
      share={
        share
          ? {
              bundle,
              members: [{ userId: "u-1", name: "Ada", color: "#3e63dd" }],
              cols: 2,
              rows: 2,
              blocks: [],
              puzzleTitle: null,
              puzzleAuthor: null,
              roomName: "Friday night",
              gameId: "g-1",
            }
          : undefined
      }
      onDismiss={() => {}}
      onHome={() => {}}
    />,
  );
}

describe("the completion overlay's Share card action (SHARE.md wave S1)", () => {
  it("renders Share card beside Copy link when the share input is wired", () => {
    const html = overlay(true);
    expect(html).toContain("Share card");
    expect(html).toContain("Copy link");
  });

  it("renders only the standing actions when no share input exists (bundle not ready)", () => {
    const html = overlay(false);
    expect(html).not.toContain("Share card");
    expect(html).toContain("Copy link");
  });
});

describe("the completion overlay's Copy share link action (SHARE.md wave S2)", () => {
  it("renders Copy share link only when the caller wires the mint", () => {
    const wired = overlay(true, true);
    expect(wired).toContain("Copy share link");
    // The invite Copy link and the share Copy share link are distinct actions, both present.
    expect(wired).toContain("Copy link");
  });

  it("omits Copy share link when the mint is not wired (the standing actions only)", () => {
    const html = overlay(true, false);
    expect(html).not.toContain("Copy share link");
    expect(html).toContain("Copy link");
  });
});
