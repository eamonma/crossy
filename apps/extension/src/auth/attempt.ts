// The PKCE OAuth attempt, from authorize URL through the atomic session persist.
// Both the interactive button flow and the silent (interactive:false) flow run
// exactly this: same PKCE challenge/verifier, same authorize-URL builder, same
// code->token exchange, same store write. The only differences live at the call
// sites: whether launchWebAuthFlow is interactive, and how a failure is reported.
// Sharing the tail keeps the two flows byte-identical on the wire, so a silent
// sign-in yields the same independent, rotating session an interactive one does.

import type { Provider } from "./flow";
import { buildAuthorizeUrl, extractCode } from "./flow";
import type { AuthTarget } from "./gotrue";
import { exchangeCode } from "./gotrue";
import { generateVerifier, s256Challenge } from "./pkce";
import type { StoredSession } from "./session";
import { sessionFromTokenResponse } from "./session";
import type { StorageAreaLike } from "./store";
import { saveSession } from "./store";

/** How the attempt drives the browser identity flow, injected so tests stay pure. */
export interface AttemptDeps {
  readonly target: AuthTarget;
  readonly area: StorageAreaLike;
  /** identity.getRedirectURL(). */
  readonly redirectUri: string;
  /**
   * identity.launchWebAuthFlow, curried with interactivity by the caller. Resolves
   * the captured redirect URL, or undefined/throw when the flow yields nothing (a
   * cancel, or, with interactive:false, no live provider session to complete it).
   */
  readonly launch: (url: string) => Promise<string | undefined>;
  /** crypto.getRandomValues target; injectable for deterministic verifier tests. */
  readonly randomBytes: (out: Uint8Array) => void;
  /** Epoch seconds. */
  readonly nowSec: () => number;
  readonly fetchFn?: typeof fetch;
}

export type AttemptResult =
  | { readonly ok: true; readonly session: StoredSession }
  | { readonly ok: false; readonly reason: string };

/**
 * Run one PKCE OAuth attempt and, on success, persist the session atomically
 * (store.ts rotation safety) before resolving. This does not arm the refresh
 * alarm or touch any single-flight state; the worker owns that around the call.
 * A failure here is just a reason string. What a failure *means* (fatal to a
 * button flow, or silently "no session available") is the caller's to decide;
 * this attempt clears nothing and signs nothing out.
 */
export async function runPkceAttempt(
  provider: Provider,
  deps: AttemptDeps,
): Promise<AttemptResult> {
  const bytes = new Uint8Array(32);
  deps.randomBytes(bytes);
  const verifier = generateVerifier(bytes);
  const challenge = await s256Challenge(verifier);
  const url = buildAuthorizeUrl(
    deps.target.authBaseUrl,
    provider,
    deps.redirectUri,
    challenge,
  );

  let redirect: string | undefined;
  try {
    redirect = await deps.launch(url);
  } catch {
    return { ok: false, reason: "sign-in was cancelled" };
  }
  if (redirect === undefined) {
    return { ok: false, reason: "sign-in was cancelled" };
  }

  const extraction = extractCode(redirect);
  if (!extraction.ok) return { ok: false, reason: extraction.reason };

  const result = await exchangeCode(
    deps.target,
    extraction.code,
    verifier,
    deps.fetchFn,
  );
  if (!result.ok) {
    return {
      ok: false,
      reason:
        result.status === null
          ? `could not reach ${deps.target.authBaseUrl}`
          : `token exchange failed (HTTP ${result.status})`,
    };
  }
  const session = sessionFromTokenResponse(result.body, deps.nowSec());
  if (session === null) {
    return { ok: false, reason: "unexpected token response" };
  }
  await saveSession(session, deps.area);
  return { ok: true, session };
}
