// The mock Identity adapter: an in-memory identity for tests and local dev with no Supabase
// project. It runs the same port the app consumes, so the demo path and the unit suite never
// touch supabase-js or the network. Sign-in is synchronous here: signInWithProvider seeds a
// fake account session rather than navigating away, so the app shell is exercisable offline.
import type { GuestSignInResult, Identity, IdentitySession } from "./types";

export interface MockIdentityOptions {
  /** Mirrors config.guestsEnabled: when false, signInGuest returns "guests_disabled". */
  guestsEnabled?: boolean;
  /** A starting session, or null (signed out). */
  initialSession?: IdentitySession | null;
  /** The token getAccessToken returns while signed in. Defaults to a deterministic stub. */
  token?: string;
}

const GUEST_SESSION: IdentitySession = {
  userId: "mock-guest",
  displayName: "Guest",
  isAnonymous: true,
};

const ACCOUNT_SESSION: IdentitySession = {
  userId: "mock-account",
  displayName: "Mock Player",
  isAnonymous: false,
};

export function createMockIdentity(opts: MockIdentityOptions = {}): Identity {
  const guestsEnabled = opts.guestsEnabled ?? false;
  let session: IdentitySession | null = opts.initialSession ?? null;
  const listeners = new Set<(s: IdentitySession | null) => void>();

  function emit(): void {
    for (const cb of listeners) cb(session);
  }

  function tokenFor(s: IdentitySession): string {
    return opts.token ?? `mock-token-${s.userId}`;
  }

  return {
    load(): Promise<IdentitySession | null> {
      return Promise.resolve(session);
    },
    getSession(): IdentitySession | null {
      return session;
    },
    getAccessToken(): Promise<string | null> {
      return Promise.resolve(session === null ? null : tokenFor(session));
    },
    signInWithProvider(): Promise<void> {
      // The provider argument is unused: every provider lands the same fake account here, since
      // the mock never leaves for a vendor. Omitting it mirrors signInGuest, which drops its
      // options for the same reason. Structural typing keeps this assignable to the port.
      session = ACCOUNT_SESSION;
      emit();
      return Promise.resolve();
    },
    signInGuest(): Promise<GuestSignInResult> {
      // The optional captchaToken is accepted by the port but unused here: the mock never
      // reaches a captcha-gated provider. Keeping the flag check keeps the dark-ship behavior.
      if (!guestsEnabled) {
        return Promise.resolve({
          ok: false,
          reason: "guests_disabled",
          message: "guest sign-in is disabled",
        });
      }
      session = GUEST_SESSION;
      emit();
      return Promise.resolve({ ok: true, session });
    },
    signOut(): Promise<void> {
      session = null;
      emit();
      return Promise.resolve();
    },
    onChange(cb: (s: IdentitySession | null) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
