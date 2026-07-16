// The Supabase Identity adapter: the only module in apps/web that imports supabase-js
// (dependency-cruiser enforces the containment). The rest of the app depends on the Identity
// port (types.ts), so the vendor stays swappable (DESIGN.md section 8).
//
// Auth runs against the custom domain (config.supabaseUrl, e.g. https://api.crossy.party) with
// the new-format publishable key (sb_publishable_...) passed as the key param; it is public by
// design. Discord and Apple OAuth and anonymous guests are the providers; email gets no surface.
import { createClient } from "@supabase/supabase-js";
import type {
  AuthError,
  EmailOtpType,
  Provider,
  Session,
  SupabaseClient,
  SupabaseClientOptions,
  User,
} from "@supabase/supabase-js";
import type {
  EmailOtpReason,
  EmailOtpResult,
  EmailOtpSendOptions,
  EmailOtpSendResult,
  GuestSignInOptions,
  GuestSignInResult,
  Identity,
  IdentitySession,
  SessionChangeCause,
  SetDisplayNameResult,
  SetReactionSetResult,
  SignInProvider,
  UserProfile,
} from "./types";
import type { Bearer } from "../net/authedFetch";
import { getMe, setDisplayName, setReactionSet } from "../profile/api";

/** Refresh the token when it has under a minute left, so REST and the WS hello get a fresh one. */
const REFRESH_THRESHOLD_SEC = 60;

/**
 * Port provider to the vendor's provider string. The strings coincide for the built-ins, but the
 * map is the boundary: vendor vocabulary stays inside this adapter, so the port's union never leaks
 * a Supabase name and a divergence later is one edit here. hisbaan is a custom OIDC provider whose
 * Supabase identifier is the literal "custom:hisbaan", which the vendor's Provider union does not
 * name; it is cast narrowly at the signInWithOAuth call site and otherwise rides the standard path.
 */
const SUPABASE_PROVIDER: Record<SignInProvider, string> = {
  discord: "discord",
  apple: "apple",
  hisbaan: "custom:hisbaan",
};

/** Apple's hide-my-email relays land here; the local part is random junk, never a name. */
const APPLE_PRIVATE_RELAY_SUFFIX = "@privaterelay.appleid.com";

export interface SupabaseIdentityDeps {
  supabaseUrl: string;
  publishableKey: string;
  /** The core API origin (config.apiBase), where GET /me and PATCH /me live. The adapter reads
   *  the app-DB display name from here on load (R5) and writes it on setDisplayName. */
  apiBase: string;
  /** Mirrors config.guestsEnabled: when false, signInGuest fails "guests_disabled" locally. */
  guestsEnabled: boolean;
  /** Injectable for tests so the suite never constructs a real client or hits the network. */
  createClientFn?: typeof createClient;
  /** Injectable current location for the OAuth redirect default; defaults to window.location. */
  currentUrl?: () => { origin: string; pathAndQuery: string };
}

function defaultCurrentUrl(): { origin: string; pathAndQuery: string } {
  const loc = globalThis.window?.location;
  if (loc === undefined) return { origin: "", pathAndQuery: "/" };
  return { origin: loc.origin, pathAndQuery: `${loc.pathname}${loc.search}` };
}

/**
 * A prefill suggestion derived from provider metadata, or null when none is usable (DESIGN.md
 * name-onboarding §5, step 1-2). This is NEVER a display value after R5: it seeds the onboarding
 * field (which the user confirms) and can arm the nameless trigger hint, but the name the chrome
 * renders is always the app-DB value the adapter loads from GET /me. Order: a token metadata name
 * if present, else the email local part unless the address is an Apple private relay (whose local
 * part is random junk). Returns null when neither yields a name; the onboarding component then
 * falls back to a deterministic generated suggestion (§5 step 3), which lives in the UI.
 */
