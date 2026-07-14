// The bridge suite pins the three wire cases that keep signed_in meaning one thing on
// every client (ANALYTICS.md): a persisted restore identifies only, an interactive
// sign-in identifies and captures signed_in, a vendor re-emission against a standing
// session captures nothing. A hand-rolled fake identity drives the causes directly, so
// no adapter or vendor is in the loop.
import { describe, expect, it, vi } from "vitest";
import type {
  Identity,
  IdentitySession,
  SessionChangeCause,
} from "../identity";
import type { Analytics } from "./types";
import { bridgeIdentityToAnalytics } from "./identityBridge";

const ACCOUNT: IdentitySession = {
  userId: "u1",
  displayName: "Ada",
  isAnonymous: false,
  avatarUrl: null,
};

const GUEST: IdentitySession = {
  userId: "g1",
  displayName: "Guest",
  isAnonymous: true,
  avatarUrl: null,
};

function makeIdentity(initial: IdentitySession | null = null): {
  identity: Identity;
  fire: (session: IdentitySession | null, cause: SessionChangeCause) => void;
} {
  let session = initial;
  const listeners = new Set<
    (s: IdentitySession | null, cause: SessionChangeCause) => void
  >();
  const identity: Identity = {
    load: () => Promise.resolve(session),
    getSession: () => session,
    getAccessToken: () => Promise.resolve(null),
    refreshAccessToken: () => Promise.resolve(null),
    signInWithProvider: () => Promise.resolve(),
    signInGuest: () =>
      Promise.resolve({
        ok: false,
        reason: "guests_disabled",
        message: "not under test",
      }),
    sendEmailOtp: () => Promise.resolve({ ok: true }),
    verifyEmailOtp: () => Promise.resolve({ ok: true }),
    verifyEmailLink: () => Promise.resolve({ ok: true }),
    loadProfile: () =>
      Promise.resolve({
        userId: session?.userId ?? "",
        displayName: session?.displayName ?? null,
        isAnonymous: session?.isAnonymous ?? false,
        avatarUrl: session?.avatarUrl ?? null,
        needsName: false,
        reactionSet: null,
      }),
    setDisplayName: () =>
      Promise.resolve({
        ok: false,
        reason: "unknown",
      }),
    setReactionSet: () =>
      Promise.resolve({
        ok: false,
        reason: "unknown",
      }),
    signOut: () => Promise.resolve(),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    identity,
    fire(next, cause) {
      session = next;
      for (const cb of listeners) cb(next, cause);
    },
  };
}

function makeAnalytics(): {
  analytics: Analytics;
  capture: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
} {
  const capture = vi.fn();
  const identify = vi.fn();
  const reset = vi.fn();
  return { analytics: { capture, identify, reset }, capture, identify, reset };
}

describe("identity-to-analytics bridge", () => {
  it("a persisted session restoring identifies without capturing signed_in (one vocabulary across clients, ANALYTICS.md)", () => {
    const { identity, fire } = makeIdentity();
    const { analytics, capture, identify } = makeAnalytics();
    bridgeIdentityToAnalytics(identity, analytics);
    fire(ACCOUNT, "restored");
    expect(identify).toHaveBeenCalledWith("u1", { isAnonymous: false });
    expect(capture).not.toHaveBeenCalled();
  });

  it("an interactive sign-in completing (OAuth return) identifies and captures signed_in once", () => {
    const { identity, fire } = makeIdentity();
    const { analytics, capture, identify } = makeAnalytics();
    bridgeIdentityToAnalytics(identity, analytics);
    fire(ACCOUNT, "signed_in");
    expect(identify).toHaveBeenCalledWith("u1", { isAnonymous: false });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("signed_in");
  });

  it("a guest sign-in captures signed_in and identifies with the anonymous trait", () => {
    const { identity, fire } = makeIdentity();
    const { analytics, capture, identify } = makeAnalytics();
    bridgeIdentityToAnalytics(identity, analytics);
    fire(GUEST, "signed_in");
    expect(identify).toHaveBeenCalledWith("g1", { isAnonymous: true });
    expect(capture).toHaveBeenCalledWith("signed_in");
  });

  it("a re-fired signed_in against a standing session (tab-refocus quirk) never re-captures", () => {
    const { identity, fire } = makeIdentity();
    const { analytics, capture } = makeAnalytics();
    bridgeIdentityToAnalytics(identity, analytics);
    fire(ACCOUNT, "signed_in");
    fire(ACCOUNT, "signed_in");
    fire(ACCOUNT, "refreshed");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("sign-out resets, and a later sign-in starts the edge over (captures again)", () => {
    const { identity, fire } = makeIdentity();
    const { analytics, capture, reset } = makeAnalytics();
    bridgeIdentityToAnalytics(identity, analytics);
    fire(ACCOUNT, "signed_in");
    fire(null, "signed_out");
    expect(reset).toHaveBeenCalledTimes(1);
    fire(GUEST, "signed_in");
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("a session already standing at wire time is identified immediately, never captured", () => {
    const { identity } = makeIdentity(ACCOUNT);
    const { analytics, capture, identify } = makeAnalytics();
    bridgeIdentityToAnalytics(identity, analytics);
    expect(identify).toHaveBeenCalledWith("u1", { isAnonymous: false });
    expect(capture).not.toHaveBeenCalled();
  });
});
