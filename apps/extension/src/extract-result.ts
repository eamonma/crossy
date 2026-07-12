// The result an outlet extractor returns: the located document verbatim, or a reason
// it could not be found. Shared by every adapter (guardian, nyt, amuselabs) so each
// stays a pure locate-only function (D21: extraction-only). The messaging boundary
// tags a success with its format; the extractor itself never names one.

export type ExtractResult =
  | { readonly ok: true; readonly document: unknown }
  | { readonly ok: false; readonly reason: string };
