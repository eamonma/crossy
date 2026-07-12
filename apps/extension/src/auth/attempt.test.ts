import { describe, expect, it } from "vitest";
import type { AttemptDeps } from "./attempt";
import { runPkceAttempt } from "./attempt";
import type { AuthTarget } from "./gotrue";
import type { StorageAreaLike } from "./store";
import { SESSION_KEY } from "./store";

const NOW = 1_750_000_000;
const REDIRECT = "https://abcdefghijklmnop.chromiumapp.org/";
const TARGET: AuthTarget = {
  authBaseUrl: "https://api.crossy.party",
  publishableKey: "sb_publishable_test",
};

type Op =
  | { readonly op: "set"; readonly items: Record<string, unknown> }
  | { readonly op: "remove"; readonly key: string };

function fakeArea(): {
  area: StorageAreaLike;
  ops: Op[];
  current: () => unknown;
} {
  let store: Record<string, unknown> = {};
  const ops: Op[] = [];
  return {
    area: {
      get: (key) => Promise.resolve(key in store ? { [key]: store[key] } : {}),
      set: (items) => {
        ops.push({ op: "set", items });
        store = { ...store, ...items };
        return Promise.resolve();
      },
      remove: (key) => {
        ops.push({ op: "remove", key });
        store = Object.fromEntries(
          Object.entries(store).filter(([k]) => k !== key),
        );
        return Promise.resolve();
      },
    },
    ops,
    current: () => store[SESSION_KEY],
  };
}

const TOKEN_BODY = {
  access_token: "at-new",
  refresh_token: "rt-new",
  expires_at: NOW + 3600,
  user: { email: "solver@example.com", user_metadata: { full_name: "Ada" } },
};

/** fetch stub answering the pkce token exchange with a fixed body. */
function tokenFetch(status = 200, body: unknown = TOKEN_BODY) {
  const seen: { url?: string } = {};
  const fetchFn: typeof fetch = (url) => {
    seen.url = String(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { seen, fetchFn };
}

function deps(
  over: Partial<AttemptDeps> & Pick<AttemptDeps, "area" | "launch">,
): AttemptDeps {
  return {
    target: TARGET,
    redirectUri: REDIRECT,
    randomBytes: (out) => out.fill(7),
    nowSec: () => NOW,
    ...over,
  };
}

describe("runPkceAttempt", () => {
  it("on a captured code, exchanges it and persists the session atomically (INV: store path)", async () => {
    const { area, ops, current } = fakeArea();
    const { seen, fetchFn } = tokenFetch();
    const launched: string[] = [];
    const result = await runPkceAttempt(
      "discord",
      deps({
        area,
        fetchFn,
        launch: (url) => {
          launched.push(url);
          return Promise.resolve(`${REDIRECT}?code=abc123`);
        },
      }),
    );
    expect(result.ok).toBe(true);
    // The authorize URL the launch was asked to run is the shared builder's shape.
    expect(launched[0]).toContain("/auth/v1/authorize?");
    expect(launched[0]).toContain("provider=discord");
    // The code rode the pkce grant.
    expect(seen.url).toBe(
      "https://api.crossy.party/auth/v1/token?grant_type=pkce",
    );
    // Persisted through the same single atomic set store.saveSession makes.
    expect(ops).toEqual([
      { op: "set", items: { [SESSION_KEY]: expect.any(Object) } },
    ]);
    expect(current()).toMatchObject({
      accessToken: "at-new",
      refreshToken: "rt-new",
      expiresAt: NOW + 3600,
      displayName: "Ada",
    });
  });

  it("when the launch yields no redirect (silent no-session), fails and writes nothing", async () => {
    const { area, ops } = fakeArea();
    const result = await runPkceAttempt(
      "discord",
      deps({ area, launch: () => Promise.resolve(undefined) }),
    );
    expect(result.ok).toBe(false);
    expect(ops).toEqual([]);
  });

  it("when the launch throws, fails and writes nothing (no session to lose)", async () => {
    const { area, ops } = fakeArea();
    const result = await runPkceAttempt(
      "discord",
      deps({ area, launch: () => Promise.reject(new Error("no session")) }),
    );
    expect(result.ok).toBe(false);
    expect(ops).toEqual([]);
  });

  it("when the redirect carries an error, fails and writes nothing", async () => {
    const { area, ops } = fakeArea();
    const result = await runPkceAttempt(
      "discord",
      deps({
        area,
        launch: () => Promise.resolve(`${REDIRECT}?error=login_required`),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("login_required");
    expect(ops).toEqual([]);
  });

  it("when the token exchange rejects the code, fails and writes nothing", async () => {
    const { area, ops } = fakeArea();
    const { fetchFn } = tokenFetch(403, { error: "bad_code" });
    const result = await runPkceAttempt(
      "discord",
      deps({
        area,
        fetchFn,
        launch: () => Promise.resolve(`${REDIRECT}?code=abc`),
      }),
    );
    expect(result.ok).toBe(false);
    expect(ops).toEqual([]);
  });
});
