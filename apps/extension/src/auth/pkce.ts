// PKCE for the hand-rolled Supabase OAuth flow (RFC 7636). No library: a verifier is
// random bytes base64url-encoded, the challenge is base64url(SHA-256(verifier)) with
// method S256. WebCrypto supplies the hash; randomness arrives as bytes so the
// encoding stays a pure function under test.

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64url without padding (RFC 4648 section 5), the PKCE encoding. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += B64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += B64URL[b2 & 0x3f];
  }
  return out;
}

/**
 * Encode 32 random octets as a 43-character verifier (RFC 7636 section 4.1). The
 * caller supplies the bytes (crypto.getRandomValues in the worker) so this stays pure.
 */
export function generateVerifier(randomBytes: Uint8Array): string {
  return base64UrlEncode(randomBytes);
}

/** The S256 code challenge for a verifier: base64url(SHA-256(ascii(verifier))). */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(new Uint8Array(digest));
}
