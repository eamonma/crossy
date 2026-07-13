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
  SetDisplayNameResult,
  UserProfile,
} from "./types";
import {
  canonicalizeDisplayName,
  isCompleteDisplayName,
} from "../profile/name";

export interface MockIdentityOptions {
  /** Mirrors config.guestsEnabled: when false, signInGuest returns "guests_disabled". */
  guestsEnabled?: boolean;
  /** A starting session, or null (signed out). */
  initialSession?: IdentitySession | null;
  /** The token getAccessToken returns while signed in. Defaults to a deterministic stub. */
  token?: string;
  /**
   * The app-DB display name GET /me reports for a permanent account, distinct from the session's
   * bootstrap displayName (R5). `null` models a NAMELESS permanent account, so loadProfile
   * reports `needsName: true` and the onboarding surface fires; a string models a named one. The
   * demo path (never onboarded) leaves it undefined, which reads as the session's own name so the
   * mock stays a faithful signed-in shell. setDisplayName mutates this store, the single source.
   */
  meDisplayName?: string | null;
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

/** The one code the mock treats as correct; any other value returns "invalid_code". Eight digits
 *  to match Supabase's OTP length (the code entry accepts eight now). */
const VALID_EMAIL_OTP = "12345678";

/** The one token_hash the mock link-verify accepts; any other returns "invalid_code". */
const VALID_EMAIL_LINK_HASH = "ok";

export function createMockIdentity(opts: MockIdentityOptions = {}): Identity {
  const guestsEnabled = opts.guestsEnabled ?? false;
  let session: IdentitySession | null = opts.initialSession ?? null;
  const listeners = new Set<
    (s: IdentitySession | null, cause: SessionChangeCause) => void
  >();

  // The app-DB display name the mock /me reports (R5). `undefined` means "unset": loadProfile
  // then folds it to the session's own name so the demo shell reads named. An explicit `null`
  // models a nameless permanent account (needsName true); a string models a named one.
  // setDisplayName rewrites this, the single name store the mock UI reads through.
  let meName: string | null | undefined = opts.meDisplayName;

  // Both mock sign-in paths are interactive by construction (a click in the UI), so they
  // emit "signed_in"; the initialSession option models an already-restored session and is
  // in place before anyone can subscribe, so load() never emits "restored" here.
  function emit(cause: SessionChangeCause): void {
    for (const cb of listeners) cb(session, cause);
  }

  function tokenFor(s: IdentitySession): string {
    return opts.token ?? `mock-token-${s.userId}`;
  }

  /** The /me payload the mock reports for the current session (R5): a signed-out caller has no
   *  profile, so loadProfile throws (mirroring the real adapter's authedFetch signed-out guard).
   *  For a permanent account displayName is the meName store, folded to the session name when
   *  unset; needsName is the server rule, `!isAnonymous && displayName === null`. */
  function profileOf(s: IdentitySession): UserProfile {
    const displayName = s.isAnonymous
      ? s.displayName
      : meName === undefined
        ? s.displayName === ""
          ? null
          : s.displayName
        : meName;
    return {
      userId: s.userId,
      displayName,
      isAnonymous: s.isAnonymous,
      avatarUrl: s.avatarUrl,
      needsName: !s.isAnonymous && displayName === null,
    };
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
      // The email and the optional captchaToken are both accepted by the port but dropped here,
      // mirroring signInWithProvider and signInGuest: the mock never leaves for a vendor, so no email
      // leaves and no captcha is reached. Structural typing keeps this assignable to the port, and
      // sending always succeeds, so the fixed VALID_EMAIL_OTP the verify step accepts is deterministic
      // offline. The threading test spies on this method to assert the caller's args, not the body.
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
    loadProfile(): Promise<UserProfile> {
      // A signed-out caller has no profile: throw, mirroring authedFetch's signed-out guard, so
      // the app root's INV-11 gate (arm only on a real session) is exercised offline too.
      if (session === null) {
        return Promise.reject(new Error("signed out: no profile to load"));
      }
      return Promise.resolve(profileOf(session));
    },
    setDisplayName(name: string): Promise<SetDisplayNameResult> {
      // Validate at the mock edge the same way the field does, so a test that submits a valid
      // prefill lands ok and a malformed one gets a typed reason (no network here). On success
      // rewrite the meName store AND the session name, then emit "refreshed" so the chrome
      // updates, mirroring the real adapter's adoptProfileName.
      if (session === null) {
        return Promise.resolve({ ok: false, reason: "network" });
      }
      if (!isCompleteDisplayName(name)) {
        // A whitespace-only draft is NAME_REQUIRED; anything else that fails completeness here is
        // a shape the server would reject, surfaced as NAME_INVALID (the mock does not distinguish
        // TOO_LONG since the field caps length before submit).
        const canonical = canonicalizeDisplayName(name);
        return Promise.resolve({
          ok: false,
          reason: canonical.length === 0 ? "NAME_REQUIRED" : "NAME_INVALID",
        });
      }
      const canonical = canonicalizeDisplayName(name);
      meName = canonical;
      session = { ...session, displayName: canonical };
      emit("refreshed");
      return Promise.resolve({ ok: true, profile: profileOf(session) });
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
