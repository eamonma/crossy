// POST /puzzles from the extension (PROTOCOL.md section 12). The success view types
// its puzzle as ClientPuzzle: no solution field, structurally (INV-6). A named
// rejection comes back {error, message}; both are surfaced verbatim, never rewritten.

import type { ClientPuzzle } from "@crossy/protocol";
import type { Envelope } from "./envelope";

/**
 * The `POST /puzzles` success body: the API's PuzzleView. A fresh insert is `201`; a re-post the
 * caller already uploaded is `200` with the same shape plus `duplicate: true` (dedup, D23). The
 * extension is why dedup exists (it re-posts today's puzzle on every visit), so it dedups silently:
 * it keys success on `puzzleId` and treats `200` and `201` identically, ignoring `duplicate`.
 */
interface PuzzleView {
  readonly puzzleId: string;
  readonly puzzle: ClientPuzzle;
  readonly duplicate?: true;
}

export type IngestOutcome =
  | { readonly ok: true; readonly puzzleId: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export async function postPuzzle(
  apiBaseUrl: string,
  token: string,
  envelope: Envelope,
): Promise<IngestOutcome> {
  const response = await fetch(`${apiBaseUrl}/puzzles`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(envelope),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body; fall through to the status-only outcome.
  }

  // 201 fresh insert or 200 duplicate: both carry the PuzzleView, so a re-post of a puzzle the
  // user already has lands silently on the existing row (D23). Keying on puzzleId means a client
  // that ignores the `duplicate` marker loses nothing.
  if ((response.status === 201 || response.status === 200) && body !== null) {
    return { ok: true, puzzleId: (body as PuzzleView).puzzleId };
  }

  if (typeof body === "object" && body !== null && "error" in body) {
    const rejection = body as {
      readonly error: unknown;
      readonly message?: unknown;
    };
    if (typeof rejection.error === "string") {
      return {
        ok: false,
        code: rejection.error,
        message: typeof rejection.message === "string" ? rejection.message : "",
      };
    }
  }

  return {
    ok: false,
    code: `HTTP_${response.status}`,
    message: "unexpected response from the API",
  };
}
