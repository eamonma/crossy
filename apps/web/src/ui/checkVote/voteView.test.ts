// Pure check-vote derivations (PROTOCOL.md §4, §6, §10; D32; the UX spec is normative for the copy).
// The remaining-time clamp, solo detection, the elector chips, and every copy string are pinned here
// so the ceremony's semantics and words cannot drift.
import { describe, expect, it } from "vitest";
import type { CheckVoteView, Participant } from "@crossy/protocol";
import {
  CHECK_VERB,
  CHECK_VERB_INK,
  KEEP_VERB,
  CHECKING_LINE,
  CHECK_VOTE_TTL_MS,
  WAITING_LINE,
  REVEAL_BREATH_MS,
  chipSide,
  closeLine,
  coarseOpacityStep,
  contrastRatio,
  electorChips,
  failedTallyLine,
  isSoloElector,
  meridianPath,
  proposalLine,
  proposalSubject,
  proposerName,
  remainingFraction,
  remainingMs,
  ringDashOffset,
  toFixLine,
  voteRole,
  washPerCellMs,
  washSchedule,
} from "./voteView";

// gold-9 is theme-fixed (#978365 in both light and dark), so a single ink choice defends AA in both.
const GOLD_9 = "#978365";

const vote: CheckVoteView = {
  openedSeq: 31,
  by: "u1",
  electorate: ["u1", "u2", "u3"],
  approvals: ["u1"],
  rejections: [],
  needed: 2,
  expiresAt: "2026-07-07T19:31:40Z",
};

function participant(
  o: Partial<Participant> & { userId: string },
): Participant {
  return {
    displayName: o.userId,
    avatarUrl: null,
    color: "#6F66D4",
    role: "solver",
    connected: true,
    ...o,
  };
}

describe("the UX spec copy strings (shipped verbatim)", () => {
  it("the proposal line, verbs, and resolution lines are exact", () => {
    expect(proposalLine({ self: false, name: "Ana" })).toBe(
      "Ana wants to check the puzzle",
    );
    expect(CHECK_VERB).toBe("Check it");
    expect(KEEP_VERB).toBe("Keep solving");
    // The single ellipsis character, not three periods (owner ruling).
    expect(CHECKING_LINE).toBe("Checking…");
    expect(toFixLine(3)).toBe("3 to fix");
    expect(failedTallyLine(1, 2)).toBe("1 of 2");
  });

  it("the proposer's own line is 'Waiting for the room', no self-echo (owner ruling)", () => {
    expect(proposalLine({ self: true })).toBe("Waiting for the room");
    expect(WAITING_LINE).toBe("Waiting for the room");
  });

  it("the calm close lines, per outcome and reason", () => {
    expect(closeLine("failed", "REJECTED")).toBe("The room keeps solving");
    expect(closeLine("failed", "EXPIRED")).toBe("The vote lapsed");
    expect(closeLine("cancelled", "GRID_BROKEN")).toBe(
      "Vote ended, the grid changed",
    );
    // TERMINAL needs no line (completion / abandon UI supersedes); passed is not a calm line.
    expect(closeLine("cancelled", "TERMINAL")).toBeNull();
    expect(closeLine("passed", undefined)).toBeNull();
  });
});

describe("§10 remaining time clamps to [0, TTL] (clock skew is never trusted)", () => {
  const expiresAt = "2026-07-07T19:31:40Z";
  const at = Date.parse(expiresAt);
  it("mid-window returns the true remainder", () => {
    expect(remainingMs(expiresAt, at - 10_000)).toBe(10_000);
  });
  it("past expiry clamps to 0, never negative", () => {
    expect(remainingMs(expiresAt, at + 5_000)).toBe(0);
  });
  it("a future beyond the TTL clamps to the TTL (a skewed clock cannot overfill the ring)", () => {
    expect(remainingMs(expiresAt, at - 999_999)).toBe(CHECK_VOTE_TTL_MS);
  });
  it("a malformed expiresAt reads as expired", () => {
    expect(remainingMs("not-a-date", at)).toBe(0);
  });
  it("the fraction runs 1 down to 0", () => {
    expect(remainingFraction(expiresAt, at - CHECK_VOTE_TTL_MS)).toBe(1);
    expect(remainingFraction(expiresAt, at)).toBe(0);
  });
});

