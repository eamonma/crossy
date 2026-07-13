// The Supabase adapter suite. supabase-js is never constructed for real and the network is
// never touched: a fake client is injected through createClientFn, so these tests pin the
// adapter's contract (publishable key as the key param, guest gating, captcha threading, token
// freshness, OAuth redirect) without a vendor or a socket.
import { describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { avatarUrlOf, createSupabaseIdentity } from "./supabaseAdapter";
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
    supabaseUrl: "https://api.crossy.party",
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
    expect(args[0]).toBe("https://api.crossy.party");
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

  it("refreshAccessToken forces a rotation and returns the new token (recovering a server 401)", async () => {
    // No expiry shortcut: it rotates unconditionally, since the server just rejected a token
    // the client's clock still thought valid.
    const nowSec = Math.floor(Date.now() / 1000);
    const { deps, calls } = makeDeps({
      refreshSession: () =>
        Promise.resolve({
          data: {
            session: {
              access_token: "rotated",
              expires_at: nowSec + 3600,
              user: fakeUser(),
            },
          },
          error: null,
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.refreshAccessToken()).toBe("rotated");
    expect(calls.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("refreshAccessToken returns null when the rotation fails (a dead refresh token)", async () => {
    const { deps } = makeDeps({
      refreshSession: () =>
        Promise.resolve({
          data: { session: null },
          error: { message: "invalid refresh token" },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.refreshAccessToken()).toBeNull();
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
      avatarUrl: null,
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
        avatarUrl: null,
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
      avatarUrl: null,
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
        avatarUrl: null,
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
        avatarUrl: null,
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
        avatarUrl: null,
      },
      "signed_in",
    );
  });

  // The user's own profile picture: extracted for the chrome so the auth chip can lay the
  // image over the initial in a reserved box (the #93 cure), never reflowing when it lands.
  describe("avatarUrlOf", () => {
    it("reads a Discord avatar_url from user_metadata", () => {
      const user = fakeUser({
        user_metadata: {
          full_name: "Ada",
          avatar_url: "https://cdn.discordapp.com/avatars/1/abc.png",
        },
      });
      expect(avatarUrlOf(user as unknown as User)).toBe(
        "https://cdn.discordapp.com/avatars/1/abc.png",
      );
    });

    it("falls back to the 'picture' key when avatar_url is absent", () => {
      const user = fakeUser({
        user_metadata: { picture: "https://example.com/me.jpg" },
      });
      expect(avatarUrlOf(user as unknown as User)).toBe(
        "https://example.com/me.jpg",
      );
    });

    it("is null when no picture metadata is present (Apple ships none)", () => {
      const user = fakeUser({ user_metadata: { full_name: "Ada" } });
      expect(avatarUrlOf(user as unknown as User)).toBeNull();
    });

    it("is null for a guest even if metadata carries a stray url", () => {
      const user = fakeUser({
        is_anonymous: true,
        user_metadata: { avatar_url: "https://example.com/ghost.png" },
      });
      expect(avatarUrlOf(user as unknown as User)).toBeNull();
    });

    it("rejects a non-http value so the chrome shows the initial, not a broken image", () => {
      const user = fakeUser({
        user_metadata: { avatar_url: "javascript:alert(1)" },
      });
      expect(avatarUrlOf(user as unknown as User)).toBeNull();
    });
  });
});

// A standing session outlives an access token: a transient refresh failure never surfaces as a
// sign-out, and a token a peer context rotated is picked up by re-reading storage.
describe("INV-11 sessions outlive access tokens", () => {
  const nowSec = (): number => Math.floor(Date.now() / 1000);

  function tokenSession(
    accessToken: string,
    expiresAt: number,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      access_token: accessToken,
      expires_at: expiresAt,
      user: fakeUser(over),
    };
  }

  // A getSession that yields each session in turn and then holds the last, so a test can model
  // storage changing (a peer rotation) between the first read and the post-refresh re-read.
  function sequenceOf(
    sessions: unknown[],
  ): () => Promise<{ data: { session: unknown } }> {
    let i = 0;
    return () => {
      const session = sessions[Math.min(i, sessions.length - 1)];
      i += 1;
      return Promise.resolve({ data: { session } });
    };
  }

  it("INV-11: getAccessToken returns the new token after a near-expiry refresh", async () => {
    const { deps, calls } = makeDeps({
      getSession: () =>
        Promise.resolve({
          data: { session: tokenSession("stale", nowSec() + 5) },
        }),
      refreshSession: () =>
        Promise.resolve({
          data: { session: tokenSession("fresh", nowSec() + 3600) },
          error: null,
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.getAccessToken()).toBe("fresh");
    expect(calls.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("INV-11: getAccessToken returns the standing token, not null, when a near-expiry refresh fails", async () => {
    const { deps, calls } = makeDeps({
      // Storage still holds the session on the re-read, so a transient refresh failure is not a
      // sign-out and the existing token stands.
      getSession: () =>
        Promise.resolve({
          data: { session: tokenSession("existing", nowSec() + 5) },
        }),
      refreshSession: () =>
        Promise.resolve({
          data: { session: null },
          error: { message: "network down" },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.getAccessToken()).toBe("existing");
    expect(calls.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("INV-11: getAccessToken returns a peer-rotated token surfaced by the storage re-read", async () => {
    const { deps } = makeDeps({
      // First read: our near-expiry token. The refresh loses the race and errors; the re-read
      // finds the token a peer context rotated into storage.
      getSession: sequenceOf([
        tokenSession("stale", nowSec() + 5),
        tokenSession("rotated", nowSec() + 3600),
      ]),
      refreshSession: () =>
        Promise.resolve({
          data: { session: null },
          error: { name: "AuthRefreshDiscardedError", message: "discarded" },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.getAccessToken()).toBe("rotated");
  });

  it("INV-11: getAccessToken is null when no session exists", async () => {
    const { deps } = makeDeps({
      getSession: () => Promise.resolve({ data: { session: null } }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.getAccessToken()).toBeNull();
  });

  it("INV-11: refreshAccessToken returns the peer-rotated token when the re-read shows a newer one after a discarded refresh", async () => {
    const { deps } = makeDeps({
      // The before-snapshot reads "old"; the rotation is discarded because a peer already
      // rotated; the re-read finds the winning token the peer left in storage.
      getSession: sequenceOf([
        tokenSession("old", nowSec() + 3600),
        tokenSession("winner", nowSec() + 3600),
      ]),
      refreshSession: () =>
        Promise.resolve({
          data: { session: null },
          error: { name: "AuthRefreshDiscardedError", message: "discarded" },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.refreshAccessToken()).toBe("winner");
  });

  it("INV-11: refreshAccessToken is null when the refresh fails and nothing fresher is in storage", async () => {
    const { deps } = makeDeps({
      // The stored token never changes across the before-snapshot and the re-read: the refresh
      // token is genuinely spent, a real failure rather than a discarded rotation.
      getSession: () =>
        Promise.resolve({
          data: { session: tokenSession("old", nowSec() + 3600) },
        }),
      refreshSession: () =>
        Promise.resolve({
          data: { session: null },
          error: { message: "invalid refresh token" },
        }),
    });
    const identity = createSupabaseIdentity(deps);
    expect(await identity.refreshAccessToken()).toBeNull();
  });

  it("INV-11: the signed-out breadcrumb names the vendor event on SIGNED_OUT", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const { deps, fireAuthChange } = makeDeps({});
      createSupabaseIdentity(deps);
      fireAuthChange({ access_token: "a", user: fakeUser({ id: "u1" }) });
      fireAuthChange(null, "SIGNED_OUT");
      expect(info).toHaveBeenCalledWith("crossy: signed out (SIGNED_OUT)");
    } finally {
      info.mockRestore();
    }
  });
});
