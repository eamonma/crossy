// Baked production defaults plus optional dev overrides (chrome.storage.local under
// "overrides"). The defaults matter: rest.crossy.party is the Crossy REST API and
// api.crossy.party is Supabase auth; pasting the auth host as the API base yields
// Kong's "requested path is invalid", which is why the API base is no longer user
// input in the normal path. Overrides exist only for local stacks (options page,
// advanced section).

/** The Crossy REST API (POST /puzzles lives here). */
export const DEFAULT_API_BASE = "https://rest.crossy.party";

/** Supabase auth custom domain (GoTrue under /auth/v1). */
export const DEFAULT_AUTH_BASE = "https://api.crossy.party";

/** The web app. The extension ingests; crossy.party plays (D22). Never user input. */
const WEB_ORIGIN = "https://crossy.party";

/** The signed-in library on the web app. */
export const WEB_LIBRARY_URL = `${WEB_ORIGIN}/puzzles`;

/**
 * The web app's play intent for one puzzle: where "Play in Crossy" lands after
 * ingest. The route is pinned by the web app; keeping it here makes a route
 * change a one-line diff.
 */
export function playIntentUrl(puzzleId: string): string {
  return `${WEB_ORIGIN}/puzzles?play=${encodeURIComponent(puzzleId)}`;
}

/** Public by design: the same publishable key the web client ships in /config.json. */
export const DEFAULT_PUBLISHABLE_KEY =
  "sb_publishable_Ms9_XHXO1KwRAbtxM0JrSA_drJ0r7Pd";

/** The dev overrides as stored; absent fields fall back to the baked defaults. */
export interface Overrides {
  readonly apiBaseUrl?: string;
  readonly authBaseUrl?: string;
  readonly publishableKey?: string;
}

/** The resolved bases every caller uses: overrides where set, defaults otherwise. */
export interface Bases {
  readonly apiBaseUrl: string;
  readonly authBaseUrl: string;
  readonly publishableKey: string;
}

const OVERRIDES_KEY = "overrides";

export async function loadOverrides(): Promise<Overrides> {
  const stored = await chrome.storage.local.get(OVERRIDES_KEY);
  const raw: unknown = stored[OVERRIDES_KEY];
  if (typeof raw !== "object" || raw === null) return {};
  const { apiBaseUrl, authBaseUrl, publishableKey } = raw as Partial<
    Record<keyof Overrides, unknown>
  >;
  const overrides: {
    apiBaseUrl?: string;
    authBaseUrl?: string;
    publishableKey?: string;
  } = {};
  if (typeof apiBaseUrl === "string" && apiBaseUrl !== "")
    overrides.apiBaseUrl = apiBaseUrl;
  if (typeof authBaseUrl === "string" && authBaseUrl !== "")
    overrides.authBaseUrl = authBaseUrl;
  if (typeof publishableKey === "string" && publishableKey !== "")
    overrides.publishableKey = publishableKey;
  return overrides;
}

export async function saveOverrides(overrides: Overrides): Promise<void> {
  await chrome.storage.local.set({ [OVERRIDES_KEY]: overrides });
}

export async function clearOverrides(): Promise<void> {
  await chrome.storage.local.remove(OVERRIDES_KEY);
}

export async function loadBases(): Promise<Bases> {
  const overrides = await loadOverrides();
  return {
    apiBaseUrl: overrides.apiBaseUrl ?? DEFAULT_API_BASE,
    authBaseUrl: overrides.authBaseUrl ?? DEFAULT_AUTH_BASE,
    publishableKey: overrides.publishableKey ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

/** Trim and canonicalize a pasted base URL; null when it is not an http(s) URL. */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return trimmed.replace(/\/+$/, "");
}

/**
 * The optional-host-permission origin pattern for a base URL. Match patterns carry
 * no port, so any port on the host is covered (the localhost dev case).
 */
export function originPattern(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

/**
 * Request access to one or more base URLs' origins, on demand, never at install.
 * Firefox law (observed on a real load, 2026-07-12): permissions.request must be
 * reached synchronously from the user input handler. Any await before it, a
 * contains() pre-check or a storage read, unwinds the gesture and Firefox throws
 * "permissions.request may only be called from a user input handler"; Chrome is
 * laxer, and the strict form works in both. That is also why this takes a list:
 * a second request after the first await is already outside the gesture, so
 * every origin a click needs rides one call. request resolves true without
 * prompting when everything asked for is already granted.
 */
export function requestOriginPermissions(
  baseUrls: readonly string[],
): Promise<boolean> {
  const origins = baseUrls.map(originPattern);
  return chrome.permissions.request({ origins });
}