describe("reduced-motion ring steps down in coarse opacity intervals", () => {
  it("quantizes the drain fraction up to the next 1/steps", () => {
    expect(coarseOpacityStep(1)).toBe(1);
    expect(coarseOpacityStep(0.76, 4)).toBe(1);
    expect(coarseOpacityStep(0.5, 4)).toBe(0.5);
    expect(coarseOpacityStep(0.1, 4)).toBe(0.25);
    expect(coarseOpacityStep(0, 4)).toBe(0);
  });
});

describe("solo detection: solo when the only connected host/solver is self (the UX spec)", () => {
  it("is solo when self is the lone connected elector", () => {
    const ps = [
      participant({ userId: "u1", role: "host" }),
      participant({ userId: "u2", role: "spectator" }),
      participant({ userId: "u3", role: "solver", connected: false }),
    ];
    expect(isSoloElector(ps, "u1")).toBe(true);
  });
  it("is not solo when another connected elector exists", () => {
    const ps = [
      participant({ userId: "u1", role: "host" }),
      participant({ userId: "u2", role: "solver" }),
    ];
    expect(isSoloElector(ps, "u1")).toBe(false);
  });
  it("is not solo for a spectator self (never proposes)", () => {
    const ps = [
      participant({ userId: "u1", role: "solver" }),
      participant({ userId: "s1", role: "spectator" }),
    ];
    expect(isSoloElector(ps, "s1")).toBe(false);
  });
});

describe("§6 roles and chips (the room reads faces, not numbers)", () => {
  it("classifies proposer, elector, and observer", () => {
    expect(voteRole(vote, "u1")).toBe("proposer");
    expect(voteRole(vote, "u2")).toBe("elector");
    expect(voteRole(vote, "spectator")).toBe("observer");
  });

  it("the proposer chip is pre-settled to the check side; others start undecided", () => {
    expect(chipSide(vote, "u1")).toBe("check");
    expect(chipSide(vote, "u2")).toBe("undecided");
    const withKeep: CheckVoteView = { ...vote, rejections: ["u2"] };
    expect(chipSide(withKeep, "u2")).toBe("keep");
  });

  it("builds chips in electorate order, resolving identity and marking self/proposer", () => {
    const ps = [
      participant({ userId: "u1", displayName: "Ana", color: "#111111" }),
      participant({ userId: "u2", displayName: "Bo" }),
    ];
    const chips = electorChips({ ...vote, rejections: ["u2"] }, ps, "u2");
    expect(chips.map((c) => c.userId)).toEqual(["u1", "u2", "u3"]);
    expect(chips[0]).toMatchObject({
      isProposer: true,
      side: "check",
      name: "Ana",
      initial: "A",
    });
    expect(chips[1]).toMatchObject({ isSelf: true, side: "keep", name: "Bo" });
    // A departed elector still shows (the electorate is frozen), with a placeholder identity.
    expect(chips[2]).toMatchObject({ side: "undecided", name: "Player" });
  });

  it("names the proposer, You for self", () => {
    const ps = [participant({ userId: "u1", displayName: "Ana" })];
    expect(proposerName(vote, ps, "u2")).toBe("Ana");
    expect(proposerName(vote, ps, "u1")).toBe("You");
  });
});

describe("subject-aware proposal copy (owner ruling: the proposer never self-echoes)", () => {
  it("the proposer sees the self subject; everyone else sees the named subject", () => {
    const ps = [participant({ userId: "u1", displayName: "Ana" })];
    expect(proposalSubject(vote, ps, "u1")).toEqual({ self: true });
    expect(proposalSubject(vote, ps, "u2")).toEqual({
      self: false,
      name: "Ana",
    });
  });

  it("falls back to 'A teammate' for a missing or empty display name", () => {
    // Departed proposer (no participant row).
    expect(proposalSubject(vote, [], "u2")).toEqual({
      self: false,
      name: "A teammate",
    });
    // Present but blank display name is guarded, never rendered as an empty verb-less line.
    const blank = [participant({ userId: "u1", displayName: "   " })];
    expect(proposalSubject(vote, blank, "u2")).toEqual({
      self: false,
      name: "A teammate",
    });
  });
});

