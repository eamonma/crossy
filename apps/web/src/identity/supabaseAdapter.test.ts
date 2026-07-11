// The Supabase adapter suite. supabase-js is never constructed for real and the network is
// never touched: a fake client is injected through createClientFn, so these tests pin the
// adapter's contract (publishable key as the key param, guest gating, captcha threading, token
// freshness, OAuth redirect) without a vendor or a socket.
import { describe, expect, it, vi } from "vitest";
import { createSupabaseIdentity } from "./supabaseAdapter";
import type { SupabaseIdentityDeps } from "./supabaseAdapter";

type AuthChangeCb = (event: string, session: unknown) => void;

interface FakeAuthBehavior {
  getSession?: () => Promise<{ data: { session: unknown } }>;
  refreshSession?: () => Promise<{
    data: { session: unknown };
    error: unknown;
  }>;
  signInAnonymously?: (arg: unknown) => Promise<{
    data: { session: unknown };
    error: unknown;
  }>;
  signInWithOAuth?: (arg: unknown) => Promise<{ error: unknown }>;
  signOut?: () => Promise<{ error: unknown }>;
}

function fakeUser(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "user-1",
    is_anonymous: false,
    user_metadata: { full_name: "Ada Lovelace" },
    email: "ada@example.com",
    ...over,
  };
}

function makeDeps(
  behavior: FakeAuthBehavior,
  extra: Partial<SupabaseIdentityDeps> = {},
): {
  deps: SupabaseIdentityDeps;
  calls: {
    createClient: ReturnType<typeof vi.fn>;
    signInAnonymously: ReturnType<typeof vi.fn>;
    signInWithOAuth: ReturnType<typeof vi.fn>;
    refreshSession: ReturnType<typeof vi.fn>;
  };
  fireAuthChange: (session: unknown, event?: string) => void;
} {
  let authCb: AuthChangeCb = () => undefined;

  const signInAnonymously = vi.fn(
    behavior.signInAnonymously ??
      (() => Promise.resolve({ data: { session: null }, error: null })),
  );
  const signInWithOAuth = vi.fn(
    behavior.signInWithOAuth ?? (() => Promise.resolve({ error: null })),
  );
  const refreshSession = vi.fn(
    behavior.refreshSession ??
      (() => Promise.resolve({ data: { session: null }, error: null })),
  );
  const auth = {
    getSession:
      behavior.getSession ??
      (() => Promise.resolve({ data: { session: null } })),
    refreshSession,
    signInAnonymously,
    signInWithOAuth,
    signOut: behavior.signOut ?? (() => Promise.resolve({ error: null })),
    onAuthStateChange: (cb: AuthChangeCb) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  };
  const createClient = vi.fn(() => ({ auth }));

  const deps: SupabaseIdentityDeps = {
    supabaseUrl: "https://api.crossy.me",
    publishableKey: "sb_publishable_test",
    guestsEnabled: true,
    createClientFn: createClient as unknown as NonNullable<
      SupabaseIdentityDeps["createClientFn"]
    >,
    currentUrl: () => ({
      origin: "https://app.test",
      pathAndQuery: "/game/g1?code=ABCD2345",
    }),
    ...extra,
  };

  return {
    deps,
    calls: { createClient, signInAnonymously, signInWithOAuth, refreshSession },
    fireAuthChange: (session: unknown, event = "SIGNED_IN") =>
      authCb(event, session),
  };
}

