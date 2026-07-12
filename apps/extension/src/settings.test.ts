// requestOriginPermissions must reach permissions.request as its only browser
// call. A contains() pre-check would await before request, and Firefox rejects
// a request reached past an await: "permissions.request may only be called
// from a user input handler" (observed on a real load, 2026-07-12).
import { afterEach, describe, expect, it, vi } from "vitest";
import { playIntentUrl, requestOriginPermissions } from "./settings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestOriginPermissions", () => {
  it("maps bases to origin patterns in one direct request, no contains pre-check (Firefox gesture law)", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("chrome", {
      permissions: {
        request: (arg: unknown) => {
          calls.push(arg);
          return Promise.resolve(true);
        },
        contains: () => {
          throw new Error(
            "contains() must not be called: the await unwinds the Firefox gesture",
          );
        },
      },
    });
    const granted = await requestOriginPermissions([
      "https://rest.crossy.party",
      "http://localhost:3000",
    ]);
    expect(granted).toBe(true);
    expect(calls).toEqual([
      { origins: ["https://rest.crossy.party/*", "http://localhost/*"] },
    ]);
  });
});

describe("playIntentUrl", () => {
  it("targets the web app's play intent and URL-encodes the id", () => {
    expect(playIntentUrl("p_01ABC")).toBe(
      "https://crossy.party/puzzles?play=p_01ABC",
    );
    expect(playIntentUrl("a/b&c")).toBe(
      "https://crossy.party/puzzles?play=a%2Fb%26c",
    );
  });
});
