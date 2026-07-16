// The popover bodies as static markup (react-dom/server runs clean under the node test
// environment; no jsdom): what each surface OFFERS is the contract under test —
// end-game's migration out of Share, the party row's unconditional presence (R3), and the
// check row's gate states (design doc room-actions-control.md §5). Radix state (open
// popovers, dialogs) is not exercised here; the row derivations behind these bodies are
// covered in roomActions.test.ts.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomActionsPanel, SharePanel } from "./GameToolbar";
import type { RoomActions, RoomAdmin } from "./GameToolbar";

const admin: RoomAdmin = {
  apiBase: "https://api.example",
  gameId: "g1",
  bearer: {
    getToken: () => Promise.resolve("t"),
    refresh: () => Promise.resolve(null),
  },
};

function actions(overrides: Partial<RoomActions> = {}): RoomActions {
  return {
    status: "ongoing",
    spectator: false,
    sync: "live",
    emptyCount: 0,
    checkCount: 0,
    onCheckPuzzle: () => true,
    ...overrides,
  };
}

describe("the Share popover keeps only invite concerns plus party (design doc R3, §2)", () => {
  it("carries the party row whenever the toolbar wires it: the panel takes no game status, so a completed or abandoned room reaches the projector too (R3)", () => {
    const html = renderToStaticMarkup(
      <SharePanel shareUrl={null} inviteCode={null} onEnterParty={() => {}} />,
    );
    expect(html).toContain("Party mode");
  });

  it("no longer carries End game: it moved to the room-actions popover (§2, R3)", () => {
    const html = renderToStaticMarkup(
      <SharePanel
        shareUrl="https://crossy.party/g/ABCDEFGH"
        inviteCode="ABCDEFGH"
        onEnterParty={() => {}}
      />,
    );
    expect(html).not.toContain("End game");
  });

  it("drops the party row where no toggle exists (no dead rows)", () => {
    const html = renderToStaticMarkup(
      <SharePanel shareUrl={null} inviteCode={null} />,
    );
    expect(html).not.toContain("Party mode");
  });
});

describe("the room-actions panel (design doc §5)", () => {
  it("disables the check row below a full grid, with the quiet remaining-cells hint", () => {
    const html = renderToStaticMarkup(
      <RoomActionsPanel
        actions={actions({ emptyCount: 3 })}
        admin={admin}
        hostHere={false}
      />,
    );
    expect(html).toContain("Check puzzle");
    // The rendered attribute, not the utility classes that merely style the state.
    expect(html).toContain('disabled=""');
    expect(html).toContain("3 cells empty");
  });

  it("enables the check row on a full grid: no hint stands", () => {
    const html = renderToStaticMarkup(
      <RoomActionsPanel actions={actions()} admin={admin} hostHere={false} />,
    );
    expect(html).toContain("Check puzzle");
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("cells empty");
  });

  it("shows the neutral checked-count record once checks exist (R10)", () => {
    const html = renderToStaticMarkup(
      <RoomActionsPanel
        actions={actions({ checkCount: 2 })}
        admin={admin}
        hostHere={false}
      />,
    );
    expect(html).toContain("Checked 2 times");
  });

  it("host-only End game rides under the separator; a solver never sees it", () => {
    const host = renderToStaticMarkup(
      <RoomActionsPanel actions={actions()} admin={admin} hostHere={true} />,
    );
    const solver = renderToStaticMarkup(
      <RoomActionsPanel actions={actions()} admin={admin} hostHere={false} />,
    );
    expect(host).toContain("End game");
    expect(solver).not.toContain("End game");
  });
});
