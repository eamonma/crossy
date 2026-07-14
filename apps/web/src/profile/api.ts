// The profile data-access seam: GET /me and PATCH /me over the existing authedFetch transport
// (net/authedFetch), not Supabase PostgREST. The Identity adapter delegates to these so the
// port stays a thin, testable seam (DESIGN.md name-onboarding §6.1). authedFetch already does
// the one reactive 401 refresh-and-retry, so a token the server just rejected recovers here for
// free, and a transient failure is never a sign-out (INV-11).
import type { Bearer } from "../net/authedFetch";
import { authedFetch } from "../net/authedFetch";
import type {
  SetDisplayNameReason,
  SetDisplayNameResult,
  SetReactionSetReason,
  SetReactionSetResult,
  UserProfile,
} from "../identity/types";

// The payload and result types live on the Identity port (identity/types.ts), the single
// vocabulary the UI and both adapters share; this data-access file imports them and the port's
// adapters delegate here, so there is one shape and one decoder (DESIGN.md name-onboarding §6.1).
export type {
  SetDisplayNameReason,
  SetDisplayNameResult,
  SetReactionSetReason,
  SetReactionSetResult,
  UserProfile,
};

/** True for the three server-named 422 name rejections, so a decoded error maps to a reason. */
function isNameReason(code: string): code is SetDisplayNameReason {
  return (
    code === "NAME_REQUIRED" ||
    code === "NAME_TOO_LONG" ||
    code === "NAME_INVALID"
  );
}

/** True for the three server-named 422 reaction-set rejections (PROTOCOL.md §12). */
function isReactionSetReason(code: string): code is SetReactionSetReason {
  return (
    code === "REACTION_SET_LENGTH" ||
    code === "REACTION_SET_INVALID" ||
    code === "REACTION_SET_DUPLICATE"
  );
}

/** Narrow an unknown /me `reactionSet` field: an array of five-ish strings passes through, anything
 *  else (absent on an older server, null, a malformed shape) reads as null, the defaults. */
function toReactionSet(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry): entry is string => typeof entry === "string")) {
    return null;
  }
  return value;
}

/** Narrow an unknown JSON body to the /me payload shape, tolerating a missing `needsName`
 *  (an older server): fold it to `!isAnonymous && displayName === null`, the same rule. A
 *  missing `reactionSet` reads as null, the defaults (PROTOCOL.md §12). */
function toProfile(body: unknown): UserProfile {
  const o = (body ?? {}) as Record<string, unknown>;
  const userId = typeof o.userId === "string" ? o.userId : "";
  const displayName = typeof o.displayName === "string" ? o.displayName : null;
  const isAnonymous = o.isAnonymous === true;
  const avatarUrl = typeof o.avatarUrl === "string" ? o.avatarUrl : null;
  const needsName =
    typeof o.needsName === "boolean"
      ? o.needsName
      : !isAnonymous && displayName === null;
  const reactionSet = toReactionSet(o.reactionSet);
  return {
    userId,
    displayName,
    isAnonymous,
    avatarUrl,
    needsName,
    reactionSet,
  };
}

/** Parse a Retry-After header (delta-seconds, the shape the API's limiter sends) to ms, or
 *  undefined when absent or unparseable. */
function retryAfterMsOf(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (header === null) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isNaN(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}

/**
 * GET /me: the caller's self display identity. Throws on a non-2xx (the caller retries a failed
 * load rather than treating it as a session; a failed load is never a sign-out, INV-11). Returns
 * the decoded profile, `displayName` possibly null so the caller can detect the nameless state.
 */
export async function getMe(
  apiBase: string,
  bearer: Bearer,
): Promise<UserProfile> {
  const res = await authedFetch(bearer, `${apiBase}/me`);
  if (!res.ok) throw new Error(`GET /me ${res.status}`);
  return toProfile(await res.json());
}

/**
 * PATCH /me: write the caller's display name and adopt the canonical value the server returns.
 * Maps the server's typed failures to reasons the UI renders: a 422 to its NAME_* code, a 429 to
 * `rate_limited` (with the Retry-After delay), a transport failure or a 5xx to `network` (the
 * resilient submit auto-retries those), anything else to `unknown`. Never throws: every outcome
 * is a typed result so the onboarding and Settings surfaces stay a lockout-free retry.
 */
export async function setDisplayName(
  apiBase: string,
  bearer: Bearer,
  name: string,
): Promise<SetDisplayNameResult> {
  let res: Response;
  try {
    res = await authedFetch(bearer, `${apiBase}/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
  } catch {
    // authedFetch throws only when signed out (no bearer) or the transport failed outright;
    // both are transient here (a signed-out tab that raced a refresh recovers), so `network`.
    return { ok: false, reason: "network" };
  }

  if (res.ok) {
    return { ok: true, profile: toProfile(await res.json()) };
  }

  if (res.status === 429) {
    const retryAfterMs = retryAfterMsOf(res);
    return retryAfterMs === undefined
      ? { ok: false, reason: "rate_limited" }
      : { ok: false, reason: "rate_limited", retryAfterMs };
  }

  // A 5xx is a server fault the resilient submit should auto-retry, so surface it as network
  // (transport-shaped) rather than a terminal unknown.
  if (res.status >= 500) return { ok: false, reason: "network" };

  // A 4xx carries the standard { error, message } body; key on the stable code. A 422 NAME_* is
  // an inline field error; a 400 VALIDATION or a 401 is not user-fixable inline, so it is unknown
  // (the prefill is always valid, so a VALIDATION here means a client bug, not a user typo).
  let code = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") code = body.error;
  } catch {
    // A 4xx with no JSON body is unclassifiable; fall through to unknown.
  }
  if (isNameReason(code)) return { ok: false, reason: code };
  return { ok: false, reason: "unknown" };
}

/**
 * PATCH /me `{reactionSet}`: write the caller's personal reaction set (five emoji in slot order)
 * or reset it to the defaults (null), and adopt the canonical profile the server returns. The same
 * typed-result contract as setDisplayName: a 422 maps to its REACTION_SET_* code (an inline field
 * error), a 429 to `rate_limited` with the Retry-After delay, a transport failure or a 5xx to
 * `network`, anything else to `unknown`. Never throws.
 */
export async function setReactionSet(
  apiBase: string,
  bearer: Bearer,
  set: readonly string[] | null,
): Promise<SetReactionSetResult> {
  let res: Response;
  try {
    res = await authedFetch(bearer, `${apiBase}/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reactionSet: set }),
    });
  } catch {
    // authedFetch throws only when signed out (no bearer) or the transport failed outright;
    // both are transient here, so `network`.
    return { ok: false, reason: "network" };
  }

  if (res.ok) {
    return { ok: true, profile: toProfile(await res.json()) };
  }

  if (res.status === 429) {
    const retryAfterMs = retryAfterMsOf(res);
    return retryAfterMs === undefined
      ? { ok: false, reason: "rate_limited" }
      : { ok: false, reason: "rate_limited", retryAfterMs };
  }

  // A 5xx is a server fault a retry should absorb, so surface it as network (transport-shaped).
  if (res.status >= 500) return { ok: false, reason: "network" };

  // A 4xx carries the standard { error, message } body; key on the stable code. A 422
  // REACTION_SET_* is an inline field error; a 400 VALIDATION or a 401 is not user-fixable inline
  // (the client validator gates the shapes VALIDATION names), so it is unknown.
  let code = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") code = body.error;
  } catch {
    // A 4xx with no JSON body is unclassifiable; fall through to unknown.
  }
  if (isReactionSetReason(code)) return { ok: false, reason: code };
  return { ok: false, reason: "unknown" };
}