describe("the reveal wash schedule (timings are verified correct; do not change)", () => {
  it("per-cell stagger is min(60, 500/(n-1)), zero for a lone cell", () => {
    expect(washPerCellMs(1)).toBe(0);
    expect(washPerCellMs(2)).toBe(60); // 500/1 clamped to the 60 ms ceiling
    expect(washPerCellMs(9)).toBe(60); // 500/8 = 62.5, still clamped
    expect(washPerCellMs(11)).toBe(50); // 500/10 falls below the ceiling
  });

  it("each step delays by the breath plus its rank's stagger, sorted ascending", () => {
    const steps = washSchedule([34, 7, 96]);
    expect(steps.map((s) => s.cell)).toEqual([7, 34, 96]);
    const per = washPerCellMs(3); // 250, clamped to 60
    expect(per).toBe(60);
    expect(steps[0]!.delayMs).toBe(REVEAL_BREATH_MS);
    expect(steps[1]!.delayMs).toBe(REVEAL_BREATH_MS + 60);
    expect(steps[2]!.delayMs).toBe(REVEAL_BREATH_MS + 120);
  });
});

describe("the Meridian ring geometry and drain (Wave 15.7)", () => {
  it("draws a parallel-offset rounded rect starting at the top-center seam", () => {
    // w=200,h=100,weight=2: inset box is 198x98 from (1,1); top-center is (100,1).
    const d = meridianPath(200, 100, 9, 2);
    expect(d.startsWith("M 100 1 ")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
  });

  it("drains clockwise from the seam: the glow occupies [1-fraction, 1] via a negative offset", () => {
    // Full time reads as a whole ring (offset 0); as it drains the offset runs to -1 (empty at seam).
    expect(ringDashOffset(1, false)).toBe(0);
    expect(ringDashOffset(0.25, false)).toBeCloseTo(-0.75);
    expect(ringDashOffset(0, false)).toBe(-1);
  });

  it("reduced motion holds the ring whole (offset 0) regardless of fraction", () => {
    expect(ringDashOffset(0.25, true)).toBe(0);
    expect(ringDashOffset(0, true)).toBe(0);
  });
});

describe("optimistic self settle from a pending ballot (the store's promise)", () => {
  it("settles the self chip from a pending ballot before the echo lands", () => {
    const ps = [
      participant({ userId: "u1", displayName: "Ana" }),
      participant({ userId: "u2", displayName: "Bo" }),
    ];
    const chips = electorChips(vote, ps, "u2", {
      kind: "ballot",
      approve: false,
    });
    // Self (u2) has no wire ballot yet, but the pending keep settles the chip in place.
    expect(chips.find((c) => c.userId === "u2")!.side).toBe("keep");
    // A pending approve settles to the check side.
    const approved = electorChips(vote, ps, "u2", {
      kind: "ballot",
      approve: true,
    });
    expect(approved.find((c) => c.userId === "u2")!.side).toBe("check");
  });

  it("never overrides a wire-settled side, and never touches a non-self chip", () => {
    const ps = [participant({ userId: "u1" }), participant({ userId: "u2" })];
    const withKeep: CheckVoteView = { ...vote, rejections: ["u2"] };
    const chips = electorChips(withKeep, ps, "u2", {
      kind: "ballot",
      approve: true,
    });
    expect(chips.find((c) => c.userId === "u2")!.side).toBe("keep"); // wire wins
    // u3 is undecided and not self: a pending propose intent leaves it dimmed.
    const propose = electorChips(vote, ps, "u1", {
      kind: "propose",
    });
    expect(propose.find((c) => c.userId === "u3")!.side).toBe("undecided");
  });
});

describe("INV-10 AA contrast on the ceremony's primary control (Wave 15.7 audit)", () => {
  it("the contrast helper matches the audited white-on-gold ratio", () => {
    // The audit measured 12px white on gold-9 at 3.65:1, failing AA.
    expect(contrastRatio("#ffffff", GOLD_9)).toBeCloseTo(3.65, 1);
  });

  it("the Check verb ink clears AA (>= 4.5:1) on the gold-9 fill", () => {
    expect(contrastRatio(CHECK_VERB_INK, GOLD_9)).toBeGreaterThanOrEqual(4.5);
  });
});
