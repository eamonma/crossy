// v1-dev auth settings: an API base URL and a bearer token pasted on the options page,
// held in chrome.storage.local (local, not sync: a token should not fan out across
// devices). The pairing handshake with the web app replaces this surface (DESIGN.md
// in this app).

export interface Settings {
  readonly apiBaseUrl: string;
  readonly token: string;
}

const KEY = "settings";

export async function loadSettings(): Promise<Settings | null> {
  const stored = await chrome.storage.local.get(KEY);
  const raw: unknown = stored[KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const { apiBaseUrl, token } = raw as Partial<Settings>;
  if (typeof apiBaseUrl !== "string" || apiBaseUrl === "") return null;
  if (typeof token !== "string" || token === "") return null;
  return { apiBaseUrl, token };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
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
 * Ensure the extension may reach the API origin. Requested on demand, never at
 * install; must run inside a user gesture (a click handler qualifies).
 */
export async function ensureOriginPermission(
  baseUrl: string,
): Promise<boolean> {
  const origins = [originPattern(baseUrl)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}
