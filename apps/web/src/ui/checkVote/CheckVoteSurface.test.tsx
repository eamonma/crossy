// The vote surface as static markup (react-dom/server, node env, the GameToolbar.test pattern): what
// the Proscenium OFFERS is the contract. The verbs show only to a not-yet-voted elector; the
// proposer and observers see chips but no verbs; the resolution and the proposer-only tally render
// as specified (the UX spec). Radix state is not exercised here.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckVoteSurface } from "./CheckVoteSurface";
import { VoteChips } from "./VoteChips";
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
    proposal: { self: false, name: "Ana" },
    proposalText: "Ana wants to check the puzzle",
    showVerbs: true,
    pending: false,
    verbsDisabled: false,
    onApprove: () => {},
    onReject: () => {},
    resolutionText: null,
    tallyText: null,
    wash: null,
    revealedWrongCells: null,
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

  it("truncates only the NAME span, never the verb phrase (Wave 15.7)", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface
        view={view({
          proposal: { self: false, name: "A very long teammate name here" },
        })}
      />,
    );
    // The name rides its own truncate span; the verb phrase is a separate, un-truncated span so a
    // long name can never swallow the verb.
    expect(html).toContain("truncate");
    expect(html).toContain("A very long teammate name here");
    expect(html).toMatch(/wants to check the puzzle<\/span>/);
  });

  it("the proposer sees 'Waiting for the room' and NO verbs (owner ruling, no self-echo)", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface
        view={view({
          role: "proposer",
          showVerbs: false,
          proposal: { self: true },
          proposalText: "Waiting for the room",
          // The live region mirrors the corrected line, never the self-echo (owner ruling).
          ariaMessage: "Waiting for the room",
        })}
      />,
    );
    expect(html).toContain("Waiting for the room");
    expect(html).not.toContain("wants to check the puzzle");
    expect(html).not.toContain("Check it");
    expect(html).not.toContain("Keep solving");
  });

  it("an observer (late joiner / spectator) sees the surface read-only, no verbs", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface view={view({ role: "observer", showVerbs: false })} />,
    );
    expect(html).not.toContain("Check it");
  });

  it("a ballot in flight keeps the verbs mounted but disabled in place (no unmount slide)", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface
        view={view({ showVerbs: true, pending: true, verbsDisabled: true })}
      />,
    );
    // The verbs stay so the block never unmounts mid-click; they are disabled, not gone.
    expect(html).toContain("Check it");
    expect(html).toContain("Keep solving");
    expect(html).toContain("disabled");
  });

  it("a locally-expired-but-unclosed vote disables the verbs (no live verb on a lapsed vote)", () => {
    const html = renderToStaticMarkup(
      <CheckVoteSurface view={view({ verbsDisabled: true })} />,
    );
    expect(html).toContain("Check it");
    expect(html).toContain("disabled");
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

describe("VoteChips collapse to an avatar stack beyond the strip cap (Wave 15.7 mobile)", () => {
  function manyChips(n: number): ElectorChip[] {
    return Array.from({ length: n }, (_, i) => ({
      userId: `u${i}`,
      name: `Name ${i}`,
      initial: String.fromCharCode(65 + i),
      avatarUrl: null,
      color: "#6F66D4",
      side: "undecided" as const,
      isSelf: false,
      isProposer: i === 0,
    }));
  }

  it("shows every chip when under the cap", () => {
    const html = renderToStaticMarkup(
      <VoteChips chips={manyChips(3)} max={3} />,
    );
    expect(html).not.toContain("+");
  });

  it("collapses to a +N overflow beyond the cap, keeping the count honest", () => {
    const html = renderToStaticMarkup(
      <VoteChips chips={manyChips(7)} max={3} />,
    );
    // 7 electors, cap 3: two avatars plus a "+5" bubble (5 hidden), so the verbs never get pushed off.
    expect(html).toContain("+5");
  });

  it("uncapped (desktop) renders the full row with no overflow bubble", () => {
    const html = renderToStaticMarkup(<VoteChips chips={manyChips(9)} />);
    expect(html).not.toMatch(/\+\d/);
  });
});
