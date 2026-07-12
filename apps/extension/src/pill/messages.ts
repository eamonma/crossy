// The pill-to-service-worker play contract (D22). One request, one reply. The pill
// hands over the already-extracted {format, document} pair; the worker owns the
// token, the POST, and the new tab, because a content script can do none of those.

import type { PuzzleFormat } from "../envelope";

export const PLAY_REQUEST = "crossy/play" as const;

export interface PlayRequest {
  readonly type: typeof PLAY_REQUEST;
  readonly format: PuzzleFormat;
  readonly document: unknown;
}

/**
 * "signed_out" and "no_permission" both send the solver to the toolbar popup, the
 * invariant path: only its click gesture can sign in or grant the API origin.
 * "network" is retryable from the pill. "rejected" carries the server's named
 * rejection verbatim (PROTOCOL.md section 12), never rewritten.
 */
export type PlayReply =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "signed_out" | "no_permission" | "network";
    }
  | {
      readonly ok: false;
      readonly reason: "rejected";
      readonly code: string;
      readonly message: string;
    };
