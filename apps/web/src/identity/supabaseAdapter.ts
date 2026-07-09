// The Supabase Identity adapter: the only module in apps/web that imports supabase-js
// (dependency-cruiser enforces the containment). The rest of the app depends on the Identity
// port (types.ts), so the vendor stays swappable (DESIGN.md section 8).
//
// Auth runs against the custom domain (config.supabaseUrl, e.g. https://api.crossy.me) with
// the new-format publishable key (sb_publishable_...) passed as the key param; it is public by
// design. Discord OAuth and anonymous guests are the only providers; email gets no surface.
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
} from "./types";

/** Refresh the token when it has under a minute left, so REST and the WS hello get a fresh one. */
const REFRESH_THRESHOLD_SEC = 60;

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
  const local = email.split("@")[0];
  return local !== undefined && local !== "" ? local : "Player";
}

function toSession(session: Session | null): IdentitySession | null {
  if (session === null) return null;
  const user = session.user;
  return {
    userId: user.id,
    displayName: displayNameOf(user),
    isAnonymous: user.is_anonymous === true,
  };
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
  const listeners = new Set<(s: IdentitySession | null) => void>();

  supabase.auth.onAuthStateChange((_event, session) => {
    current = toSession(session);
    for (const cb of listeners) cb(current);
  });

  async function freshSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession();
    let session = data.session;
    if (session === null) return null;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at;
    if (
      typeof expiresAt === "number" &&
      expiresAt - now < REFRESH_THRESHOLD_SEC
    ) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error === null && refreshed.data.session !== null) {
        session = refreshed.data.session;
      }
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
    async signInWithDiscord(redirectPath?: string): Promise<void> {
      const { origin, pathAndQuery } = currentUrl();
      const redirectTo = `${origin}${redirectPath ?? pathAndQuery}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "discord",
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
    onChange(cb: (s: IdentitySession | null) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
