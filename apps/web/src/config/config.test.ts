import { describe, expect, it } from "vitest";
import {
  configFromEnv,
  loadConfig,
  parseConfig,
  type AppConfig,
} from "./config";

/** A fetch stub that resolves to a Response-like with the given ok flag and json result. */
function fakeFetch(res: {
  ok: boolean;
  json: () => Promise<unknown>;
}): typeof fetch {
  return (() => Promise.resolve(res)) as unknown as typeof fetch;
}

describe("parseConfig", () => {
  it("returns null for a non-object payload", () => {
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig("nope")).toBeNull();
    expect(parseConfig(42)).toBeNull();
  });

  it("coerces guestsEnabled from a boolean or a stringified flag", () => {
    expect(parseConfig({ guestsEnabled: true })?.guestsEnabled).toBe(true);
    expect(parseConfig({ guestsEnabled: "true" })?.guestsEnabled).toBe(true);
    expect(parseConfig({ guestsEnabled: "1" })?.guestsEnabled).toBe(true);
    expect(parseConfig({ guestsEnabled: "false" })?.guestsEnabled).toBe(false);
    expect(parseConfig({ guestsEnabled: "0" })?.guestsEnabled).toBe(false);
    expect(parseConfig({})?.guestsEnabled).toBe(false);
  });

  it("keeps turnstileSiteKey only when non-empty", () => {
    expect(parseConfig({})?.turnstileSiteKey).toBeUndefined();
    expect(
      parseConfig({ turnstileSiteKey: "" })?.turnstileSiteKey,
    ).toBeUndefined();
    expect(parseConfig({ turnstileSiteKey: "0xABC" })?.turnstileSiteKey).toBe(
      "0xABC",
    );
  });

  it("keeps posthogToken and posthogHost only when non-empty (empty selects the no-op adapter)", () => {
    expect(parseConfig({})?.posthogToken).toBeUndefined();
    expect(parseConfig({})?.posthogHost).toBeUndefined();
    expect(parseConfig({ posthogToken: "" })?.posthogToken).toBeUndefined();
    expect(parseConfig({ posthogHost: "" })?.posthogHost).toBeUndefined();
    expect(parseConfig({ posthogToken: "phc_x" })?.posthogToken).toBe("phc_x");
    expect(
      parseConfig({ posthogHost: "https://ph.example" })?.posthogHost,
    ).toBe("https://ph.example");
  });

  it("INV-6: keeps the shape closed so no stray field (e.g. a solution) survives", () => {
    const parsed = parseConfig({
      supabaseUrl: "https://api.crossy.me",
      supabasePublishableKey: "sb_publishable_x",
      apiBase: "https://api.example",
      guestsEnabled: false,
      solution: ["A", "B", "C"],
      board: { cells: ["A"] },
    });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed as AppConfig).sort()).toEqual([
      "apiBase",
      "guestsEnabled",
      "supabasePublishableKey",
      "supabaseUrl",
    ]);
    const asRecord = parsed as unknown as Record<string, unknown>;
    expect(asRecord["solution"]).toBeUndefined();
    expect(asRecord["board"]).toBeUndefined();
  });
});

describe("configFromEnv", () => {
  it("reads VITE_-prefixed vars", () => {
    const config = configFromEnv({
      VITE_SUPABASE_URL: "https://api.crossy.me",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
      VITE_API_BASE: "https://api.example",
      VITE_GUESTS_ENABLED: "true",
      VITE_POSTHOG_TOKEN: "phc_x",
      VITE_POSTHOG_HOST: "https://ph.example",
    });
    expect(config).toEqual({
      supabaseUrl: "https://api.crossy.me",
      supabasePublishableKey: "sb_publishable_x",
      apiBase: "https://api.example",
      guestsEnabled: true,
      posthogToken: "phc_x",
      posthogHost: "https://ph.example",
    });
  });

  it("returns an empty config when nothing is set (selects the mock adapter)", () => {
    expect(configFromEnv({})).toEqual({
      supabaseUrl: "",
      supabasePublishableKey: "",
      apiBase: "",
      guestsEnabled: false,
    });
  });
});

describe("loadConfig", () => {
  const raw = {
    supabaseUrl: "https://api.crossy.me",
    supabasePublishableKey: "sb_publishable_x",
    apiBase: "https://api.example",
    guestsEnabled: true,
  };

  it("returns the parsed config.json when the fetch succeeds", async () => {
    const config = await loadConfig({
      fetchFn: fakeFetch({ ok: true, json: () => Promise.resolve(raw) }),
      env: {},
      isDev: false,
    });
    expect(config).toEqual(raw);
  });

  it("falls back to env when the fetch throws", async () => {
    const config = await loadConfig({
      fetchFn: (() =>
        Promise.reject(new Error("offline"))) as unknown as typeof fetch,
      env: { VITE_API_BASE: "https://dev.api" },
      isDev: true,
    });
    expect(config).toEqual({
      supabaseUrl: "",
      supabasePublishableKey: "",
      apiBase: "https://dev.api",
      guestsEnabled: false,
    });
  });

  it("falls back to env when the response is not JSON (SPA index.html fallback)", async () => {
    const config = await loadConfig({
      fetchFn: fakeFetch({
        ok: true,
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      }),
      env: {},
      isDev: true,
    });
    expect(config).toEqual({
      supabaseUrl: "",
      supabasePublishableKey: "",
      apiBase: "",
      guestsEnabled: false,
    });
  });

  it("falls back to env when the response is not ok", async () => {
    const config = await loadConfig({
      fetchFn: fakeFetch({ ok: false, json: () => Promise.resolve(raw) }),
      env: { VITE_SUPABASE_URL: "https://fallback" },
      isDev: true,
    });
    expect(config.supabaseUrl).toBe("https://fallback");
  });
});
