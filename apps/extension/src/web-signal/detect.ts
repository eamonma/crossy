// Best-effort "is a Crossy web session present?" read, run in a content script on
// crossy.party. The coupling to supabase-js's storage layout is deliberately loose:
// this is a hint, not a credential. supabase-js persists its session under a key
// shaped `sb-<ref>-auth-token` whose JSON value carries an `expires_at` in epoch
// seconds. We scan for any such key with a not-yet-expired session and answer a
// single boolean. If the key format changes or nothing matches, we answer false and
// the caller does nothing; the popup trigger still covers sign-in either way.
//
// This NEVER reads, forwards, or logs the tokens. The only thing that leaves this
// function is the boolean. The extension runs its OWN PKCE flow off this signal and
// mints its OWN session; it never borrows the web app's tokens (DESIGN.md).

/** The minimal storage shape this scan needs; a Storage or a plain map both fit. */
export interface LocalStorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

/** supabase-js's session storage key: sb-<project-ref>-auth-token. */
const SUPABASE_AUTH_KEY = /^sb-.*-auth-token$/;

/**
 * True when localStorage holds a supabase-js auth-token entry whose JSON parses to a
 * session object with a numeric expires_at strictly in the future. Everything else
 * (no matching key, unparseable value, missing or non-numeric expires_at, already
 * expired) is false. nowSec arrives as data so this stays pure.
 */
export function webSessionPresent(
  storage: LocalStorageLike,
  nowSec: number,
): boolean {
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key === null || !SUPABASE_AUTH_KEY.test(key)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const expiresAt = (parsed as Record<string, unknown>)["expires_at"];
    if (typeof expiresAt === "number" && expiresAt > nowSec) return true;
  }
  return false;
}
