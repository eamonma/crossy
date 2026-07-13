// The mock Identity adapter: an in-memory identity for tests and local dev with no Supabase
// project. It runs the same port the app consumes, so the demo path and the unit suite never
// touch supabase-js or the network. Sign-in is synchronous here: signInWithProvider seeds a
// fake account session rather than navigating away, so the app shell is exercisable offline.
import type {
  EmailOtpResult,
  EmailOtpSendResult,
  GuestSignInResult,
  Identity,
  IdentitySession,
  SessionChangeCause,
} from "./types";

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
  avatarUrl: null,
};

const ACCOUNT_SESSION: IdentitySession = {
  userId: "mock-account",
  displayName: "Mock Player",
  isAnonymous: false,
  avatarUrl: null,
};

/** The one code the mock treats as correct; any other value returns "invalid_code". */
const VALID_EMAIL_OTP = "123456";

/** The one token_hash the mock link-verify accepts; any other returns "invalid_code". */
const VALID_EMAIL_LINK_HASH = "ok";

export function createMockIdentity(opts: MockIdentityOptions = {}): Identity {
  const guestsEnabled = opts.guestsEnabled ?? false;
  let session: IdentitySession | null = opts.initialSession ?? null;
  const listeners = new Set<
    (s: IdentitySession | null, cause: SessionChangeCause) => void
  >();

  // Both mock sign-in paths are interactive by construction (a click in the UI), so they
  // emit "signed_in"; the initialSession option models an already-restored session and is
  // in place before anyone can subscribe, so load() never emits "restored" here.
  function emit(cause: SessionChangeCause): void {
    for (const cb of listeners) cb(session, cause);
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
    refreshAccessToken(): Promise<string | null> {
      // The mock never rotates a token: a "refresh" simply hands back the same stub token
      // while signed in, or null when signed out. It mirrors getAccessToken because there
      // is no vendor to force a rotation against.
      return Promise.resolve(session === null ? null : tokenFor(session));
    },
    signInWithProvider(): Promise<void> {
      // The provider argument is unused: every provider lands the same fake account here, since
      // the mock never leaves for a vendor. Omitting it mirrors signInGuest, which drops its
      // options for the same reason. Structural typing keeps this assignable to the port.
      session = ACCOUNT_SESSION;
      emit("signed_in");
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
      emit("signed_in");
      return Promise.resolve({ ok: true, session });
    },
    sendEmailOtp(): Promise<EmailOtpSendResult> {
      // No email leaves here and no code is stored: sending always succeeds, and the fixed
      // VALID_EMAIL_OTP is what the verify step then accepts, so the flow is deterministic offline.
      return Promise.resolve({ ok: true });
    },
    verifyEmailOtp(input: {
      email: string;
      token: string;
    }): Promise<EmailOtpResult> {
      // The one correct code seeds the same full account every provider lands (like OAuth here);
      // any other value is a typed "invalid_code", never a thrown error. Success emits "signed_in"
      // exactly as an interactive OAuth return would, mirroring the real adapter's onChange path.
      if (input.token !== VALID_EMAIL_OTP) {
        return Promise.resolve({
          ok: false,
          reason: "invalid_code",
          message: "that code didn't match",
        });
      }
      session = ACCOUNT_SESSION;
      emit("signed_in");
      return Promise.resolve({ ok: true });
    },
    verifyEmailLink(input: {
      tokenHash: string;
      type: string;
    }): Promise<EmailOtpResult> {
      // The magic-link twin of verifyEmailOtp: the one correct token_hash lands the account and
      // emits "signed_in"; any other value is a typed "invalid_code".
      if (input.tokenHash !== VALID_EMAIL_LINK_HASH) {
        return Promise.resolve({
          ok: false,
          reason: "invalid_code",
          message: "that link is no longer valid",
        });
      }
      session = ACCOUNT_SESSION;
      emit("signed_in");
      return Promise.resolve({ ok: true });
    },
    signOut(): Promise<void> {
      session = null;
      emit("signed_out");
      return Promise.resolve();
    },
    onChange(
      cb: (s: IdentitySession | null, cause: SessionChangeCause) => void,
    ): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
