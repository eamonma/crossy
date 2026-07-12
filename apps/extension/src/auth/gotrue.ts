// The three GoTrue calls the extension makes, hand-rolled over fetch (DESIGN.md in
// this app: no supabase-js). Every call sends the publishable key as the apikey
// header; it is public by design, the same key the web client ships in /config.json.

export interface AuthTarget {
  /** e.g. https://api.crossy.party (GoTrue under /auth/v1). */
  readonly authBaseUrl: string;
  readonly publishableKey: string;
}

export type GoTrueResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly status: number | null };

async function post(
  target: AuthTarget,
  path: string,
  body: unknown,
  fetchFn: typeof fetch,
  accessToken?: string,
): Promise<GoTrueResult> {
  const headers: Record<string, string> = {
    apikey: target.publishableKey,
    "content-type": "application/json",
  };
  if (accessToken !== undefined)
    headers["authorization"] = `Bearer ${accessToken}`;
  let response: Response;
  try {
    response = await fetchFn(`${target.authBaseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: null };
  }
  if (!response.ok) return { ok: false, status: response.status };
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: true, body: null };
  }
}

/** Exchange the captured auth code plus PKCE verifier for the first token pair. */
export function exchangeCode(
  target: AuthTarget,
  authCode: string,
  codeVerifier: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoTrueResult> {
  return post(
    target,
    "/auth/v1/token?grant_type=pkce",
    { auth_code: authCode, code_verifier: codeVerifier },
    fetchFn,
  );
}

/** Trade the refresh token for a new pair (GoTrue rotates on every grant). */
export function refreshGrant(
  target: AuthTarget,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<GoTrueResult> {
  return post(
    target,
    "/auth/v1/token?grant_type=refresh_token",
    { refresh_token: refreshToken },
    fetchFn,
  );
}

/**
 * Revoke this session server-side, best-effort: failures are swallowed because sign
 * out clears local storage regardless. scope=local so only the extension's session
 * dies; the web app and other devices stay signed in.
 */
export async function revokeSession(
  target: AuthTarget,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await post(target, "/auth/v1/logout?scope=local", {}, fetchFn, accessToken);
}
