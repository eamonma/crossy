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

/**
 * The web app's play intent for one puzzle: where "Play in Crossy" lands after
 * ingest. The route is pinned by the web app; keeping it here makes a route
 * change a one-line diff.
 */
export function playIntentUrl(puzzleId: string): string {
  return `${WEB_ORIGIN}/puzzles?play=${encodeURIComponent(puzzleId)}`;
}

/**
 * The Crossy app's custom-scheme play intent, used where the app is present: iOS Safari,
 * where this extension ships inside the app, so the app is guaranteed installed. A tab the
 * worker opens programmatically never triggers a Universal Link, so the extension
 * deep-links the app directly; CrossyApp.onOpenURL routes `crossy://play/<id>` to the same
 * startGame the library uses. Chrome, Firefox, and desktop have no app and keep the web
 * intent above.
 */
export function appPlayUrl(puzzleId: string): string {
  return `crossy://play/${encodeURIComponent(puzzleId)}`;
}

/**
 * Safari sign-in redirect target. Safari has no identity.getRedirectURL and refuses to
 * redirect an OAuth provider to a custom-scheme (extension) URL, so redirect_to must be a
 * real hosted https page. This inert page's content script hands the ?code= back to the
 * worker (auth/callback.ts); the page must not run supabase-js, or the SPA would consume
 * the single-use code first. Pinned to the web origin; must be in the Supabase auth
 * redirect allowlist. Chrome and Firefox never use it (they capture via identity).
 */
export const AUTH_CALLBACK_URL = `${WEB_ORIGIN}/auth/ext/callback`;

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

/**
 * The crossword publisher sites this extension reads, as host-permission match patterns
 * (origin level, path wildcarded). The single source of truth for "the crossword sites"
 * the popup offers to enable in one tap; keep it in lockstep with public/manifest.json
 * content_scripts (add a site's content script, add its origin here). The Guardian ships
 * both the apex and www hosts, so both are listed; AmuseLabs runs under many subdomains,
 * so its pattern is wildcarded.
 *
 * Safari is why this exists: it withholds host access until the user grants it per site,
 * and content scripts stay dormant until then (a real puzzle page reads as "unsupported"
 * because the extractor never injected). Safari reliably prompts for a named-host list
 * from a gesture, where an all-urls request is flaky on iOS, so we ask for exactly these.
 */
export const PUZZLE_SITE_ORIGINS: readonly string[] = [
  "https://www.nytimes.com/*",
  "https://www.theguardian.com/*",
  "https://theguardian.com/*",
  "https://*.amuselabs.com/*",
];

/**
 * Request host access to every crossword site in one prompt (PUZZLE_SITE_ORIGINS). Like
 * requestOriginPermissions, this reaches permissions.request as its only browser call so
 * the Firefox gesture survives; the popup calls it straight from the click. Resolves true
 * without prompting when access is already held.
 */
export function requestPuzzleSitePermissions(): Promise<boolean> {
  return chrome.permissions.request({ origins: [...PUZZLE_SITE_ORIGINS] });
}

/**
 * Whether host access to every crossword site is already granted. A broad all-urls grant
 * ("Allow on Every Website") covers them, so this reads true for that user too and the
 * offer stays hidden. Called at render time, never inside a gesture, so its await is fine.
 */
export function hasPuzzleSitePermissions(): Promise<boolean> {
  return chrome.permissions.contains({ origins: [...PUZZLE_SITE_ORIGINS] });
}
