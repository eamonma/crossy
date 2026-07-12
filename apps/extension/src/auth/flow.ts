// Authorize-URL construction and redirect capture for the extension's own Supabase
// session (DESIGN.md in this app). The shapes match what supabase-js sends, minus the
// library: GoTrue's /authorize takes the provider, the redirect target, and the PKCE
// challenge; the redirect back to identity.getRedirectURL() carries ?code= on success
// or error/error_description (query or fragment) on failure.

/** The OAuth providers the product offers, matching apps/web's SignInProvider. */
export type Provider = "discord" | "apple";

/**
 * {AUTH_BASE}/auth/v1/authorize with provider, redirect_to, and the S256 challenge.
 * code_challenge_method is lowercase "s256" to match supabase-js byte for byte.
 */
export function buildAuthorizeUrl(
  authBaseUrl: string,
  provider: Provider,
  redirectUri: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    provider,
    redirect_to: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "s256",
  });
  return `${authBaseUrl}/auth/v1/authorize?${params.toString()}`;
}

export type CodeExtraction =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Pull the auth code out of the captured redirect URL. GoTrue puts ?code= in the
 * query on success; errors ride error/error_description in the query or, on some
 * paths, in the fragment. Surface the provider's description verbatim when present.
 */
export function extractCode(redirectUrl: string): CodeExtraction {
  let parsed: URL;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    return { ok: false, reason: "sign-in returned an unparseable redirect" };
  }
  const query = parsed.searchParams;
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));

  const code = query.get("code");
  if (code !== null && code !== "") return { ok: true, code };

  const description =
    query.get("error_description") ?? fragment.get("error_description");
  const error = query.get("error") ?? fragment.get("error");
  if (description !== null && description !== "")
    return { ok: false, reason: description };
  if (error !== null && error !== "") return { ok: false, reason: error };
  return { ok: false, reason: "sign-in returned no code" };
}
