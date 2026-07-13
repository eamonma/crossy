// The Identity port: the surface the rest of the web app consumes for auth. The app never
// imports supabase-js; it depends on this interface, so the vendor is swappable and testable
// (DESIGN.md section 8: swapping providers reimplements the port and nothing else). Two
// adapters implement it: the Supabase adapter (supabaseAdapter.ts) and the mock (mockAdapter.ts).

/** The session shape the UI needs: a stable id, a display name, and the guest flag. */
export interface IdentitySession {
  /** The provider-issued UUID, the same id every foreign key points at (DESIGN.md section 8). */
  userId: string;
  displayName: string;
  /** True for an anonymous guest (DESIGN.md section 8). */
  isAnonymous: boolean;
  /**
   * A prefill suggestion for onboarding, derived from the token's provider metadata name or the
   * email local part (DESIGN.md name-onboarding §5, steps 1-2), or null when neither yields one
   * (the onboarding form then generates a deterministic "Adjective Noun" from userId, §5 step 3).
   * This is NEVER a display value (R5): the chrome renders `displayName` (reconciled to the /me
   * app-DB name), and this only seeds the field the user confirms. Optional so a session that
   * never onboards (a guest, the demo) may omit it.
   */
  nameSuggestion?: string | null;
  /**
   * The signed-in user's own profile picture (the Discord or Apple avatar carried in the OAuth
   * user_metadata), or null. It lives in the port so the chrome can reserve the avatar box and
   * lay the image over the initial the moment it resolves, never reflowing the chip once it
   * lands (the same cure as #93). Null for guests and providers that ship no picture.
   */
  avatarUrl: string | null;
}

/**
 * The result of a guest sign-in. Guests ship dark behind a config flag and are additionally
 * gated by a provider-side captcha (DESIGN.md section 8), so a failure is a typed outcome the
 * caller renders, never a thrown error: "guests_disabled" when the flag is off, and
 * "provider_rejected" when the provider refuses (captcha required, anonymous sign-in disabled).
 */
export type GuestSignInResult =
  | { ok: true; session: IdentitySession }
  | {
      ok: false;
      reason: "guests_disabled" | "provider_rejected";
      message: string;
    };

/** Options for a guest sign-in. captchaToken is accepted now so enabling captcha later is additive. */
export interface GuestSignInOptions {
  captchaToken?: string;
}

/**
 * Options for sending an email one-time code. captchaToken carries the Turnstile token when the
 * project's captcha protection is on: GoTrue rejects /otp with captcha_failed unless the send
 * includes one. Mirrors GuestSignInOptions so the email path threads the same token the guest
 * path already does; the widget in the modal supplies it, and it is absent (dev/local, mock) when
 * no site key is configured.
 */
export interface EmailOtpSendOptions {
  captchaToken?: string;
}

/**
 * Why an email sign-in step did not go through. The same discriminated ok/reason shape as
 * GuestSignInResult, so every email surface renders a typed outcome rather than catching a
 * thrown error: "rate_limited" when the provider throttles a resend, "invalid_code" for a
 * wrong code or link, "expired" once the code or link has aged out, "network" for a transport
 * failure, "unknown" for anything the adapter cannot classify.
 */
export type EmailOtpReason =
  "rate_limited" | "invalid_code" | "expired" | "network" | "unknown";

/**
 * The result of requesting an email one-time code (or magic link). Success carries no session:
 * sending the code only starts the flow, so the caller then shows the code entry. The session
 * lands later, through onChange, when the code or link is verified.
 */
export type EmailOtpSendResult =
  { ok: true } | { ok: false; reason: EmailOtpReason; message: string };

/**
 * The result of verifying an email code or magic link. On success the session flows through the
 * existing onChange path exactly like OAuth, so the resolved session is not returned here; the
 * caller reacts to onChange as it already does for a provider return.
 */
export type EmailOtpResult =
  { ok: true } | { ok: false; reason: EmailOtpReason; message: string };

/**
 * The OAuth providers the product offers. Product vocabulary the port owns: the union names the
 * choices the UI presents, and each adapter maps these to whatever the vendor calls them (DESIGN.md
 * section 8). Apple rides alongside Discord because the App Store mandates it once any third-party
 * login exists. hisbaan is a custom OIDC provider the adapter maps to its Supabase identifier.
 */
export type SignInProvider = "discord" | "apple" | "hisbaan";

/**
 * The caller's self display identity, the shape of GET /me and PATCH /me (DESIGN.md
 * name-onboarding §7). `displayName` is the raw app-DB value and MAY be null here (the one place
 * null crosses; the gameplay wire stays non-null, PROTOCOL.md §4), so a client can detect a
 * nameless account. `needsName` is the server-computed onboarding trigger,
 * `!isAnonymous && displayName === null` (R3): the client shows onboarding iff it is true and
 * holds no naming policy of its own. This is the app-DB truth the UI reads, distinct from the
 * bootstrap `IdentitySession.displayName` (which the adapter reconciles to this on load, R5).
 */
export interface UserProfile {
  userId: string;
  displayName: string | null;
  isAnonymous: boolean;
  avatarUrl: string | null;
  needsName: boolean;
}

/**
 * Why a display-name write did not land, as typed reasons the UI keys copy on (mirrors
 * EmailOtpReason's discriminated shape). The three NAME_* are the server's 422 domain
 * rejections, shown as an inline field error the user can fix; `rate_limited` is the 429 (the
 * result carries the Retry-After so a resilient submit backs off honestly); `network` is a
 * transport failure or a 5xx (auto-retryable); `unknown` is anything else, so the union stays
 * closed and the caller always has a sentence.
 */
