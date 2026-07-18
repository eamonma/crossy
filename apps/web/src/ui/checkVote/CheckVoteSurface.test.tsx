// The vote surface as static markup (react-dom/server, node env, the GameToolbar.test pattern): what
// the Proscenium OFFERS is the contract. The verbs show only to a not-yet-voted elector; the
// proposer and observers see chips but no verbs; the resolution and the proposer-only tally render
// as specified (the UX spec). Radix state is not exercised here.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckVoteSurface } from "./CheckVoteSurface";
import type { CheckVoteView } from "./useCheckVote";
import type { ElectorChip } from "./voteView";

const chips: ElectorChip[] = [
  {
    userId: "u1",
    name: "Ana",
    initial: "A",
    avatarUrl: null,
    color: "#6F66D4",
    side: "check",
    isSelf: false,
    isProposer: true,
  },
  {
    userId: "u2",
    name: "Bo",
    initial: "B",
    avatarUrl: null,
    color: "#DE5722",
    side: "undecided",
    isSelf: true,
    isProposer: false,
  },
];

function view(o: Partial<CheckVoteView> = {}): CheckVoteView {
  return {
    active: true,
    phase: "open",
    vote: null,
    role: "elector",
    chips,
    proposalText: "Ana wants to check the puzzle",
    showVerbs: true,
    pending: false,
    onApprove: () => {},
    onReject: () => {},
    resolutionText: null,
    tallyText: null,
    ring: null,
    wash: null,
    pulse: null,
    ariaMessage: "Ana wants to check the puzzle",
    reducedMotion: true,
    ...o,
  };
}

describe("the Proscenium offers the ballot to a not-yet-voted elector (the UX spec beat 2)", () => {
  it("renders the proposal line, chips, and both verbs", () => {
    const html = renderToStaticMarkup(<CheckVoteSurface view={view()} />);
    expect(html).toContain("Ana wants to check the puzzle");
    expect(html).toContain("Check it");
    expect(html).toContain("Keep solving");
  });

  it("the proposer sees chips but NO verbs (their proposal was their approval)", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface view={view({ role: "proposer", showVerbs: false })} />,
    );
    expect(html).toContain("Ana wants to check the puzzle");
    expect(html).not.toContain("Check it");
    expect(html).not.toContain("Keep solving");
  });

  it("an observer (late joiner / spectator) sees the surface read-only, no verbs", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface view={view({ role: "observer", showVerbs: false })} />,
    );
    expect(html).not.toContain("Check it");
  });

  it("a voter with a ballot in flight sees no verbs", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface view={view({ showVerbs: false, pending: true })} />,
    );
    expect(html).not.toContain("Keep solving");
  });
});

describe("resolution and recess (beats 4-5)", () => {
  it("the passed reveal shows Checking… then the to-fix count, no verbs", () => {
    const checking = renderToStaticMarkup(
      <CheckVoteSurface
        view={view({
          phase: "revealing",
          showVerbs: false,
          resolutionText: "Checking…",
        })}
      />,
    );
    expect(checking).toContain("Checking…");
    expect(checking).not.toContain("Check it");

    const toFix = renderToStaticMarkup(
      <CheckVoteSurface
        view={view({
          phase: "revealing",
          showVerbs: false,
          resolutionText: "3 to fix",
        })}
      />,
    );
    expect(toFix).toContain("3 to fix");
  });

  it("a failed recess shows the calm line, and the proposer-only tally when present", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface
        view={view({
          phase: "recess",
          showVerbs: false,
          resolutionText: "The room keeps solving",
          tallyText: "1 of 2",
        })}
      />,
    );
    expect(html).toContain("The room keeps solving");
    expect(html).toContain("1 of 2");
  });

  it("renders nothing but the live region when inactive", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface view={view({ active: false })} />,
    );
    expect(html).not.toContain("Check it");
    expect(html).not.toContain("wants to check");
  });
});
