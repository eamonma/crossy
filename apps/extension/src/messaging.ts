// The popup-to-content-script message contract. One request, one reply. The reply
// carries the outlet's format alongside the located document, so the popup builds the
// right {format, document} envelope (PROTOCOL.md section 12) without knowing which
// content script answered.

import type { PuzzleFormat } from "./envelope";
import type { ExtractResult } from "./extract-result";

export const EXTRACT_REQUEST = "crossy/extract" as const;

export interface ExtractRequest {
  readonly type: typeof EXTRACT_REQUEST;
}

export type ExtractResponse =
  | {
      readonly ok: true;
      readonly format: PuzzleFormat;
      readonly document: unknown;
    }
  | { readonly ok: false; readonly reason: string };

/** Tag an extractor result with its outlet format for the reply to the popup. */
export function respondWith(
  format: PuzzleFormat,
  result: ExtractResult,
): ExtractResponse {
  return result.ok ? { ok: true, format, document: result.document } : result;
}