export type SetDisplayNameReason =
  | "NAME_REQUIRED"
  | "NAME_TOO_LONG"
  | "NAME_INVALID"
  | "rate_limited"
  | "network"
  | "unknown";

/**
 * The result of setDisplayName. Success carries the canonical profile the server stored, so the
 * caller adopts exactly what was kept. A failure is a typed reason plus, for a 429, the
 * `retryAfterMs` the server asked to wait. Never a thrown error, so the naming surfaces stay a
 * lockout-free retry (R4).
 */
export type SetDisplayNameResult =
  | { ok: true; profile: UserProfile }
  | { ok: false; reason: SetDisplayNameReason; retryAfterMs?: number };

/**
 * Why a session change fired. Product vocabulary the port owns: it distinguishes an
 * interactive sign-in completing ("signed_in": an OAuth return, a guest sign-in) from a
 * persisted session restoring at boot ("restored"), so consumers that must tell the two
 * apart (a welcome moment, the analytics bridge and its signed_in event, ANALYTICS.md)
 * never inspect vendor events. Adapters map whatever the vendor emits onto this closed
 * union; "refreshed" covers same-user re-emissions (token refresh, profile update).
 */
export type SessionChangeCause =
  "restored" | "signed_in" | "signed_out" | "refreshed";

export interface Identity {
  /**
   * Resolve any pending OAuth redirect and load the persisted session. Called once at boot.
   * Idempotent. Returns the resulting session, or null when signed out.
   */
  load(): Promise<IdentitySession | null>;

  /** The last-known session, read synchronously. Null when signed out. */
  getSession(): IdentitySession | null;

  /**
   * A fresh access token for REST auth and the WebSocket hello (PROTOCOL.md section 2),
   * refreshed if the cached token is near expiry. Null if and only if no session exists
   * (INV-11): a transient refresh failure returns the best available token, even one past
   * expiry, because the REST 401-retry seam and the WS backoff loop absorb a server
   * rejection. A standing session is never reported as a sign-out.
   */
  getAccessToken(): Promise<string | null>;

  /**
   * Force a token refresh (used to recover from a server 401 on a token the client still
   * thought was valid). Returns the new access token, or null when no new token is
   * available. Null does not mean signed out: the session may still stand (INV-11), for
   * instance when a peer context already rotated the token. A genuinely dead refresh token
   * surfaces as SIGNED_OUT through onChange, not through this return value.
   */
  refreshAccessToken(): Promise<string | null>;

  /**
   * Begin OAuth with the named provider. Navigates the browser to the provider and returns to
   * redirectPath (defaults to the current location). Resolves before the redirect; it does not
   * return a session.
   */
  signInWithProvider(
    provider: SignInProvider,
    redirectPath?: string,
  ): Promise<void>;

  /** Anonymous guest sign-in. Fails cleanly when guests are disabled or the provider refuses. */
  signInGuest(options?: GuestSignInOptions): Promise<GuestSignInResult>;

  /**
   * Request a one-time email code (and magic link) for the address. Creates the account when
   * none exists. Resolves before any session; success only means the code was sent, so the
   * caller then shows the code entry. Fails cleanly (rate limit, network) rather than throwing.
   * options.captchaToken threads a Turnstile token so a captcha-protected project accepts the
   * send; it is omitted where no site key is configured (dev/local, mock).
   */
  sendEmailOtp(
    email: string,
    options?: EmailOtpSendOptions,
  ): Promise<EmailOtpSendResult>;

  /**
   * Verify a one-time code the user typed for the address. On success the session lands through
   * onChange, exactly like an OAuth return, so no session is returned here. A wrong or aged-out
   * code is a typed reason the caller renders, never a thrown error.
   */
  verifyEmailOtp(input: {
    email: string;
    token: string;
  }): Promise<EmailOtpResult>;

  /**
   * Verify a magic-link click, from the token_hash and type carried on the confirm URL. On
   * success the session lands through onChange like OAuth; a stale or already-used link is a
   * typed reason, never a thrown error.
   */
  verifyEmailLink(input: {
    tokenHash: string;
    type: string;
  }): Promise<EmailOtpResult>;

  signOut(): Promise<void>;

  /**
   * Read the caller's self display identity from GET /me (DESIGN.md name-onboarding §7). This is
   * the app-DB truth the onboarding trigger confirms against and the Settings editor loads: it
   * returns `needsName` (the server-computed onboarding trigger) and the raw `displayName`
   * (possibly null). On load the adapter also reconciles IdentitySession.displayName to this
   * value (R5), so the chrome renders the app-DB name, not the token-metadata derivation. A
   * failed load throws (the caller retries); it is never a sign-out (INV-11). Throws when signed
   * out (no bearer), the same guard authedFetch applies.
   */
  loadProfile(): Promise<UserProfile>;

  /**
   * Write the caller's display name via PATCH /me and adopt the canonical value the server
   * returns (DESIGN.md name-onboarding §7). On success the adapter updates the in-memory session
   * name and fires onChange("refreshed") so the chrome re-renders with the new name; the caller
   * reads the canonical profile from the result. A failure is a typed reason the caller renders
   * inline, never a thrown error (R4).
   */
  setDisplayName(name: string): Promise<SetDisplayNameResult>;

  /**
   * Subscribe to session changes. Returns an unsubscribe function. The cause says why the
   * change fired (SessionChangeCause above); callbacks that only care about the resulting
   * session ignore it.
   */
  onChange(
    cb: (session: IdentitySession | null, cause: SessionChangeCause) => void,
  ): () => void;
}
