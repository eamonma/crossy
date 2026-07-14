// requestOriginPermissions must reach permissions.request as its only browser
// call. A contains() pre-check would await before request, and Firefox rejects
// a request reached past an await: "permissions.request may only be called
// from a user input handler" (observed on a real load, 2026-07-12).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasPuzzleSitePermissions,
  playIntentUrl,
  PUZZLE_SITE_ORIGINS,
  requestOriginPermissions,
  requestPuzzleSitePermissions,
  selectPlayUrl,
} from "./settings";

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

describe("requestPuzzleSitePermissions", () => {
  it("requests every crossword origin in one direct call, no contains pre-check (Firefox gesture law)", async () => {
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
    const granted = await requestPuzzleSitePermissions();
    expect(granted).toBe(true);
    expect(calls).toEqual([{ origins: [...PUZZLE_SITE_ORIGINS] }]);
  });
});

describe("hasPuzzleSitePermissions", () => {
  it("reads the grant through permissions.contains with the crossword origins", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("chrome", {
      permissions: {
        contains: (arg: unknown) => {
          calls.push(arg);
          return Promise.resolve(false);
        },
      },
    });
    const held = await hasPuzzleSitePermissions();
    expect(held).toBe(false);
    expect(calls).toEqual([{ origins: [...PUZZLE_SITE_ORIGINS] }]);
  });
});

describe("selectPlayUrl", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const DESKTOP =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

  it("deep-links the app on iOS (the extension ships inside it there)", () => {
    expect(selectPlayUrl(IPHONE)("p_01ABC")).toBe("crossy://play/p_01ABC");
  });

  it("opens the web play intent on a browser with no app", () => {
    expect(selectPlayUrl(DESKTOP)("p_01ABC")).toBe(
      "https://crossy.party/puzzles?play=p_01ABC",
    );
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
