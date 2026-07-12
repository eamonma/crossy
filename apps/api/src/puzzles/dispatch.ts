// Multi-format ingest dispatch (PROTOCOL.md section 12; DESIGN.md section 7, D21; ROADMAP 6.1
// x1). `POST /puzzles` accepts two body forms and this module picks between them
// deterministically, never by guessing:
//
//   1. A JSON object carrying both a string `format` and a `document` key is the envelope
//      `{format, document}`: `format` names a registry entry, `document` is the raw outlet
//      payload, untransformed (the extension is deliberately dumb, DESIGN.md section 7).
//   2. A body without a `format` key is the legacy bare XWord Info document, byte-compatible
//      with the pre-envelope contract (equivalent to `format: "xwordinfo"`).
//   3. A body with `format` but no `document`, or a non-string `format`, is VALIDATION.
//
// Registry names are stable identifiers, never parsed for meaning and never case-folded: the
// lookup is an exact match, so no casing normalization exists to get wrong (INV-1 concerns
// values that are normalized or compared; here neither happens). An unknown name is
// UNKNOWN_FORMAT, whose message names the format and never echoes the document (INV-6
// discipline: rejection messages carry no document content on any path).
import type { ServerPuzzle } from "@crossy/protocol";
import { isObject, translateXwordInfo } from "./ingest";
import type { IngestErrorCode, IngestResult, PuzzleFeatures } from "./ingest";

/** A registered translator: one raw outlet document in, one IngestResult out (DESIGN.md 7). */
type Translator = (document: unknown) => IngestResult;

/**
 * The format registry (PROTOCOL.md section 12). A format joins by adding a translator, a name,
 * and its fixtures, never by widening an existing translator. A `Map` keeps the lookup free of
 * prototype-chain keys (`constructor` is not a format).
 */
const REGISTRY: ReadonlyMap<string, Translator> = new Map<string, Translator>([
  ["xwordinfo", translateXwordInfo],
]);

/** The legacy bare body is exactly `format: "xwordinfo"` (PROTOCOL.md section 12). */
const LEGACY_FORMAT = "xwordinfo";

/** Cap on the format string echoed in the UNKNOWN_FORMAT message; hygiene, not contract. */
const MAX_ECHOED_FORMAT = 100;

/** Every code dispatch can emit: a translator's, or the envelope-level UNKNOWN_FORMAT. */
export type DispatchErrorCode = IngestErrorCode | "UNKNOWN_FORMAT";

/**
 * One dispatched ingest: a translator's acceptance tagged with the registry format that
 * produced it (recorded in `puzzles.source`), or a single named rejection. Rejection messages
 * never echo document content (INV-6): the one client-controlled string a message may carry is
 * the format name itself, which is not the document.
 */
export type DispatchResult =
  | {
      readonly ok: true;
      /** The registry name that translated this document; `puzzles.source.format`. */
      readonly format: string;
      readonly puzzle: ServerPuzzle;
      readonly features: PuzzleFeatures;
      readonly title: string | null;
      readonly author: string | null;
    }
  | {
      readonly ok: false;
      readonly code: DispatchErrorCode;
      readonly message: string;
    };

/** Tag a translator's result with the format that produced it. */
function tagged(format: string, result: IngestResult): DispatchResult {
  if (!result.ok) return result;
  return {
    ok: true,
    format,
    puzzle: result.puzzle,
    features: result.features,
    title: result.title,
    author: result.author,
  };
}

/**
 * Dispatch one `POST /puzzles` body to its translator (PROTOCOL.md section 12). Form selection
 * is fixed and total:
 *
 *  1. a non-object body, or an object without a `format` key, is the legacy bare XWord Info
 *     document and goes to `translateXwordInfo` unchanged (byte-compatible legacy path)
 *  2. VALIDATION       `format` is present but not a string
 *  3. VALIDATION       `format` is a string but no `document` key is present
 *  4. UNKNOWN_FORMAT   `format` names no registry entry (message names the format only)
 *  5. the named translator runs on `document` exactly as extracted
 */
export function dispatchIngest(body: unknown): DispatchResult {
  // 1. The legacy form: anything that is not an object carrying a `format` key. A non-object
  //    body lands the same VALIDATION it always has, from the translator itself.
  if (!isObject(body) || !("format" in body)) {
    return tagged(LEGACY_FORMAT, translateXwordInfo(body));
  }

  // 2.
  const format = body["format"];
  if (typeof format !== "string") {
    return {
      ok: false,
      code: "VALIDATION",
      message: "format must be a string",
    };
  }

  // 3.
  if (!("document" in body)) {
    return {
      ok: false,
      code: "VALIDATION",
      message: "an envelope must carry a document",
    };
  }

  // 4. The message names the format (truncated for hygiene) and nothing else; the document is
  //    never echoed (INV-6 discipline).
  const translator = REGISTRY.get(format);
  if (translator === undefined) {
    return {
      ok: false,
      code: "UNKNOWN_FORMAT",
      message: `unknown format "${format.slice(0, MAX_ECHOED_FORMAT)}"`,
    };
  }

  // 5.
  return tagged(format, translator(body["document"]));
}
