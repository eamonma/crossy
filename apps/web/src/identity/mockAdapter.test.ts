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

  it("signInWithDiscord seeds a full (non-anonymous) account session", async () => {
    const identity = createMockIdentity();
    await identity.signInWithDiscord();
    expect(identity.getSession()?.isAnonymous).toBe(false);
  });

  it("onChange fires on sign-in and sign-out and unsubscribes cleanly", async () => {
    const identity = createMockIdentity({ guestsEnabled: true });
    const seen = vi.fn();
    const off = identity.onChange(seen);
    await identity.signInGuest();
    await identity.signOut();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenLastCalledWith(null);
    off();
    await identity.signInWithDiscord();
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
