// alignmentState decides the popup's account-alignment state (auth/alignment.ts). These
// pin the four branches that keep extension-ingested puzzles landing in the account the
// user plays from on crossy.party.
import { describe, expect, it } from "vitest";
import { alignmentState } from "./alignment";
import type { WebIdentity } from "./messages";

const web: WebIdentity = {
  userId: "user-1",
  provider: "discord",
  displayName: "Ada",
};

describe("alignmentState", () => {
  it("signed out with no web account: the plain provider buttons", () => {
    expect(alignmentState(null, null)).toEqual({ kind: "signed-out" });
  });

  it("signed out but the web app is signed in: offer to continue as that account", () => {
    expect(alignmentState(null, web)).toEqual({
      kind: "connect",
      provider: "discord",
      name: "Ada",
    });
  });

  it("signed in and matching the web account: aligned", () => {
    expect(alignmentState({ userId: "user-1" }, web)).toEqual({
      kind: "aligned",
    });
  });

  it("signed in with no web account to compare: aligned (nothing to warn about)", () => {
    expect(alignmentState({ userId: "user-1" }, null)).toEqual({
      kind: "aligned",
    });
  });

  it("signed in as a DIFFERENT account than the web app: mismatch, name the web account", () => {
    expect(alignmentState({ userId: "user-2" }, web)).toEqual({
      kind: "mismatch",
      provider: "discord",
      name: "Ada",
    });
  });

  it("an unknown extension userId never fabricates a mismatch (a refresh can omit the user)", () => {
    expect(alignmentState({ userId: null }, web)).toEqual({ kind: "aligned" });
  });
});
