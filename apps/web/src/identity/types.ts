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
   * refreshed if the cached token is near expiry. Null when signed out.
   */
  getAccessToken(): Promise<string | null>;

  /**
   * Begin Discord OAuth. Navigates the browser to the provider and returns to redirectPath
   * (defaults to the current location). Resolves before the redirect; it does not return a
   * session.
   */
  signInWithDiscord(redirectPath?: string): Promise<void>;

  /** Anonymous guest sign-in. Fails cleanly when guests are disabled or the provider refuses. */
  signInGuest(options?: GuestSignInOptions): Promise<GuestSignInResult>;

  signOut(): Promise<void>;

  /** Subscribe to session changes. Returns an unsubscribe function. */
  onChange(cb: (session: IdentitySession | null) => void): () => void;
}
