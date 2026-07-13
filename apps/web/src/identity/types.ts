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
 * The OAuth providers the product offers. Product vocabulary the port owns: the union names the
 * choices the UI presents, and each adapter maps these to whatever the vendor calls them (DESIGN.md
 * section 8). Apple rides alongside Discord because the App Store mandates it once any third-party
 * login exists.
 */
export type SignInProvider = "discord" | "apple";

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

  signOut(): Promise<void>;

  /**
   * Subscribe to session changes. Returns an unsubscribe function. The cause says why the
   * change fired (SessionChangeCause above); callbacks that only care about the resulting
   * session ignore it.
   */
  onChange(
    cb: (session: IdentitySession | null, cause: SessionChangeCause) => void,
  ): () => void;
}
