// Pure check-vote derivations (PROTOCOL.md §4, §6, §10; D32; the UX spec is normative for the copy).
// The remaining-time clamp, solo detection, the elector chips, and every copy string are pinned here
// so the ceremony's semantics and words cannot drift.
import { describe, expect, it } from "vitest";
import type { Participant } from "@crossy/protocol";
import type { OpenCheckVote } from "../../store/checkVoteWire";
import {
  CHECK_VERB,
  KEEP_VERB,
  CHECKING_LINE,
  CHECK_VOTE_TTL_MS,
  chipSide,
  closeLine,
  coarseOpacityStep,
  electorChips,
  failedTallyLine,
  isSoloElector,
  proposalLine,
  proposerName,
  remainingFraction,
  remainingMs,
  toFixLine,
  voteRole,
} from "./voteView";

const vote: OpenCheckVote = {
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
    expect(proposalLine("Ana")).toBe("Ana wants to check the puzzle");
    expect(CHECK_VERB).toBe("Check it");
    expect(KEEP_VERB).toBe("Keep solving");
    expect(CHECKING_LINE).toBe("Checking…");
    expect(toFixLine(3)).toBe("3 to fix");
    expect(failedTallyLine(1, 2)).toBe("1 of 2");
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
    const withKeep: OpenCheckVote = { ...vote, rejections: ["u2"] };
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
