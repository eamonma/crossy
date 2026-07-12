// POST /puzzles from the extension (PROTOCOL.md section 12). The success view types
// its puzzle as ClientPuzzle: no solution field, structurally (INV-6). A named
// rejection comes back {error, message}; both are surfaced verbatim, never rewritten.

import type { ClientPuzzle } from "@crossy/protocol";
import type { GuardianEnvelope } from "./envelope";

/** The `POST /puzzles` 201 body: the API's PuzzleView. */
interface PuzzleView {
  readonly puzzleId: string;
  readonly puzzle: ClientPuzzle;
}

export type IngestOutcome =
  | { readonly ok: true; readonly puzzleId: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export async function postPuzzle(
  apiBaseUrl: string,
  token: string,
  envelope: GuardianEnvelope,
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

  if (response.status === 201 && body !== null) {
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
