// MAIN-world content script, AmuseLabs (PuzzleMe) crossword frames only (manifest:
// world MAIN, document_start, all_frames, so it runs in the frame's own JS realm
// before any page script). Newer PuzzleMe builds encode rawc with a keyless
// per-build scramble the server cannot decode deterministically, so this script
// captures the page's OWN decode instead (owner ruling, 2026-07-12): the page ends
// its descramble in JSON.parse, and the first parsed value that looks like the
// puzzle document is deep-cloned and posted to the ISOLATED-world content script
// (content.ts) via window.postMessage (capture.ts pins the message and predicate).
//
// Safety posture, in order: the page's call is never altered (same value back,
// parse errors propagate unchanged, any capture fault is swallowed); capture
// retires on first match or after CAPTURE_WINDOW_MS, restoring the native
// JSON.parse; and a page that took an early reference to the wrapper keeps a
// permanent passthrough (the `capturing` guard).

import { capturedDocMessage, looksLikePuzzleMeDocument } from "./capture";

/** The frame decodes during load; well past this, stop looking and get out. */
const CAPTURE_WINDOW_MS = 30_000;

const original = JSON.parse;
let capturing = true;

function retire(): void {
  capturing = false;
  clearTimeout(timer);
  JSON.parse = original;
}

const timer = setTimeout(retire, CAPTURE_WINDOW_MS);

JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
  // The page's own semantics first and always: same value back, throws included.
  const value: unknown = original(text, reviver);
  if (capturing) {
    try {
      if (looksLikePuzzleMeDocument(value)) {
        // Clone before retiring so a clone failure leaves capture armed.
        const copy = structuredClone(value);
        retire();
        window.postMessage(capturedDocMessage(copy), location.origin);
      }
    } catch {
      // Never disturb the page's call: a capture fault is ours, not theirs.
    }
  }
  return value;
}) as typeof JSON.parse;
