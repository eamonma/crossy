// The refresh grant, end to end: read the stored session, trade the refresh token,
// persist the rotated pair atomically, and map failures to the definitive/transient
// split (session.ts). Dependencies are injected so the rotation-ordering and
// failure-handling tests run pure.

import type { AuthTarget } from "./gotrue";
import { refreshGrant } from "./gotrue";
import type { RefreshFailure, StoredSession } from "./session";
import { classifyRefreshFailure, sessionFromTokenResponse } from "./session";
import type { StorageAreaLike } from "./store";
import { clearSession, loadSession, saveSession } from "./store";

export interface RefreshDeps {
  readonly target: AuthTarget;
  readonly area: StorageAreaLike;
  readonly fetchFn?: typeof fetch;
  /** Epoch seconds; injectable for tests. */
  readonly nowSec?: () => number;
}

export type RefreshOutcome =
  | { readonly ok: true; readonly session: StoredSession }
  | { readonly ok: false; readonly failure: RefreshFailure | "no_session" };

/**
 * Refresh the stored session. On success the rotated pair is persisted in a single
 * atomic write before this resolves, so the new refresh token is never lost to a
 * worker teardown between "received" and "stored". A definitive auth failure clears
 * the session (signed out); a transient failure leaves storage untouched so a later
 * retry still holds a valid refresh token.
 */
export async function refreshStoredSession(
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  const fetchFn = deps.fetchFn ?? fetch;
  const nowSec = deps.nowSec ?? (() => Math.floor(Date.now() / 1000));

  const current = await loadSession(deps.area);
  if (current === null) return { ok: false, failure: "no_session" };

  const result = await refreshGrant(deps.target, current.refreshToken, fetchFn);
  if (!result.ok) {
    const failure = classifyRefreshFailure(result.status);
    if (failure === "signed_out") await clearSession(deps.area);
    return { ok: false, failure };
  }

  const next = sessionFromTokenResponse(result.body, nowSec());
  if (next === null) {
    // A 200 with an unusable body is not a verdict on the credential: keep the
    // stored pair and let a later attempt retry.
    return { ok: false, failure: "retry" };
  }

  await saveSession(next, deps.area);
  return { ok: true, session: next };
}
