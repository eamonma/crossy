// Boot-time runtime configuration for the web client. One immutable image serves every
// environment (DESIGN.md section 10): the values arrive at container start as /config.json,
// emitted from env by the nginx envsubst entrypoint (apps/web/nginx/default.conf.template),
// never baked into the bundle. In Vite dev there is no config.json, so we fall back to
// VITE_-prefixed env; with nothing set the empty config selects the mock identity adapter.
//
// INV-6: a client payload never carries a solution. config.json holds only public values;
// the Supabase publishable key is public by design. parseConfig keeps the shape closed, so
// no stray field (a solution or otherwise) ever survives the boundary.

/** The public runtime facts the client boots on. Exactly the /config.json shape. */
export interface AppConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiBase: string;
  guestsEnabled: boolean;
  turnstileSiteKey?: string;
  /** The external TestFlight join link. When set, the iOS "get the app" prompt shows;
   * empty (the default) keeps it hidden, so the deploy owns whether the prompt exists. */
  testflightUrl?: string;
}

const CONFIG_URL = "/config.json";

/** Coerce a JSON boolean or a stringified flag ("true"/"false"/"1"/"0") to a boolean. */
function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1";
  }
  return false;
}

function toStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Validate and narrow an untyped payload to AppConfig, or null if it is not an object.
 * The result carries only the five known fields, so nothing extra crosses the boundary.
 */
export function parseConfig(raw: unknown): AppConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const turnstile = toStr(r["turnstileSiteKey"]);
  const testflight = toStr(r["testflightUrl"]);
  const config: AppConfig = {
    supabaseUrl: toStr(r["supabaseUrl"]),
    supabasePublishableKey: toStr(r["supabasePublishableKey"]),
    apiBase: toStr(r["apiBase"]),
    guestsEnabled: toBool(r["guestsEnabled"]),
  };
  if (turnstile !== "") config.turnstileSiteKey = turnstile;
  // Absent when empty, so an unset deploy carries no prompt (and the shape stays
  // closed: only known fields survive parseConfig, INV-6 posture).
  if (testflight !== "") config.testflightUrl = testflight;
  return config;
}

/** Build a config from VITE_-prefixed env, the Vite dev fallback. Empty selects the mock. */
export function configFromEnv(
  env: Record<string, string | boolean | undefined>,
): AppConfig {
  // parseConfig always returns a config for an object input, so the assertion is total.
  return parseConfig({
    supabaseUrl: env["VITE_SUPABASE_URL"],
    supabasePublishableKey: env["VITE_SUPABASE_PUBLISHABLE_KEY"],
    apiBase: env["VITE_API_BASE"],
    guestsEnabled: env["VITE_GUESTS_ENABLED"],
    turnstileSiteKey: env["VITE_TURNSTILE_SITE_KEY"],
    testflightUrl: env["VITE_TESTFLIGHT_URL"],
  }) as AppConfig;
}

export interface LoadConfigOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** Injectable env; defaults to import.meta.env. */
  env?: Record<string, string | boolean | undefined>;
  /** True in Vite dev; defaults to import.meta.env.DEV. */
  isDev?: boolean;
  /** Overridable for tests; defaults to /config.json. */
  url?: string;
}

/**
 * Resolve the runtime config. Fetches /config.json first (the deployed image serves it from
 * env). If that is missing or not valid config (the dev server and the e2e static server both
 * fall the SPA back to index.html for unknown paths, so the fetch yields HTML, not JSON), fall
 * back to VITE_-prefixed env. An empty result is intentional: it selects the mock adapter.
 */
export async function loadConfig(
  opts: LoadConfigOptions = {},
): Promise<AppConfig> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const env = opts.env ?? import.meta.env;
  const isDev = opts.isDev ?? import.meta.env.DEV;
  const url = opts.url ?? CONFIG_URL;

  try {
    const res = await fetchFn(url);
    if (res.ok) {
      const parsed = parseConfig(await res.json());
      if (parsed !== null) return parsed;
    }
  } catch {
    // Missing, non-JSON, or unreachable: fall through to the env fallback below.
  }

  if (!isDev) {
    console.warn(
      "crossy: /config.json missing or invalid; running with empty config (mock identity)",
    );
  }
  return configFromEnv(env);
}
