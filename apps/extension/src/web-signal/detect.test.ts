import { describe, expect, it } from "vitest";
import type { LocalStorageLike } from "./detect";
import { readWebIdentity, webSessionPresent } from "./detect";

const NOW = 1_750_000_000;

/** A minimal localStorage over a plain record, in insertion order. */
function fakeStorage(entries: Record<string, string>): LocalStorageLike {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (k) => (k in entries ? entries[k] : null) ?? null,
  };
}

describe("webSessionPresent", () => {
  it("is true for an sb-*-auth-token with expires_at in the future", () => {
    const storage = fakeStorage({
      "sb-qvnvokstvbarsxhufrja-auth-token": JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
        expires_at: NOW + 3600,
      }),
    });
    expect(webSessionPresent(storage, NOW)).toBe(true);
  });

  it("is false for an expired session (expires_at at or before now)", () => {
    const storage = fakeStorage({
      "sb-qvnvokstvbarsxhufrja-auth-token": JSON.stringify({
        expires_at: NOW - 1,
      }),
    });
    expect(webSessionPresent(storage, NOW)).toBe(false);
    const atNow = fakeStorage({
      "sb-ref-auth-token": JSON.stringify({ expires_at: NOW }),
    });
    expect(webSessionPresent(atNow, NOW)).toBe(false);
  });

  it("is false when no key matches sb-*-auth-token", () => {
    const storage = fakeStorage({
      theme: "dark",
      "sb-ref-auth-token-code-verifier": "pkce-junk",
      "supabase.auth.token": JSON.stringify({ expires_at: NOW + 3600 }),
    });
    expect(webSessionPresent(storage, NOW)).toBe(false);
  });

  it("is false when the value is malformed JSON", () => {
    const storage = fakeStorage({
      "sb-ref-auth-token": "{not json",
    });
    expect(webSessionPresent(storage, NOW)).toBe(false);
  });

  it("is false when expires_at is missing or not a number", () => {
    const missing = fakeStorage({
      "sb-ref-auth-token": JSON.stringify({ access_token: "at" }),
    });
    expect(webSessionPresent(missing, NOW)).toBe(false);
    const stringy = fakeStorage({
      "sb-ref-auth-token": JSON.stringify({ expires_at: "later" }),
    });
    expect(webSessionPresent(stringy, NOW)).toBe(false);
  });

  it("is false when the value is not a JSON object (array, primitive, null)", () => {
    for (const raw of ["[1,2,3]", "42", "null", '"a-string"']) {
      const storage = fakeStorage({ "sb-ref-auth-token": raw });
      expect(webSessionPresent(storage, NOW)).toBe(false);
    }
  });

  it("finds a live session even when another auth-token entry is expired", () => {
    const storage = fakeStorage({
      "sb-old-auth-token": JSON.stringify({ expires_at: NOW - 100 }),
      "sb-new-auth-token": JSON.stringify({ expires_at: NOW + 100 }),
    });
    expect(webSessionPresent(storage, NOW)).toBe(true);
  });
});

describe("readWebIdentity (account alignment; never reads tokens)", () => {
  function session(user: Record<string, unknown>): Record<string, string> {
    return {
      "sb-qvnvokstvbarsxhufrja-auth-token": JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
        expires_at: NOW + 3600,
        user,
      }),
    };
  }

  it("returns the account id, provider, and display name for a live Discord session", () => {
    const storage = fakeStorage(
      session({
        id: "user-1",
        app_metadata: { provider: "discord" },
        user_metadata: { full_name: "Ada" },
      }),
    );
    expect(readWebIdentity(storage, NOW)).toEqual({
      userId: "user-1",
      provider: "discord",
      displayName: "Ada",
    });
  });

  it("maps the apple provider too", () => {
    const storage = fakeStorage(
      session({
        id: "user-2",
        app_metadata: { provider: "apple" },
        email: "solver@example.com",
      }),
    );
    expect(readWebIdentity(storage, NOW)?.provider).toBe("apple");
  });

  it("is null for an unsteerable provider (email/anonymous guest): nothing to align to", () => {
    for (const provider of ["email", "anonymous", undefined]) {
      const storage = fakeStorage(
        session({ id: "user-3", app_metadata: { provider } }),
      );
      expect(readWebIdentity(storage, NOW)).toBeNull();
    }
  });

  it("is null when the session is expired, absent, or carries no user id", () => {
    expect(readWebIdentity(fakeStorage({}), NOW)).toBeNull();
    const expired = fakeStorage({
      "sb-ref-auth-token": JSON.stringify({
        expires_at: NOW - 1,
        user: { id: "u", app_metadata: { provider: "discord" } },
      }),
    });
    expect(readWebIdentity(expired, NOW)).toBeNull();
    const noId = fakeStorage(
      session({ app_metadata: { provider: "discord" } }),
    );
    expect(readWebIdentity(noId, NOW)).toBeNull();
  });

  it("surfaces only {userId, provider, displayName}, never a token, from a value that holds them", () => {
    const storage = fakeStorage(
      session({ id: "user-1", app_metadata: { provider: "discord" } }),
    );
    const identity = readWebIdentity(storage, NOW);
    // The stored value carries access_token/refresh_token; none of it may cross over.
    expect(Object.keys(identity ?? {}).sort()).toEqual([
      "displayName",
      "provider",
      "userId",
    ]);
  });
});
