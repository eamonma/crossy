// The "Continue another way" email flow's transitions, walked against the mock Identity adapter
// (which succeeds for code "123456" and fails "invalid_code" otherwise). The modal's async steps
// call the port between these pure states; the test drives the same sequence so the state model and
// the adapter agree end to end, with no React render (the web suite runs under node).
import { describe, expect, it, vi } from "vitest";
import { createMockIdentity } from "../identity/mockAdapter";
import type { IdentitySession } from "../identity";
import {
  backToEmail,
  initialEmailState,
  isCompleteCode,
  isPlausibleEmail,
  otpReasonMessage,
  sanitizeCode,
  sendFailed,
  toCodeEntry,
  toSending,
  toVerifying,
  verifyFailed,
} from "./otpModalMachine";

describe("otpModalMachine transitions (email -> code -> session via onChange)", () => {
  it("emailEntry -> sending -> codeEntry when sendEmailOtp resolves ok", async () => {
    const identity = createMockIdentity();
    let state = initialEmailState;
    expect(state.step).toBe("emailEntry");

    state = toSending("ada@example.com");
    expect(state).toEqual({ step: "sending", email: "ada@example.com" });

    const sent = await identity.sendEmailOtp("ada@example.com");
    expect(sent.ok).toBe(true);
    // Sending lands no session: the code entry is next (types.ts).
    expect(identity.getSession()).toBeNull();

    state = toCodeEntry("ada@example.com");
    expect(state).toEqual({
      step: "codeEntry",
      email: "ada@example.com",
      error: null,
    });
  });

  it("codeEntry -> verifying -> session lands through onChange on the correct code (no verify return session)", async () => {
    const identity = createMockIdentity();
    const seen = vi.fn<(s: IdentitySession | null) => void>();
    identity.onChange(seen);

    let state = toCodeEntry("ada@example.com");
    state = toVerifying("ada@example.com");
    expect(state).toEqual({ step: "verifying", email: "ada@example.com" });

    const result = await identity.verifyEmailOtp({
      email: "ada@example.com",
      token: "123456",
    });
    // The port returns only ok, never a session: the modal reacts to onChange, exactly like OAuth.
    expect(result).toEqual({ ok: true });
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ isAnonymous: false }),
      "signed_in",
    );
    expect(identity.getSession()?.isAnonymous).toBe(false);
  });

  it("a wrong code returns to codeEntry with the invalid_code copy, session unchanged", async () => {
    const identity = createMockIdentity();
    let state = toVerifying("ada@example.com");

    const result = await identity.verifyEmailOtp({
      email: "ada@example.com",
      token: "000000",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) state = verifyFailed("ada@example.com", result.reason);

    expect(state).toEqual({
      step: "codeEntry",
      email: "ada@example.com",
      error: otpReasonMessage("invalid_code"),
    });
    // A failed verify never signs anyone in.
    expect(identity.getSession()).toBeNull();
  });

  it("sendFailed carries the reason's copy back to emailEntry, not a dead end", () => {
    expect(sendFailed("rate_limited")).toEqual({
      step: "emailEntry",
      error: otpReasonMessage("rate_limited"),
    });
  });

  it("'use a different email' returns to a clean emailEntry", () => {
    expect(backToEmail()).toEqual({ step: "emailEntry", error: null });
  });
});

describe("otpModalMachine copy and input guards", () => {
  it("maps every reason to a calm, code-free sentence (GuestSignIn tone)", () => {
    for (const reason of [
      "rate_limited",
      "invalid_code",
      "expired",
      "network",
      "unknown",
    ] as const) {
      const message = otpReasonMessage(reason);
      expect(message.length).toBeGreaterThan(0);
      // No em dashes (CLAUDE.md style). No raw enum token leaks to the user: the machine-readable
      // form is underscored (rate_limited, invalid_code), never a sentence the user should see.
      // ("expired" as plain English is fine; the snake_case identifier is what must not appear.)
      expect(message).not.toContain("—");
      expect(message).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });

  it("isPlausibleEmail stops an empty or shapeless submit but passes a real address", () => {
    expect(isPlausibleEmail("ada@example.com")).toBe(true);
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail("ada")).toBe(false);
    expect(isPlausibleEmail("ada@example")).toBe(false);
    expect(isPlausibleEmail("a b@example.com")).toBe(false);
  });

  it("sanitizeCode keeps digits, caps at six; isCompleteCode gates the submit", () => {
    expect(sanitizeCode("12-34-56")).toBe("123456");
    expect(sanitizeCode("1234567")).toBe("123456");
    expect(sanitizeCode("12ab34")).toBe("1234");
    expect(isCompleteCode("123456")).toBe(true);
    expect(isCompleteCode("12345")).toBe(false);
  });
});
