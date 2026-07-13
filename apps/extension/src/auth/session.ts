// The stored session shape and the pure decisions around it: parsing a GoTrue token
// response, expiry math, refresh scheduling, and the definitive-versus-transient
// refresh-failure split. No IO here; the clock arrives as data.
//
// The extension is a bearer holder, not a verifier: it never decodes or validates
// token claims. In particular, tokens minted under the api.crossy.party custom domain
// carry the Supabase ref-domain issuer; validating issuer (or anything else) here
// would be wrong twice over.

/** Refresh when the access token has this little life left (matches apps/web). */
export const REFRESH_MARGIN_SEC = 60;

/** Aim the scheduled refresh this far before expiry. */
export const ALARM_LEAD_SEC = 300;

/** Never schedule an alarm closer than this to now. */
const ALARM_FLOOR_SEC = 30;

export interface StoredSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch seconds. */
  readonly expiresAt: number;
  /**
   * The Supabase user id (`user.id`), read from the token response, never decoded
   * from the JWT (this stays a bearer holder). It is the account-identity key: the
   * extension's own session is aligned with the web app iff this matches the web
   * session's user id. Null only when a token response omits the user object.
   */
  readonly userId: string | null;
  readonly email: string | null;
  readonly displayName: string;
}

/** Apple's hide-my-email relays; the local part is random junk, never a name. */
const APPLE_PRIVATE_RELAY_SUFFIX = "@privaterelay.appleid.com";

/** Derive a display name from provider metadata, mirroring apps/web's fallbacks. */
export function displayNameOf(user: Record<string, unknown>): string {
  const meta =
    typeof user["user_metadata"] === "object" && user["user_metadata"] !== null
      ? (user["user_metadata"] as Record<string, unknown>)
      : {};
  for (const key of ["full_name", "name", "user_name", "preferred_username"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  const email = typeof user["email"] === "string" ? user["email"] : "";
  if (email !== "" && !email.endsWith(APPLE_PRIVATE_RELAY_SUFFIX)) {
    const local = email.split("@")[0];
    if (local !== undefined && local !== "") return local;
  }
  return "Player";
}

/**
 * Narrow a GoTrue token response (grant_type=pkce or refresh_token) to the stored
 * session, or null when the shape is wrong. expires_at (epoch seconds) is honored
 * when present; otherwise now + expires_in, the same computation supabase-js makes.
 */
export function sessionFromTokenResponse(
  raw: unknown,
  nowSec: number,
): StoredSession | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const accessToken = r["access_token"];
  const refreshToken = r["refresh_token"];
  if (typeof accessToken !== "string" || accessToken === "") return null;
  if (typeof refreshToken !== "string" || refreshToken === "") return null;

  let expiresAt: number;
  if (typeof r["expires_at"] === "number") {
    expiresAt = r["expires_at"];
  } else if (typeof r["expires_in"] === "number") {
    expiresAt = nowSec + r["expires_in"];
  } else {
    return null;
  }

  const user =
    typeof r["user"] === "object" && r["user"] !== null
      ? (r["user"] as Record<string, unknown>)
      : {};
  const email = typeof user["email"] === "string" ? user["email"] : null;
  const userId = typeof user["id"] === "string" ? user["id"] : null;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    userId,
    email,
    displayName: displayNameOf(user),
  };
}

/** True when the token is inside its refresh margin (or already expired). */
export function needsRefresh(
  expiresAt: number,
  nowSec: number,
  marginSec: number = REFRESH_MARGIN_SEC,
): boolean {
  return expiresAt - nowSec <= marginSec;
}

/**
 * When (epoch ms, for chrome.alarms) to run the scheduled refresh: ALARM_LEAD_SEC
 * before expiry, floored so an almost-expired token still gets a near-term alarm
 * rather than one in the past.
 */
export function refreshAlarmWhenMs(expiresAt: number, nowSec: number): number {
  const target = Math.max(expiresAt - ALARM_LEAD_SEC, nowSec + ALARM_FLOOR_SEC);
  return target * 1000;
}

export type RefreshFailure = "signed_out" | "retry";

/**
 * Classify a failed refresh grant. GoTrue answers a revoked, already-used, or
 * malformed refresh token with 400/401/403: a definitive verdict on the credential,
 * so the session is dead and the user signs out. Everything else (no response, 429,
 * 5xx, a misconfigured base answering 404) is transient: retry later, never sign out.
 */
export function classifyRefreshFailure(status: number | null): RefreshFailure {
  if (status === 400 || status === 401 || status === 403) return "signed_out";
  return "retry";
}
