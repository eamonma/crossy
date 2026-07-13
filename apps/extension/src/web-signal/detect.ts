// Best-effort "is a Crossy web session present?" read, run in a content script on
// crossy.party. The coupling to supabase-js's storage layout is deliberately loose:
// this is a hint, not a credential. supabase-js persists its session under a key
// shaped `sb-<ref>-auth-token` whose JSON value carries an `expires_at` in epoch
// seconds. We scan for any such key with a not-yet-expired session and answer a
// single boolean. If the key format changes or nothing matches, we answer false and
// the caller does nothing; the popup trigger still covers sign-in either way.
//
// This NEVER reads, forwards, or logs the tokens. What leaves this module is the
// boolean and, for account alignment, the web account's identity (user id, provider,
// display name) but NEVER a token. The extension runs its OWN PKCE flow off this
// signal and mints its OWN session; it never borrows the web app's tokens (DESIGN.md).

import type { WebIdentity } from "../auth/messages";
import { displayNameOf } from "../auth/session";

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

/** The `provider` string, mapped to a Provider the extension can also sign in with. */
function steerableProvider(
  user: Record<string, unknown>,
): WebIdentity["provider"] | null {
  const appMeta =
    typeof user["app_metadata"] === "object" && user["app_metadata"] !== null
      ? (user["app_metadata"] as Record<string, unknown>)
      : {};
  const provider = appMeta["provider"];
  return provider === "discord" || provider === "apple" ? provider : null;
}

/**
 * The crossy.party account, for alignment, or null. Same live-session scan as
 * webSessionPresent, but it returns the account's identity: the Supabase user id (the
 * alignment key), the OAuth provider (to steer the extension at the same account), and
 * a display name. NEVER the tokens. Null when there is no live session, when the stored
 * value is malformed, or when the session is an unsteerable guest (a provider the
 * extension cannot use), in which case there is nothing to align to.
 *
 * supabase-js persists the session under a single `sb-<ref>-auth-token` key (no
 * chunking for localStorage; the SSR cookie adapter is the only chunker), so one
 * matching key holds the whole session object.
 */
export function readWebIdentity(
  storage: LocalStorageLike,
  nowSec: number,
): WebIdentity | null {
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
    const record = parsed as Record<string, unknown>;
    const expiresAt = record["expires_at"];
    if (typeof expiresAt !== "number" || expiresAt <= nowSec) continue;
    const user =
      typeof record["user"] === "object" && record["user"] !== null
        ? (record["user"] as Record<string, unknown>)
        : null;
    if (user === null) continue;
    const userId = user["id"];
    if (typeof userId !== "string" || userId === "") continue;
    const provider = steerableProvider(user);
    if (provider === null) continue;
    return { userId, provider, displayName: displayNameOf(user) };
  }
  return null;
}
