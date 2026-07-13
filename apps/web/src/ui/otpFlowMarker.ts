// The same-browser marker for the email OTP flow. It lives in the UI/session layer, never in the
// Supabase adapter, so the vendor boundary stays clean (dependency-cruiser bars @supabase/* here).
// The marker is set when this browser starts an email sign-in (sendEmailOtp), and read on the
// /auth/confirm landing to decide whether a magic-link click began in THIS browser: present means
// verify silently (Claude.ai behavior), absent means a different device started the flow and we
// guide rather than auto-verify. It carries no secret: only the email and a timestamp, so a stale
// marker is harmless and simply ages out.
//
// This is not identity state, so it does not sit behind the Identity port; it is a local hint the
// confirm route consults. All reads and writes guard for an absent or throwing localStorage
// (private mode, storage disabled), degrading to "absent" rather than throwing.

/** The localStorage key. Namespaced so it never collides with another crossy.* value. */
const MARKER_KEY = "crossy.otp.pending";

/** A marker older than this reads as absent: a link clicked long after starting is treated as
 *  cross-device, so a day-old tab never silently verifies. One hour is generous for one sitting. */
const MARKER_TTL_MS = 60 * 60 * 1000;

/** The stored shape: the email the code was sent to, and when the flow started (epoch ms). */
export interface OtpFlowMarker {
  email: string;
  ts: number;
}

/** localStorage, or null when it is absent or throws on access (private mode, disabled storage). */
function safeStorage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/**
 * Record that this browser started an email OTP flow. Called from the modal the instant a code is
 * requested, before sendEmailOtp, so the marker is in place if the user finishes on a magic link.
 * A failed write is swallowed: the flow still works, the confirm route simply falls to the
 * cross-device guidance, which is the safe default.
 */
export function setOtpFlowMarker(
  email: string,
  now: number = Date.now(),
): void {
  const storage = safeStorage();
  if (storage === null) return;
  try {
    storage.setItem(MARKER_KEY, JSON.stringify({ email, ts: now }));
  } catch {
    // Quota or a serialization error: leave no marker rather than throw.
  }
}

/**
 * Read the marker if this browser started the flow within the TTL, else null. A missing, malformed,
 * or aged-out value is null (absent): the confirm route then shows the cross-device guidance and
 * its explicit escape hatch, never a silent verify. A validated marker is returned so the caller
 * can, if it likes, show the email it belongs to.
 */
export function readOtpFlowMarker(
  now: number = Date.now(),
): OtpFlowMarker | null {
  const storage = safeStorage();
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(MARKER_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const { email, ts } = record;
  if (typeof email !== "string" || typeof ts !== "number") return null;
  if (now - ts > MARKER_TTL_MS) return null;
  return { email, ts };
}

/** True when a valid, in-window marker exists: this browser began the flow. */
export function hasOtpFlowMarker(now: number = Date.now()): boolean {
  return readOtpFlowMarker(now) !== null;
}

/** Clear the marker. Called on a successful sign-in, so a later link click does not re-verify. */
export function clearOtpFlowMarker(): void {
  const storage = safeStorage();
  if (storage === null) return;
  try {
    storage.removeItem(MARKER_KEY);
  } catch {
    // Nothing to do: an unremovable marker simply ages out on its own.
  }
}
