import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPillDisabled,
  parsePillDisabled,
  PILL_DISABLED_KEY,
  pillReSummonSite,
  pillSiteForUrl,
  setPillDisabled,
} from "./toggle";

function stubStorage(
  initial: Record<string, unknown> = {},
): Record<string, unknown> {
  const store: Record<string, unknown> = { ...initial };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: (key: string) =>
          Promise.resolve(key in store ? { [key]: store[key] } : {}),
        set: (items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        },
      },
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pill per-site toggle", () => {
  it("round-trips a disable and a re-enable per site, other sites untouched", async () => {
    stubStorage();
    await setPillDisabled("guardian", true);
    expect(await loadPillDisabled()).toEqual({ guardian: true });
    await setPillDisabled("nyt", true);
    expect(await loadPillDisabled()).toEqual({ guardian: true, nyt: true });
    await setPillDisabled("guardian", false);
    expect(await loadPillDisabled()).toEqual({ nyt: true });
  });

  it("defaults to on: an empty store disables nothing", async () => {
    stubStorage();
    expect(await loadPillDisabled()).toEqual({});
  });

  it("reads junk in storage as nothing disabled", () => {
    expect(parsePillDisabled(undefined)).toEqual({});
    expect(parsePillDisabled("nope")).toEqual({});
    expect(parsePillDisabled({ guardian: "yes", amuselabs: true })).toEqual({});
  });

  it("writes under the pinned storage key", async () => {
    const store = stubStorage();
    await setPillDisabled("nyt", true);
    expect(store[PILL_DISABLED_KEY]).toEqual({ nyt: true });
  });
});

describe("pillSiteForUrl", () => {
  it("maps a Guardian crossword page to guardian (both host forms)", () => {
    expect(
      pillSiteForUrl("https://www.theguardian.com/crosswords/quick/17012"),
    ).toBe("guardian");
    expect(
      pillSiteForUrl("https://theguardian.com/crosswords/cryptic/29001"),
    ).toBe("guardian");
  });

  it("maps an NYT crosswords game page to nyt", () => {
    expect(pillSiteForUrl("https://www.nytimes.com/crosswords/game/mini")).toBe(
      "nyt",
    );
    expect(
      pillSiteForUrl(
        "https://www.nytimes.com/crosswords/game/daily/2026/07/12",
      ),
    ).toBe("nyt");
  });

  it("returns null off the pill's content-script scope", () => {
    // NYT crosswords home, not a game page: no pill there.
    expect(pillSiteForUrl("https://www.nytimes.com/crosswords")).toBeNull();
    // A non-pill host.
    expect(
      pillSiteForUrl("https://example.com/crosswords/game/mini"),
    ).toBeNull();
    // AmuseLabs runs in the publisher iframe and grows no top-level pill (D22).
    expect(
      pillSiteForUrl("https://cdn.amuselabs.com/pmm/crossword?id=abc"),
    ).toBeNull();
    // Non-https and unparseable.
    expect(
      pillSiteForUrl("http://www.theguardian.com/crosswords/quick/1"),
    ).toBeNull();
    expect(pillSiteForUrl("not a url")).toBeNull();
  });
});

describe("pillReSummonSite", () => {
  it("names the site only on a pill page whose pill is hidden", () => {
    expect(
      pillReSummonSite("https://www.theguardian.com/crosswords/quick/1", {
        guardian: true,
      }),
    ).toBe("guardian");
  });

  it("stays null when the pill still shows there", () => {
    expect(
      pillReSummonSite("https://www.theguardian.com/crosswords/quick/1", {}),
    ).toBeNull();
    // Another site is hidden, but not this one.
    expect(
      pillReSummonSite("https://www.theguardian.com/crosswords/quick/1", {
        nyt: true,
      }),
    ).toBeNull();
  });

  it("stays null off a pill page even when sites are hidden", () => {
    expect(
      pillReSummonSite("https://example.com/", { guardian: true, nyt: true }),
    ).toBeNull();
  });
});
