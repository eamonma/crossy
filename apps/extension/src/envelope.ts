// The {format, document} ingest envelope (PROTOCOL.md section 12). The extension is
// deliberately dumb (D21): the extracted document crosses this boundary verbatim,
// untransformed, and the server ACL is the single translation point.

/** The envelope `POST /puzzles` accepts for a Guardian extraction. */
export interface GuardianEnvelope {
  readonly format: "guardian";
  readonly document: unknown;
}

/** Wrap an extracted document. The document is passed through by reference, untouched. */
export function buildGuardianEnvelope(document: unknown): GuardianEnvelope {
  return { format: "guardian", document };
}