describe("supabase identity adapter", () => {
  it("passes the publishable key as the key param to createClient", () => {
    const { deps, calls } = makeDeps({});
    createSupabaseIdentity(deps);
    expect(calls.createClient).toHaveBeenCalledTimes(1);
    const args = calls.createClient.mock.calls[0]!;
    expect(args[0]).toBe("https://api.crossy.me");
    expect(args[1]).toBe("sb_publishable_test");
  });

  it("signInGuest refuses locally when guests are disabled, without calling the provider", async () => {
    const { deps, calls } = makeDeps({}, { guestsEnabled: false });
    const identity = createSupabaseIdentity(deps);
    const result = await identity.signInGuest({ captchaToken: "tok" });
    expect(result).toEqual({
      ok: false,
      reason: "guests_disabled",
      message: expect.any(String),
    });
    expect(calls.signInAnonymously).not.toHaveBeenCalled();
  });

  it("signInGuest threads the captcha token through to signInAnonymously", async () => {
    const { deps, calls } = makeDeps({
      signInAnonymously: () =>
        Promise.resolve({
          data: {
            session: {
              access_token: "a",
              user: fakeUser({ is_anonymous: true }),
            },
          },
          error: null,
        }),
    });
    const identity = createSupabaseIdentity(deps);
    const result = await identity.signInGuest({ captchaToken: "cap-123" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.isAnonymous).toBe(true);
    expect(calls.signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: "cap-123" },
    });
  });

  it("signInGuest returns 'provider_rejected' when the provider errors (guests disabled server-side)", async () => {
    const { deps } = makeDeps({
      signInAnonymously: () =>
        Promise.resolve({
          data: { session: null },
          error: { message: "anonymous sign-ins are disabled" },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    const result = await identity.signInGuest();
    expect(result).toEqual({
      ok: false,
      reason: "provider_rejected",
      message: "anonymous sign-ins are disabled",
    });
  });

  it("getAccessToken returns the current token when it is not near expiry", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const { deps, calls } = makeDeps({
      getSession: () =>
        Promise.resolve({
          data: {
            session: {
              access_token: "current",
              expires_at: nowSec + 3600,
              user: fakeUser(),
            },
          },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.getAccessToken()).toBe("current");
    expect(calls.refreshSession).not.toHaveBeenCalled();
  });

  it("getAccessToken refreshes a token that is near expiry (always-fresh for REST and the WS hello)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const { deps, calls } = makeDeps({
      getSession: () =>
        Promise.resolve({
          data: {
            session: {
              access_token: "stale",
              expires_at: nowSec + 5,
              user: fakeUser(),
            },
          },
        }),
      refreshSession: () =>
        Promise.resolve({
          data: {
            session: {
              access_token: "fresh",
              expires_at: nowSec + 3600,
              user: fakeUser(),
            },
          },
          error: null,
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.getAccessToken()).toBe("fresh");
    expect(calls.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("getAccessToken is null when signed out", async () => {
    const { deps } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    expect(await identity.getAccessToken()).toBeNull();
  });

  it("signInWithProvider('discord') starts OAuth with a redirectTo built from the current location", async () => {
    const { deps, calls } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    await identity.signInWithProvider("discord");
    expect(calls.signInWithOAuth).toHaveBeenCalledWith({
      provider: "discord",
      options: { redirectTo: "https://app.test/game/g1?code=ABCD2345" },
    });
  });

  it("signInWithProvider('apple') passes the apple provider string through to the vendor", async () => {
    const { deps, calls } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    await identity.signInWithProvider("apple");
    expect(calls.signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: { redirectTo: "https://app.test/game/g1?code=ABCD2345" },
    });
  });

  it("signInWithProvider honors an explicit redirect path", async () => {
    const { deps, calls } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    await identity.signInWithProvider("discord", "/lobby");
    expect(calls.signInWithOAuth).toHaveBeenCalledWith({
      provider: "discord",
      options: { redirectTo: "https://app.test/lobby" },
    });
  });

  it("load maps the persisted session and onChange relays auth-state updates", async () => {
    const { deps, fireAuthChange } = makeDeps({
      getSession: () =>
        Promise.resolve({
          data: {
            session: { access_token: "a", user: fakeUser({ id: "u9" }) },
          },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    const loaded = await identity.load();
    expect(loaded).toEqual({
      userId: "u9",
      displayName: "Ada Lovelace",
      isAnonymous: false,
    });
    const seen = vi.fn();
    identity.onChange(seen);
    fireAuthChange({
      access_token: "b",
      user: fakeUser({ id: "u9", is_anonymous: true }),
    });
    expect(seen).toHaveBeenCalledWith(
      {
        userId: "u9",
        displayName: "Guest",
        isAnonymous: true,
      },
      "signed_in",
    );
  });

  it("displayName falls through to 'Player' for an Apple private-relay email with no name metadata", async () => {
    const { deps } = makeDeps({
      getSession: () =>
        Promise.resolve({
          data: {
            session: {
              access_token: "a",
              user: fakeUser({
                id: "u-apple",
                user_metadata: {},
                email: "abc123xyz@privaterelay.appleid.com",
              }),
            },
          },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    const loaded = await identity.load();
    expect(loaded).toEqual({
      userId: "u-apple",
      displayName: "Player",
      isAnonymous: false,
    });
  });

  it("displayName still uses the local part for a normal email lacking name metadata", async () => {
    const { deps } = makeDeps({
      getSession: () =>
        Promise.resolve({
          data: {
            session: {
              access_token: "a",
              user: fakeUser({
                id: "u-email",
                user_metadata: {},
                email: "ada@example.com",
              }),
            },
          },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    const loaded = await identity.load();
    expect(loaded?.displayName).toBe("ada");
  });

  const session = (over: Record<string, unknown> = {}): unknown => ({
    access_token: "a",
    user: fakeUser(over),
  });

  it("onChange notifies on the first session so the needs-auth gate opens (null to a session)", () => {
    const { deps, fireAuthChange } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    const seen = vi.fn();
    identity.onChange(seen);
    fireAuthChange(session({ id: "u1" }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(
      {
        userId: "u1",
        displayName: "Ada Lovelace",
        isAnonymous: false,
      },
      "signed_in",
    );
  });

  it("INITIAL_SESSION maps to 'restored': a persisted session restoring is not an interactive sign-in (ANALYTICS.md signed_in gate)", () => {
    const { deps, fireAuthChange } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    const seen = vi.fn();
    identity.onChange(seen);
    fireAuthChange(session({ id: "u1" }), "INITIAL_SESSION");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(
      {
        userId: "u1",
        displayName: "Ada Lovelace",
        isAnonymous: false,
      },
      "restored",
    );
  });

  it("TOKEN_REFRESHED maps to 'refreshed', never to 'signed_in'", () => {
    const { deps, fireAuthChange } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    const seen = vi.fn();
    identity.onChange(seen);
    // A refresh normally carries the same identity and is suppressed outright; firing it
    // from the signed-out state surfaces the mapping so the union stays pinned.
    fireAuthChange(session({ id: "u1" }), "TOKEN_REFRESHED");
    expect(seen).toHaveBeenCalledWith(expect.anything(), "refreshed");
  });

  it("onChange suppresses a same-user re-emission (token refresh, tab refocus): the game must not churn", () => {
    const { deps, fireAuthChange } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    fireAuthChange(session({ id: "u1" })); // establish current before listening
    const seen = vi.fn();
    identity.onChange(seen);
    fireAuthChange(session({ id: "u1" })); // same identity, fresh token
    expect(seen).not.toHaveBeenCalled();
  });

  it("onChange notifies on sign-out (a session to null)", () => {
    const { deps, fireAuthChange } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    fireAuthChange(session({ id: "u1" }));
    const seen = vi.fn();
    identity.onChange(seen);
    fireAuthChange(null, "SIGNED_OUT");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(null, "signed_out");
  });

  it("onChange notifies when the user changes (account switch)", () => {
    const { deps, fireAuthChange } = makeDeps({});
    const identity = createSupabaseIdentity(deps);
    fireAuthChange(session({ id: "u1" }));
    const seen = vi.fn();
    identity.onChange(seen);
    fireAuthChange(session({ id: "u2" }));
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(
      {
        userId: "u2",
        displayName: "Ada Lovelace",
        isAnonymous: false,
      },
      "signed_in",
    );
  });
});
