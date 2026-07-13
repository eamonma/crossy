import { describe, expect, it } from "vitest";
import type { AuthTarget } from "./gotrue";
import { refreshStoredSession } from "./refresh";
import type { StoredSession } from "./session";
import type { StorageAreaLike } from "./store";
import { SESSION_KEY } from "./store";

const NOW = 1_750_000_000;
const TARGET: AuthTarget = {
  authBaseUrl: "https://api.crossy.party",
  publishableKey: "sb_publishable_test",
};

const OLD_SESSION: StoredSession = {
  accessToken: "at-old",
  refreshToken: "rt-old",
  expiresAt: NOW + 30,
  userId: "user-abc",
  email: "solver@example.com",
  displayName: "Ada",
};

type Op =
  | { readonly op: "set"; readonly items: Record<string, unknown> }
  | { readonly op: "remove"; readonly key: string };

/** A fake storage area that records every write, in order. */
function fakeArea(initial: StoredSession | null): {
  area: StorageAreaLike;
  ops: Op[];
  current: () => unknown;
} {
  let store: Record<string, unknown> =
    initial === null ? {} : { [SESSION_KEY]: initial };
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const ROTATED_BODY = {
  access_token: "at-new",
  refresh_token: "rt-new",
  expires_in: 3600,
  expires_at: NOW + 3600,
  user: {
    id: "user-abc",
    email: "solver@example.com",
    user_metadata: { full_name: "Ada" },
  },
};

describe("refreshStoredSession", () => {
  it("persists the rotated pair in one atomic write before resolving", async () => {
    const { area, ops, current } = fakeArea(OLD_SESSION);
    const outcome = await refreshStoredSession({
      target: TARGET,
      area,
      fetchFn: () => Promise.resolve(jsonResponse(200, ROTATED_BODY)),
      nowSec: () => NOW,
    });
    expect(outcome).toEqual({
      ok: true,
      session: {
        accessToken: "at-new",
        refreshToken: "rt-new",
        expiresAt: NOW + 3600,
        userId: "user-abc",
        email: "solver@example.com",
        displayName: "Ada",
      },
    });
    // Exactly one write: the new pair replaces the old atomically. No window
    // where the old pair was removed without the new one on disk.
    expect(ops).toHaveLength(1);
    const op = ops[0];
    expect(op?.op).toBe("set");
    const written = (op as { items: Record<string, unknown> }).items[
      SESSION_KEY
    ] as StoredSession;
    expect(written.refreshToken).toBe("rt-new");
    expect((current() as StoredSession).refreshToken).toBe("rt-new");
  });

  it("sends the stored refresh token to the refresh_token grant with the apikey", async () => {
    const { area } = fakeArea(OLD_SESSION);
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    await refreshStoredSession({
      target: TARGET,
      area,
      fetchFn: (url, init) => {
        seenUrl = String(url);
        seenInit = init;
        return Promise.resolve(jsonResponse(200, ROTATED_BODY));
      },
      nowSec: () => NOW,
    });
    expect(seenUrl).toBe(
      "https://api.crossy.party/auth/v1/token?grant_type=refresh_token",
    );
    expect(seenInit?.method).toBe("POST");
    expect((seenInit?.headers as Record<string, string>)["apikey"]).toBe(
      "sb_publishable_test",
    );
    expect(JSON.parse(String(seenInit?.body))).toEqual({
      refresh_token: "rt-old",
    });
  });

  it("clears the session on a definitive auth failure (400 invalid grant)", async () => {
    const { area, ops, current } = fakeArea(OLD_SESSION);
    const outcome = await refreshStoredSession({
      target: TARGET,
      area,
      fetchFn: () =>
        Promise.resolve(
          jsonResponse(400, {
            error: "invalid_grant",
            error_description: "Invalid Refresh Token",
          }),
        ),
      nowSec: () => NOW,
    });
    expect(outcome).toEqual({ ok: false, failure: "signed_out" });
    expect(ops).toEqual([{ op: "remove", key: SESSION_KEY }]);
    expect(current()).toBeUndefined();
  });

  it("keeps the session untouched on a transient failure (network throw)", async () => {
    const { area, ops, current } = fakeArea(OLD_SESSION);
    const outcome = await refreshStoredSession({
      target: TARGET,
      area,
      fetchFn: () => Promise.reject(new TypeError("fetch failed")),
      nowSec: () => NOW,
    });
    expect(outcome).toEqual({ ok: false, failure: "retry" });
    expect(ops).toEqual([]);
    expect((current() as StoredSession).refreshToken).toBe("rt-old");
  });

  it("keeps the session untouched on a 5xx", async () => {
    const { area, ops } = fakeArea(OLD_SESSION);
    const outcome = await refreshStoredSession({
      target: TARGET,
      area,
      fetchFn: () => Promise.resolve(jsonResponse(503, {})),
      nowSec: () => NOW,
    });
    expect(outcome).toEqual({ ok: false, failure: "retry" });
    expect(ops).toEqual([]);
  });

  it("treats a 200 with an unusable body as transient, keeping the stored pair", async () => {
    const { area, ops, current } = fakeArea(OLD_SESSION);
    const outcome = await refreshStoredSession({
      target: TARGET,
      area,
      fetchFn: () => Promise.resolve(jsonResponse(200, { nope: true })),
      nowSec: () => NOW,
    });
    expect(outcome).toEqual({ ok: false, failure: "retry" });
    expect(ops).toEqual([]);
    expect((current() as StoredSession).refreshToken).toBe("rt-old");
  });

  it("reports no_session without touching the network when nothing is stored", async () => {
    const { area, ops } = fakeArea(null);
    let fetched = false;
    const outcome = await refreshStoredSession({
      target: TARGET,
      area,
      fetchFn: () => {
        fetched = true;
        return Promise.resolve(jsonResponse(200, ROTATED_BODY));
      },
      nowSec: () => NOW,
    });
    expect(outcome).toEqual({ ok: false, failure: "no_session" });
    expect(fetched).toBe(false);
    expect(ops).toEqual([]);
  });
});
