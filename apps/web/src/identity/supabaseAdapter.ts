// The Supabase Identity adapter: the only module in apps/web that imports supabase-js
// (dependency-cruiser enforces the containment). The rest of the app depends on the Identity
// port (types.ts), so the vendor stays swappable (DESIGN.md section 8).
//
// Auth runs against the custom domain (config.supabaseUrl, e.g. https://api.crossy.party) with
// the new-format publishable key (sb_publishable_...) passed as the key param; it is public by
// design. Discord and Apple OAuth and anonymous guests are the providers; email gets no surface.
import { createClient } from "@supabase/supabase-js";
import type {
  Session,
  SupabaseClient,
  SupabaseClientOptions,
  User,
} from "@supabase/supabase-js";
import type {
  GuestSignInOptions,
  GuestSignInResult,
  Identity,
  IdentitySession,
  SessionChangeCause,
  SignInProvider,
} from "./types";

/** Refresh the token when it has under a minute left, so REST and the WS hello get a fresh one. */
const REFRESH_THRESHOLD_SEC = 60;

/**
 * Port provider to the vendor's provider string. The strings coincide today, but the map is the
 * boundary: vendor vocabulary stays inside this adapter, so the port's union never leaks a Supabase
 * name and a divergence later is one edit here.
 */
const SUPABASE_PROVIDER: Record<SignInProvider, "discord" | "apple"> = {
  discord: "discord",
  apple: "apple",
};

/** Apple's hide-my-email relays land here; the local part is random junk, never a name. */
const APPLE_PRIVATE_RELAY_SUFFIX = "@privaterelay.appleid.com";

export interface SupabaseIdentityDeps {
  supabaseUrl: string;
  publishableKey: string;
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

/** Derive a display name from provider metadata, with sensible fallbacks (DESIGN.md section 8). */
function displayNameOf(user: User): string {
  if (user.is_anonymous === true) return "Guest";
  const meta = user.user_metadata as Record<string, unknown>;
  for (const key of ["full_name", "name", "user_name", "preferred_username"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  const email = typeof user.email === "string" ? user.email : "";
  // Apple's identity token carries no name, and its hide-my-email relay local part is random junk,
  // so skip the local-part fallback for those addresses and let "Player" stand.
  if (!email.endsWith(APPLE_PRIVATE_RELAY_SUFFIX)) {
    const local = email.split("@")[0];
    if (local !== undefined && local !== "") return local;
  }
  return "Player";
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

function toSession(session: Session | null): IdentitySession | null {
  if (session === null) return null;
  const user = session.user;
  return {
    userId: user.id,
    displayName: displayNameOf(user),
    isAnonymous: user.is_anonymous === true,
    avatarUrl: avatarUrlOf(user),
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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: SUPABASE_PROVIDER[provider],
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
    async signOut(): Promise<void> {
      await supabase.auth.signOut();
    },
    onChange(
      cb: (s: IdentitySession | null, cause: SessionChangeCause) => void,
    ): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
