// The party view's pure logic: the progress race bar counts fills honestly (INV-6, no
// solution), and the QR points at the game's join-as-solver invite link, never at another
// projector screen.
import { describe, expect, it } from "vitest";
import { partyProgress } from "./partyProgress";
import { buildShareUrl } from "../domain/invite";
import type { Clue } from "../domain/types";

const across: Clue[] = [
  { number: 1, direction: "across", cells: [0, 1, 2] },
  { number: 4, direction: "across", cells: [3, 4] },
];
const down: Clue[] = [{ number: 1, direction: "down", cells: [0, 5] }];

describe("partyProgress (fill-based progress, INV-6: measured without a solution)", () => {
  it("counts a clue solved only when every one of its cells is filled", () => {
    // 1A complete (0,1,2); 4A missing cell 4; 1D missing cell 5.
    const filled = new Set([0, 1, 2, 3]);
    expect(partyProgress(across, down, filled)).toEqual({
      solved: 1,
      total: 3,
      ratio: 1 / 3,
    });
  });

  it("reaches a full ratio once every clue is filled", () => {
    const filled = new Set([0, 1, 2, 3, 4, 5]);
    expect(partyProgress(across, down, filled)).toEqual({
      solved: 3,
      total: 3,
      ratio: 1,
    });
  });

  it("never divides by zero on a clueless puzzle", () => {
    expect(partyProgress([], [], new Set())).toEqual({
      solved: 0,
      total: 0,
      ratio: 0,
    });
  });
});

describe("party QR target (the QR joins as a solver, never opens another projector)", () => {
  it("encodes the plain invite link and carries no party flag", () => {
    const url = buildShareUrl({
      origin: "https://crossy.me",
      gameId: "g-1",
      code: "ABCD2345",
      name: "Sunday Stumper",
    });
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe("/game/g-1");
    expect(parsed.searchParams.get("code")).toBe("ABCD2345");
    expect(parsed.searchParams.get("party")).toBeNull();
  });
});
