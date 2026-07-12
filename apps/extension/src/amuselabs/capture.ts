// The captured-document channel between the MAIN-world capture script
// (page-capture.ts) and the ISOLATED-world content script (content.ts). Newer
// PuzzleMe builds ship a rawc with no embedded key and a per-build descramble
// schedule compiled into the frame's own JS, so the server cannot decode the blob
// deterministically (the ACL names that VALIDATION, D21: drift is absorbed by name,
// never by guessing). Instead the frame's own decode is captured: the page calls
// JSON.parse on the descrambled blob, and the wrapper hands the parsed puzzle
// document across worlds via window.postMessage. Everything here is pure so both
// worlds share one predicate and the JSON.parse wrapper stays thin.

/** The namespaced window message type carrying the captured document. */
export const CAPTURED_DOC_TYPE = "crossy/amuselabs-doc";

/** The window message the capture script posts: the type tag plus the document. */
export interface CapturedDocMessage {
  readonly type: typeof CAPTURED_DOC_TYPE;
  readonly document: Record<string, unknown>;
}

function isPositiveInt(x: unknown): boolean {
  return typeof x === "number" && Number.isInteger(x) && x > 0;
}

/**
 * True when a JSON.parse result looks like the PuzzleMe puzzle document: an object
 * carrying `box` and `placedWords` arrays and positive integer `w` and `h`.
 * Deliberately cheap (it runs inside the page's own JSON.parse calls) and
 * fail-closed: anything else passes through uncaptured. Full structural validation
 * stays server-side, in the ACL (PROTOCOL.md section 12).
 */
export function looksLikePuzzleMeDocument(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const doc = value as Record<string, unknown>;
  return (
    isPositiveInt(doc["w"]) &&
    isPositiveInt(doc["h"]) &&
    Array.isArray(doc["box"]) &&
    Array.isArray(doc["placedWords"])
  );
}

/** Build the message the capture script posts (one shape, pinned for both worlds). */
export function capturedDocMessage(
  document: Record<string, unknown>,
): CapturedDocMessage {
  return { type: CAPTURED_DOC_TYPE, document };
}

/**
 * Read one window `message` event into a captured document, or null. Same-window
 * messaging only: the sender must be this window itself and the event origin must
 * be this frame's own origin (both scripts run in the same frame; anything else is
 * noise or spoofing). The document is re-checked against the predicate on this
 * side, so a same-origin page script cannot hand the extension an arbitrary shape.
 */
export function readCapturedDocMessage(
  event: {
    readonly data: unknown;
    readonly origin: string;
    readonly source: unknown;
  },
  selfWindow: unknown,
  selfOrigin: string,
): Record<string, unknown> | null {
  if (event.source !== selfWindow || event.origin !== selfOrigin) return null;
  const data = event.data;
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record["type"] !== CAPTURED_DOC_TYPE) return null;
  const doc = record["document"];
  return looksLikePuzzleMeDocument(doc) ? doc : null;
}
