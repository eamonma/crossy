import { describe, expect, it, vi } from "vitest";
import { createMockIdentity } from "./mockAdapter";

describe("mock identity adapter", () => {
  it("starts signed out and reports no token", async () => {
    const identity = createMockIdentity();
    expect(identity.getSession()).toBeNull();
    expect(await identity.getAccessToken()).toBeNull();
    expect(await identity.load()).toBeNull();
  });

  it("signInGuest fails 'guests_disabled' when the flag is off (ships dark behind config)", async () => {
    const identity = createMockIdentity({ guestsEnabled: false });
    const result = await identity.signInGuest();
    expect(result).toEqual({
      ok: false,
      reason: "guests_disabled",
      message: expect.any(String),
    });
    expect(identity.getSession()).toBeNull();
  });

  it("signInGuest succeeds when enabled and accepts an optional captcha token", async () => {
    const identity = createMockIdentity({ guestsEnabled: true });
    const result = await identity.signInGuest({ captchaToken: "tok" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.isAnonymous).toBe(true);
    expect(identity.getSession()?.isAnonymous).toBe(true);
    expect(await identity.getAccessToken()).toContain("mock-token");
  });

  it("signInWithProvider seeds a full (non-anonymous) account session for each provider", async () => {
    const discord = createMockIdentity();
    await discord.signInWithProvider("discord");
    expect(discord.getSession()?.isAnonymous).toBe(false);

    const apple = createMockIdentity();
    await apple.signInWithProvider("apple");
    expect(apple.getSession()?.isAnonymous).toBe(false);

    // hisbaan rides the same OAuth path as the built-ins, so the union member is usable end to end.
    const hisbaan = createMockIdentity();
    await hisbaan.signInWithProvider("hisbaan");
    expect(hisbaan.getSession()?.isAnonymous).toBe(false);
  });

  it("sendEmailOtp succeeds without a session (the code entry is next)", async () => {
    const identity = createMockIdentity();
    const result = await identity.sendEmailOtp("ada@example.com");
    expect(result).toEqual({ ok: true });
    // Sending only starts the flow: no session lands until the code is verified.
    expect(identity.getSession()).toBeNull();
  });

  it("sendEmailOtp accepts an optional captcha token, threaded like the guest path (captcha_failed cure)", async () => {
    // The modal threads the Turnstile token into the send when the project's captcha is on; the
    // mock accepts and ignores it (no captcha-gated provider here). Spy to prove the caller's
    // token reaches the port exactly as passed, so the wiring is covered without a real provider.
    const identity = createMockIdentity();
    const send = vi.spyOn(identity, "sendEmailOtp");
    const result = await identity.sendEmailOtp("ada@example.com", {
      captchaToken: "turnstile-token",
    });
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith("ada@example.com", {
      captchaToken: "turnstile-token",
    });
    // The token is a send-time concern only: it lands no session.
    expect(identity.getSession()).toBeNull();
  });

  it("verifyEmailOtp lands a full account on the correct code and emits 'signed_in'", async () => {
    const identity = createMockIdentity();
    const seen = vi.fn();
    identity.onChange(seen);
    const result = await identity.verifyEmailOtp({
      email: "ada@example.com",
      token: "12345678",
    });
    expect(result).toEqual({ ok: true });
    expect(identity.getSession()?.isAnonymous).toBe(false);
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ isAnonymous: false }),
      "signed_in",
    );
  });

  it("verifyEmailOtp returns 'invalid_code' for a wrong code and lands no session", async () => {
    const identity = createMockIdentity();
    const result = await identity.verifyEmailOtp({
      email: "ada@example.com",
      token: "00000000",
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid_code",
      message: expect.any(String),
    });
    expect(identity.getSession()).toBeNull();
  });

  it("verifyEmailLink lands a full account on the correct token_hash and emits 'signed_in'", async () => {
    const identity = createMockIdentity();
    const seen = vi.fn();
    identity.onChange(seen);
    const result = await identity.verifyEmailLink({
      tokenHash: "ok",
      type: "magiclink",
    });
    expect(result).toEqual({ ok: true });
    expect(identity.getSession()?.isAnonymous).toBe(false);
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ isAnonymous: false }),
      "signed_in",
    );
  });

  it("verifyEmailLink returns 'invalid_code' for a stale token_hash", async () => {
    const identity = createMockIdentity();
    const result = await identity.verifyEmailLink({
      tokenHash: "stale",
      type: "magiclink",
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid_code",
      message: expect.any(String),
    });
    expect(identity.getSession()).toBeNull();
  });

  it("onChange fires on sign-in and sign-out and unsubscribes cleanly", async () => {
    const identity = createMockIdentity({ guestsEnabled: true });
    const seen = vi.fn();
    const off = identity.onChange(seen);
    await identity.signInGuest();
    await identity.signOut();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenLastCalledWith(null, "signed_out");
    off();
    await identity.signInWithProvider("discord");
    expect(seen).toHaveBeenCalledTimes(2);
  });

  // Profile methods (R5): the mock supports the two onboarding surfaces (a nameless permanent
  // account and a named one) so the dialog and the Settings editor are testable offline.
  describe("profile (loadProfile, setDisplayName)", () => {
    const permanent = {
      userId: "u1",
      displayName: "",
      isAnonymous: false,
      avatarUrl: null,
    };

    it("loadProfile reports needsName for a nameless permanent account (displayName null on /me)", async () => {
      const identity = createMockIdentity({
        initialSession: permanent,
        meDisplayName: null,
      });
      const profile = await identity.loadProfile();
      expect(profile).toEqual({
        userId: "u1",
        displayName: null,
        isAnonymous: false,
        avatarUrl: null,
        needsName: true,
      });
    });

    it("loadProfile reports a named account (needsName false)", async () => {
      const identity = createMockIdentity({
        initialSession: { ...permanent, displayName: "Ada" },
        meDisplayName: "Ada",
      });
      const profile = await identity.loadProfile();
      expect(profile.displayName).toBe("Ada");
      expect(profile.needsName).toBe(false);
    });

    it("loadProfile throws when signed out (INV-11: the trigger arms only on a real session)", async () => {
      const identity = createMockIdentity();
      await expect(identity.loadProfile()).rejects.toThrow();
    });

    it("setDisplayName canonicalizes, adopts the name into the session, and emits 'refreshed'", async () => {
      const identity = createMockIdentity({
        initialSession: permanent,
        meDisplayName: null,
      });
      const seen = vi.fn();
      identity.onChange(seen);
      const result = await identity.setDisplayName("  Ada   Lovelace ");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.profile.displayName).toBe("Ada Lovelace");
      expect(identity.getSession()?.displayName).toBe("Ada Lovelace");
      // A subsequent /me now reads named, so onboarding would not re-fire.
      expect((await identity.loadProfile()).needsName).toBe(false);
      expect(seen).toHaveBeenLastCalledWith(
        expect.objectContaining({ displayName: "Ada Lovelace" }),
        "refreshed",
      );
    });

    it("setDisplayName returns NAME_REQUIRED for a whitespace-only draft (a typed reason, not a throw)", async () => {
      const identity = createMockIdentity({
        initialSession: permanent,
        meDisplayName: null,
      });
      const result = await identity.setDisplayName("   ");
      expect(result).toEqual({ ok: false, reason: "NAME_REQUIRED" });
    });
  });

  it("interactive sign-ins carry the 'signed_in' cause (the mock never restores through onChange)", async () => {
    const identity = createMockIdentity({ guestsEnabled: true });
    const seen = vi.fn();
    identity.onChange(seen);
    await identity.signInGuest();
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ isAnonymous: true }),
      "signed_in",
    );
    await identity.signOut();
    await identity.signInWithProvider("discord");
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ isAnonymous: false }),
      "signed_in",
    );
  });
});