export function suggestedNameOf(user: User): string | null {
  const meta = user.user_metadata as Record<string, unknown>;
  for (const key of ["full_name", "name", "user_name", "preferred_username"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  const email = typeof user.email === "string" ? user.email : "";
  if (!email.endsWith(APPLE_PRIVATE_RELAY_SUFFIX)) {
    const local = email.split("@")[0];
    if (local !== undefined && local !== "") return local;
  }
  return null;
}

/**
 * The bootstrap display name a session carries before GET /me reconciles it (R5). An anonymous
 * guest keeps the "Guest" render label unchanged. A permanent user shows a NEUTRAL PLACEHOLDER
 * (the empty string, so the chrome's avatar shows a quiet default initial and no synthesized
 * name), never a metadata-derived name and never the old "Player" literal: the derived value is
 * only a trigger hint and prefill (suggestedNameOf), never a display source. The adapter replaces
 * this empty bootstrap with the app-DB name the moment loadProfile() resolves.
 */
function bootstrapDisplayName(user: User): string {
  return user.is_anonymous === true ? "Guest" : "";
}

/**
 * The user's own profile picture from provider metadata, or null. Discord ships `avatar_url`;
 * Apple ships no picture, so this is null there. Guests never carry one. Exported so the
 * extraction is unit-testable next to displayNameOf. Only a non-empty http(s) URL counts; any
 * other shape falls back to null so the chrome shows the initial rather than a broken image.
 */
export function avatarUrlOf(user: User): string | null {
  if (user.is_anonymous === true) return null;
  const meta = user.user_metadata as Record<string, unknown>;
  for (const key of ["avatar_url", "picture"]) {
    const value = meta[key];
    if (typeof value === "string") {
      const url = value.trim();
      if (url.startsWith("https://") || url.startsWith("http://")) return url;
    }
  }
  return null;
}

/** Same personal reaction set? Null (the defaults) equals only null; arrays compare elementwise on
 *  the exact grapheme strings (PROTOCOL.md §12: distinctness and identity are byte-exact). */
function reactionSetsEqual(
  a: readonly string[] | null,
  b: readonly string[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((e, i) => e === b[i]);
}

function toSession(session: Session | null): IdentitySession | null {
  if (session === null) return null;
  const user = session.user;
  return {
    userId: user.id,
    // Bootstrap only: the empty placeholder for a permanent user, "Guest" for an anonymous one.
    // The adapter overwrites this with the app-DB name from GET /me on load (R5).
    displayName: bootstrapDisplayName(user),
    isAnonymous: user.is_anonymous === true,
    avatarUrl: avatarUrlOf(user),
    // The prefill suggestion (metadata name or email local part), for onboarding only, never a
    // display value. A guest never onboards, so it stays null there.
    nameSuggestion: user.is_anonymous === true ? null : suggestedNameOf(user),
  };
}

/**
 * Did the identity actually change between two mapped sessions? supabase-js fires
 * onAuthStateChange on token refresh and whenever the tab regains visibility (its
 * auto-refresh ticker runs on visibilitychange), not only on real sign-in/out. Only a
 * change in null-ness, userId, or isAnonymous is one the app must react to; a same-user
 * re-emission (a TOKEN_REFRESHED, a re-emitted SIGNED_IN) is not. The null-to-session
 * transition (OAuth redirect completion, INITIAL_SESSION) always counts, because the
 * needs-auth gate depends on it.
 */
function identityChanged(
  prev: IdentitySession | null,
  next: IdentitySession | null,
): boolean {
  if (prev === null && next === null) return false;
  if (prev === null || next === null) return true;
  return prev.userId !== next.userId || prev.isAnonymous !== next.isAnonymous;
}

/**
 * Vendor auth event to the port's change cause. INITIAL_SESSION is the persisted session
 * loading at client construction, so it maps to "restored", never "signed_in": only an
 * interactive sign-in completing (SIGNED_IN covers the OAuth return under
 * detectSessionInUrl and the anonymous sign-in) earns "signed_in". Known vendor quirk,
 * mapped honestly rather than papered over: supabase-js can re-fire SIGNED_IN on tab
 * refocus with an already-standing session. The adapter's same-identity suppression
 * swallows most of those, and consumers that act on "signed_in" (the analytics bridge)
 * also gate on the null-to-session edge. Unrecognized events (USER_UPDATED and friends)
 * fall back by session shape, so the union stays closed.
 */
function causeOf(
  event: string,
  next: IdentitySession | null,
): SessionChangeCause {
  switch (event) {
    case "INITIAL_SESSION":
      return next === null ? "signed_out" : "restored";
    case "SIGNED_IN":
      return "signed_in";
    case "SIGNED_OUT":
      return "signed_out";
    case "TOKEN_REFRESHED":
      return "refreshed";
    default:
      return next === null ? "signed_out" : "refreshed";
  }
}

/**
 * Classify an email-auth AuthError into the port's reason enum. Keyed on the stable `code` first
 * (over_*_rate_limit, otp_expired and its kin, otp_disabled / invalid_credentials for a bad code),
 * then the HTTP status (429 is a throttle), then a message probe as the last resort, with "network"
 * for an error the vendor raised with no HTTP status (it never reached the server). Everything else
 * is "unknown", so the union stays closed and a caller always has a sentence to show.
 */
function emailOtpReasonOf(error: AuthError): EmailOtpReason {
  const code = typeof error.code === "string" ? error.code : "";
  if (code.includes("rate_limit")) return "rate_limited";
  if (code === "otp_expired" || code.includes("expired")) return "expired";
  if (
    code === "otp_disabled" ||
    code === "invalid_credentials" ||
    code === "email_address_invalid"
  ) {
    return "invalid_code";
  }
  if (error.status === 429) return "rate_limited";
  const message = error.message.toLowerCase();
  if (message.includes("expired")) return "expired";
  if (message.includes("rate limit") || message.includes("rate-limit")) {
    return "rate_limited";
  }
  if (message.includes("invalid") || message.includes("token")) {
    return "invalid_code";
  }
  // A vendor error with no HTTP status never reached the server: a transport failure.
  if (error.status === undefined) return "network";
  return "unknown";
}

export function createSupabaseIdentity(deps: SupabaseIdentityDeps): Identity {
  const create = deps.createClientFn ?? createClient;
  const currentUrl = deps.currentUrl ?? defaultCurrentUrl;
  const options: SupabaseClientOptions<"public"> = {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Complete the OAuth redirect (exchange ?code for a session) on client construction.
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  };
  const supabase: SupabaseClient = create(
    deps.supabaseUrl,
    deps.publishableKey,
    options,
  );

  let current: IdentitySession | null = null;
  const listeners = new Set<
    (s: IdentitySession | null, cause: SessionChangeCause) => void
  >();

  supabase.auth.onAuthStateChange((event, session) => {
    const next = toSession(session);
    const changed = identityChanged(current, next);
    // Always keep `current` fresh so getSession reads the latest mapped session, but
    // only notify listeners on a real identity change. Otherwise every token refresh or
    // tab refocus would churn the game (close the socket, refetch, reopen) for nothing.
    current = next;
    if (!changed) return;
    const cause = causeOf(event, next);
    if (cause === "signed_out") {
      // Breadcrumb: name the vendor event behind every sign-out so a surprise sign-out
      // report arrives with evidence (INV-11). One line, no dependency.
      console.info(`crossy: signed out (${event})`);
    }
    for (const cb of listeners) cb(current, cause);
  });

  async function freshSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (session === null) return null;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at;
    if (
      typeof expiresAt === "number" &&
      expiresAt - now < REFRESH_THRESHOLD_SEC
    ) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error === null && refreshed.data.session !== null) {
        return refreshed.data.session;
      }
      // Refresh yielded no token (network, transient reject, or a rotation discarded because
      // a peer context already rotated: supabase-js 2.110 leaves the winner in storage and
      // raises AuthRefreshDiscardedError). Re-read storage once. A session that now carries a
      // rotated or still-valid token is used; a session that stands with nothing fresher is
      // returned as-is, even past expiry, because a standing session is not a sign-out
      // (INV-11) and the REST 401-retry seam and WS backoff absorb a server rejection. Only a
      // re-read that finds no session is a true sign-out, and that returns null.
      const reread = await supabase.auth.getSession();
      return reread.data.session;
    }
    return session;
  }

  /** Force a token rotation after a server 401 on a token the client thought valid, mirroring
   *  the public refreshAccessToken method (both feed the same bearer for the /me calls). */
  async function forceRefresh(): Promise<string | null> {
    const before =
      (await supabase.auth.getSession()).data.session?.access_token ?? null;
    const { data, error } = await supabase.auth.refreshSession();
    if (error === null && data.session !== null) {
      return data.session.access_token;
    }
    const reread = (await supabase.auth.getSession()).data.session;
    if (reread !== null && reread.access_token !== before) {
      return reread.access_token;
    }
    return null;
  }

  // The REST bearer the /me calls ride, the same seam ui/useResource builds from the port for
  // GET /games: resolve a fresh token per call, force one rotation after a 401. authedFetch does
  // the reactive refresh-and-retry, so a token the /me server just rejected recovers here for
  // free and a transient failure is never a sign-out (INV-11).
  const bearer: Bearer = {
    getToken: async () => (await freshSession())?.access_token ?? null,
    refresh: forceRefresh,
  };

  /**
   * Reconcile the session to the /me app-DB values: the single point where the chrome's state
   * becomes the /me truth rather than the bootstrap. The display name (R5): only a permanent
   * account adopts a non-null /me name; an anonymous guest keeps its "Guest" label. The reaction
   * set (§12): every account adopts it, guests included (their /me works and holds the column
   * like any account's). When anything actually changed, notify listeners with "refreshed" so the
   * chrome, the tray, and the HUD re-render (the identity itself did not change, so
   * identityChanged would not have fired). Returns nothing; the caller already holds the profile.
   */
  function adoptProfile(profile: UserProfile): void {
    if (current === null) return;
    if (current.userId !== profile.userId) return;
    let next = current;
    const name = profile.displayName;
    if (!profile.isAnonymous && name !== null && name !== next.displayName) {
      next = { ...next, displayName: name };
    }
    if (!reactionSetsEqual(next.reactionSet ?? null, profile.reactionSet)) {
      next = { ...next, reactionSet: profile.reactionSet };
    }
    if (next === current) return;
    current = next;
    for (const cb of listeners) cb(current, "refreshed");
  }

  return {
    async load(): Promise<IdentitySession | null> {
      const { data } = await supabase.auth.getSession();
      current = toSession(data.session);
      return current;
    },
    getSession(): IdentitySession | null {
      return current;
    },
    async getAccessToken(): Promise<string | null> {
      const session = await freshSession();
      return session?.access_token ?? null;
    },
    async refreshAccessToken(): Promise<string | null> {
      // Force a rotation through the stored refresh token, bypassing the freshness
      // shortcut: the server just rejected a token the client thought was valid, so the
      // cached one is useless. Snapshot the token held before the call so a discarded
      // rotation can be told apart from a dead one.
      const before =
        (await supabase.auth.getSession()).data.session?.access_token ?? null;
      const { data, error } = await supabase.auth.refreshSession();
      if (error === null && data.session !== null) {
        return data.session.access_token;
      }
      // No new token from the rotation. Re-read storage: when a peer context already rotated,
      // supabase-js 2.110 discards our rotation (AuthRefreshDiscardedError) and leaves the
      // winning token in storage, so a stored token that differs from the one held before the
      // call is a fresh one to use, not a failure (INV-11). If nothing changed, the refresh
      // token is spent: return null and let onChange's SIGNED_OUT drive the sign-in surface.
      const reread = (await supabase.auth.getSession()).data.session;
      if (reread !== null && reread.access_token !== before) {
        return reread.access_token;
      }
      return null;
    },
    async signInWithProvider(
      provider: SignInProvider,
      redirectPath?: string,
    ): Promise<void> {
      const { origin, pathAndQuery } = currentUrl();
      const redirectTo = `${origin}${redirectPath ?? pathAndQuery}`;
      // The map yields a plain string so a custom OIDC id ("custom:hisbaan") fits; the vendor's
      // Provider union does not name it, so cast narrowly here, at the one call that consumes it.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: SUPABASE_PROVIDER[provider] as Provider,
        options: { redirectTo },
      });
      if (error !== null) throw new Error(error.message);
    },
    async signInGuest(
      options?: GuestSignInOptions,
    ): Promise<GuestSignInResult> {
      // Ships dark behind the flag: refuse locally before ever calling the provider.
      if (!deps.guestsEnabled) {
        return {
          ok: false,
          reason: "guests_disabled",
          message: "guest sign-in is disabled",
        };
      }
      // captchaToken is threaded now so turning on Turnstile later is purely additive.
      const { data, error } = await supabase.auth.signInAnonymously(
        options?.captchaToken !== undefined
          ? { options: { captchaToken: options.captchaToken } }
          : undefined,
      );
      if (error !== null) {
        return {
          ok: false,
          reason: "provider_rejected",
          message: error.message,
        };
      }
      const session = toSession(data.session);
      if (session === null) {
        return {
          ok: false,
          reason: "provider_rejected",
          message: "no session returned",
        };
      }
      return { ok: true, session };
    },
    async sendEmailOtp(
      email: string,
      otpOptions?: EmailOtpSendOptions,
    ): Promise<EmailOtpSendResult> {
      // Emails an eight-digit code and a magic link both; the link lands on /auth/confirm, where the
      // token_hash it carries is verified through verifyEmailLink. shouldCreateUser makes email a
      // first-class sign-up path, not sign-in only. Success carries no session: the code entry is
      // next, and the session lands later through onAuthStateChange. The origin comes from the same
      // node-safe read the OAuth redirect uses (globalThis.window), never a bare window reference.
      // captchaToken rides alongside when the project's captcha is on (GoTrue rejects /otp with
      // captcha_failed otherwise); it is threaded exactly as the guest path threads it to
      // signInAnonymously, and absent when no site key is configured.
      const captchaToken = otpOptions?.captchaToken;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${currentUrl().origin}/auth/confirm`,
          ...(captchaToken !== undefined ? { captchaToken } : {}),
        },
      });
      if (error !== null) {
        return {
          ok: false,
          reason: emailOtpReasonOf(error),
          message: error.message,
        };
      }
      return { ok: true };
    },
    async verifyEmailOtp(input: {
      email: string;
      token: string;
    }): Promise<EmailOtpResult> {
      // On success supabase-js persists the session and fires onAuthStateChange, so the app reacts
      // through the one onChange path exactly as it does for an OAuth return; nothing is applied here.
      const { error } = await supabase.auth.verifyOtp({
        email: input.email,
        token: input.token,
        type: "email",
      });
      if (error !== null) {
        return {
          ok: false,
          reason: emailOtpReasonOf(error),
          message: error.message,
        };
      }
      return { ok: true };
    },
    async verifyEmailLink(input: {
      tokenHash: string;
      type: string;
    }): Promise<EmailOtpResult> {
      // The magic-link path: token_hash and type ride on the /auth/confirm URL. The port keeps type
      // a plain string (it owns no vendor vocabulary); the vendor's EmailOtpType admits any string,
      // so cast narrowly here. Success flows through onAuthStateChange like every other sign-in.
      const { error } = await supabase.auth.verifyOtp({
        token_hash: input.tokenHash,
        type: input.type as EmailOtpType,
      });
      if (error !== null) {
        return {
          ok: false,
          reason: emailOtpReasonOf(error),
          message: error.message,
        };
      }
      return { ok: true };
    },
    async loadProfile(): Promise<UserProfile> {
      // GET /me over the shared bearer. On success reconcile the session to the app-DB truth
      // (the name, R5, and the reaction set, §12) so the chrome renders /me, not the bootstrap.
      // A throw (transport or non-2xx) propagates to the caller, which retries; never a sign-out.
      const profile = await getMe(deps.apiBase, bearer);
      adoptProfile(profile);
      return profile;
    },
    async setDisplayName(name: string): Promise<SetDisplayNameResult> {
      // PATCH /me and, on success, adopt the canonical name the server returns into the session
      // (firing onChange("refreshed") so the chrome updates). A failure is a typed reason the
      // caller renders inline; this method never throws (R4).
      const result = await setDisplayName(deps.apiBase, bearer, name);
      if (result.ok) adoptProfile(result.profile);
      return result;
    },
    async setReactionSet(
      set: readonly string[] | null,
    ): Promise<SetReactionSetResult> {
      // PATCH /me `{reactionSet}` and, on success, adopt the canonical set the server returns
      // into the session (firing onChange("refreshed") so the tray and the HUD re-render with
      // the new five, no reload). A failure is a typed reason the caller renders inline.
      const result = await setReactionSet(deps.apiBase, bearer, set);
      if (result.ok) adoptProfile(result.profile);
      return result;
    },
    async signOut(): Promise<void> {
      // Sign out this device only. supabase-js defaults to { scope: "global" }, which
      // revokes the user's whole refresh-token family and logs the phone and the
      // extension out at their next refresh (part of the "randomly signed out" reports).
      // The product decision is device-local: an explicit sign-out-everywhere can arrive
      // later as its own affordance.
      await supabase.auth.signOut({ scope: "local" });
    },
    onChange(
      cb: (s: IdentitySession | null, cause: SessionChangeCause) => void,
    ): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
