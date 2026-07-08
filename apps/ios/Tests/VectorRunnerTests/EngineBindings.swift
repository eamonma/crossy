import CrossyEngine

// The runner's single seam to the engine, mirroring the `bindings` map in
// vectors.test.ts. CrossyEngine exports nothing today, so `bound` is empty and `run`
// always throws `.noEngineBinding`; the honest-failure guard proves it. The Wave 3
// Swift port adds each implemented family to `bound` and a matching `case` in `run` that
// decodes the vector and calls CrossyEngine, then removes the family from
// apps/ios/vectors.skip.json.
//
// Parity note vs vectors.test.ts: the TS guard reads `Object.keys(engine)` to notice the
// engine coming alive. Swift has no runtime module-symbol enumeration, so the anchor
// here is `bound`. This is if anything a tighter coupling: a `case` in `run` cannot name
// a CrossyEngine symbol that does not exist yet, so binding a family is a compile-time
// act, and `bound` is the checked mirror the guard tests read.
enum EngineBindings {
    /// Families the Wave 3 port implements. Empty until then; keep in sync with `run`.
    static let bound: Set<VectorFamily> = []

    /// Runs one case against the engine. Throws `.noEngineBinding` for any family the
    /// port has not implemented, which today is all of them.
    static func run(_ family: VectorFamily, rawCase: [String: Any]) throws {
        switch family {
        // Wave 3: add `case .reducer:` (etc.) that decode `rawCase` into the typed shape
        // and call CrossyEngine, asserting the vector's `then`.
        default:
            throw VectorError.noEngineBinding(family)
        }
    }
}
