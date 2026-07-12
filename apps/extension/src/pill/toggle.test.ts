import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPillDisabled,
  parsePillDisabled,
  PILL_DISABLED_KEY,
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
