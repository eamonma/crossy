// AmuseLabs (PuzzleMe) blob extraction. The encoded crossword blob is server-rendered
// into the frame; two forms have been seen:
//
//   1. The current form (confirmed against cdn3.amuselabs.com/pmm/crossword, 2026-07-11):
//      a <script type="application/json" id="params"> tag whose JSON object carries a
//      string `rawc` key (alongside rawp, rawConf, ...). A plain DOM read.
//   2. The classic form: an inline script assigning `window.rawc = "..."`. Read from the
//      script text (a script-tag read; no main-world injection).
//
// Both are located, not decoded (D21, extraction-only). PROTOCOL.md section 12 pins the
// `amuselabs` document as the raw encoded string exactly as found, or the page's own
// decoded puzzle object when the MAIN-world capture delivered one (capture.ts; the newer
// keyless builds no server decode can chase). Decoding a blob stays the server ACL's job,
// so a located blob is handed on verbatim.

import type { ExtractResult } from "../extract-result";

/** The params script tag that carries the blob in its JSON on current PuzzleMe frames. */
export const PARAMS_SCRIPT_SELECTOR = "script#params";

// The classic `rawc = "..."` assignment. Captured between the quotes verbatim, so the
// blob crosses unchanged whatever characters it holds.
const RAWC_ASSIGNMENT = /\brawc\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/** Locate the blob in the params script's JSON text. `null` means the tag was absent. */
export function parseAmuseParams(paramsJson: string | null): ExtractResult {
  if (paramsJson === null) {
    return { ok: false, reason: "no PuzzleMe params on this page" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    return { ok: false, reason: "PuzzleMe params are not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || !("rawc" in parsed)) {
    return { ok: false, reason: "PuzzleMe params carry no rawc" };
  }
  const rawc = (parsed as { readonly rawc: unknown }).rawc;
  if (typeof rawc !== "string" || rawc === "") {
    return { ok: false, reason: "PuzzleMe rawc is not a non-empty string" };
  }
  return { ok: true, document: rawc };
}

/** Locate a classic `rawc = "..."` assignment across the frame's inline script texts. */
export function extractRawcAssignment(
  scriptTexts: readonly string[],
): ExtractResult {
  for (const text of scriptTexts) {
    const match = RAWC_ASSIGNMENT.exec(text);
    if (match) {
      const blob = match[1] ?? match[2] ?? "";
      if (blob !== "") return { ok: true, document: blob };
    }
  }
  return { ok: false, reason: "no PuzzleMe rawc found on this page" };
}

/**
 * The one extraction reply: the page's own decoded document when the MAIN-world
 * capture delivered one, else the located rawc blob (params tag first, then the
 * classic assignment, its script texts read lazily). The reply's document is
 * therefore an object (captured decode) or a string (raw blob); the server's
 * amuselabs translator accepts both forms (PROTOCOL.md section 12).
 */
export function extractAmuseDocument(
  captured: Record<string, unknown> | null,
  paramsJson: string | null,
  readScriptTexts: () => readonly string[],
): ExtractResult {
  if (captured !== null) return { ok: true, document: captured };
  const fromParams = parseAmuseParams(paramsJson);
  if (fromParams.ok) return fromParams;
  const classic = extractRawcAssignment(readScriptTexts());
  return classic.ok ? classic : fromParams;
}
