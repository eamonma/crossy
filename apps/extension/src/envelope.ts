// The {format, document} ingest envelope (PROTOCOL.md section 12). The extension is
// deliberately dumb (D21): the extracted document crosses this boundary verbatim,
// untransformed, and the server ACL is the single translation point.

/** A format registered in PROTOCOL.md section 12 that this extension can extract. */
export type PuzzleFormat = "guardian" | "nyt" | "amuselabs";

/** The envelope `POST /puzzles` accepts. `document`'s shape is per-format (section 12). */
export interface Envelope {
  readonly format: PuzzleFormat;
  readonly document: unknown;
}

/** Wrap an extracted document. The document is passed through by reference, untouched. */
export function buildEnvelope(
  format: PuzzleFormat,
  document: unknown,
): Envelope {
  return { format, document };
}
