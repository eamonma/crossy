// Session persistence in chrome.storage.local (local, not sync: a refresh token must
// not fan out across devices). The storage area is injectable so the rotation tests
// run against a fake. Rotation safety: saveSession writes the whole pair in one
// atomic set, so the new refresh token is durable in the same instant the old one
// leaves; there is no window where neither token is on disk.

import type { StoredSession } from "./session";

export const SESSION_KEY = "authSession";

/** The slice of chrome.storage.local this module needs; injectable for tests. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/** The real extension storage, wrapped to the narrow interface. */
export function chromeLocalArea(): StorageAreaLike {
  return {
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
    remove: (key) => chrome.storage.local.remove(key),
  };
}

export async function loadSession(
  area: StorageAreaLike,
): Promise<StoredSession | null> {
  const stored = await area.get(SESSION_KEY);
  const raw: unknown = stored[SESSION_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Partial<StoredSession>;
  if (typeof s.accessToken !== "string" || s.accessToken === "") return null;
  if (typeof s.refreshToken !== "string" || s.refreshToken === "") return null;
  if (typeof s.expiresAt !== "number") return null;
  return {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    expiresAt: s.expiresAt,
    email: typeof s.email === "string" ? s.email : null,
    displayName: typeof s.displayName === "string" ? s.displayName : "Player",
  };
}

/** One set call: the new pair lands atomically, replacing the old (rotation safety). */
export async function saveSession(
  session: StoredSession,
  area: StorageAreaLike,
): Promise<void> {
  await area.set({ [SESSION_KEY]: session });
}

export async function clearSession(area: StorageAreaLike): Promise<void> {
  await area.remove(SESSION_KEY);
}
