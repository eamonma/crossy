import CrossyEngine

// The runner's single seam to the engine, mirroring the `bindings` map in vectors.test.ts.
// Each family the Wave 3 port implements is added to `bound` and gets a matching `case` in
// `run` that parses the vector, calls CrossyEngine, and asserts the vector's `then`; the
// family is then drained from apps/ios/vectors.skip.json. A family with no binding falls
// through to `.noEngineBinding`, which the foreign honest-failure guard relies on.
//
// Parity note vs vectors.test.ts: the TS guard reads `Object.keys(engine)` to notice the
// engine coming alive. Swift has no runtime module-symbol enumeration, so the anchor here
// is `bound`. This is if anything a tighter coupling: a `case` in `run` cannot name a
// CrossyEngine symbol that does not exist yet, so binding a family is a compile-time act,
// and `bound` is the checked mirror the guard tests read.
//
// The per-family runners mirror the `runReducer`/`runNavigation`/... functions in
// vectors.test.ts. The JSON-to-engine adapters and the assertion-rule comparison live in
// VectorEngineAdapter.swift; a runner throws `VectorMismatch` on a failed assertion, which
// the calling XCTest method surfaces as a located failure.
enum EngineBindings {
    /// Families the Wave 3 port implements. `check` was bound (D27), unbound at Wave 15.1
    /// when its contract became the attributed-majority vote flow (D32), and rebound here
    /// at Wave 15.5 once `applyWithVote` landed in CrossyEngine. Kept in sync with `run`
    /// and drained from vectors.skip.json as each binds.
    static let bound: Set<VectorFamily> = [.reducer, .navigation, .comparator, .completion, .check]

    /// Runs one case against the engine. Throws `.noEngineBinding` for any family the port
    /// has not implemented (which after Wave 3 is only the foreign client-store family).
    static func run(_ family: VectorFamily, rawCase: [String: Any]) throws {
        switch family {
        case .reducer:
            try runReducer(rawCase)
        case .navigation:
            try runNavigation(rawCase)
        case .comparator:
            try runComparator(rawCase)
        case .completion:
            try runCompletion(rawCase)
        case .check:
            try runCheck(rawCase)
        default:
            throw VectorError.noEngineBinding(family)
        }
    }

    // MARK: - Reducer

    /// Apply each command in `when` in mailbox order, threading state and accumulating
    /// events (INV-2). A rejection carries the PROTOCOL §11 code; the sequence has at most
    /// one, since every rejection case is a single command (vectors/README.md).
    private static func runReducer(_ c: [String: Any]) throws {
        guard let given = c["given"] as? [String: Any],
            let when = c["when"] as? [Any],
            let then = c["then"] as? [String: Any]
        else {
            throw VectorMismatch("reducer case missing given/when/then")
        }
        var state = buildBoardState(given)
        var events: [[String: Any]] = []
        var error: String?
        for step in when {
            guard let w = step as? [String: Any] else { continue }
            let result = reduce(state, asCommand(w))
            state = result.state
            for event in result.events { events.append(serializeCellSet(event)) }
            if let code = result.error { error = code.rawValue }
        }
        if let expectedEvents = then["events"] {
            try expectMatch(events as [Any], expectedEvents, "then.events")
        }
        if let expectedState = then["state"] {
            try expectMatch(serializeState(state), expectedState, "then.state")
        }
        // then.error extends the reducer shape; unasserted when absent (assertion rule).
        if then.keys.contains("error"), let expected = then["error"] {
            try expectMatch(jsonScalar(error), expected, "then.error")
        }
    }

    // MARK: - Navigation

    /// Dispatch on `when.op` (absent means `advance`, the seed's single-cell getNextCell).
    /// Each op fixes its own `when` inputs and `then` outputs (vectors/README.md).
    /// `then.direction` is asserted only for `tab`, the one op that can change axis.
    private static func runNavigation(_ c: [String: Any]) throws {
        guard let given = c["given"] as? [String: Any],
            let w = c["when"] as? [String: Any],
            let then = c["then"] as? [String: Any]
        else {
            throw VectorMismatch("navigation case missing given/when/then")
        }
        let grid = buildGrid(given)
        let op = (w["op"] as? String) ?? "advance"
        let direction = parseDirection(w["direction"] as? String)
        let from = intValue(w["from"]) ?? 0

        switch op {
        case "advance":
            let toward = parseToward(w["toward"] as? String)
            let canEscape = (w["canEscapeWord"] as? Bool) ?? true
            let cell = getNextCell(grid, direction, from, toward, canEscapeWord: canEscape)
            try expectInt(cell, then["cell"], "then.cell")
        case "wordBounds":
            let bounds = wordBounds(grid, direction, from)
            try expectInt(bounds.start, then["start"], "then.start")
            try expectInt(bounds.end, then["end"], "then.end")
        case "tab":
            let toward = parseToward(w["toward"] as? String)
            let result = tabTarget(grid, direction, from, toward, buildFilled(given))
            try expectInt(result.cell, then["cell"], "then.cell")
            try expectString(directionString(result.direction), then["direction"], "then.direction")
        case "typing":
            let cell = typingAdvance(grid, direction, from, buildFilled(given))
            try expectInt(cell, then["cell"], "then.cell")
        case "backspace":
            let cell = backspaceTarget(grid, direction, from, buildFilled(given))
            try expectInt(cell, then["cell"], "then.cell")
        default:
            throw VectorMismatch("unknown navigation op \"\(op)\"")
        }
    }

    // MARK: - Comparator

    /// Every value in `accept` must pass and every value in `reject` must fail for the case's
    /// `solution`. Casing is ASCII-only (INV-1); the Turkish dotted and dotless i in the
    /// suite prove a locale-aware port cannot slip through.
    private static func runComparator(_ c: [String: Any]) throws {
        guard let solution = c["solution"] as? String,
            let accept = c["accept"] as? [Any],
            let reject = c["reject"] as? [Any]
        else {
            throw VectorMismatch("comparator case missing solution/accept/reject")
        }
        for value in accept.compactMap({ $0 as? String }) where !matches(solution, value) {
            throw VectorMismatch("comparator solution \"\(solution)\": accept \"\(value)\" did not match")
        }
        for value in reject.compactMap({ $0 as? String }) where matches(solution, value) {
            throw VectorMismatch("comparator solution \"\(solution)\": reject \"\(value)\" matched")
        }
    }

    // MARK: - Completion

    /// Apply each command in mailbox order through the two-phase driver, accumulating the
    /// full sequenced stream. Concurrency collapses to this total order (PROTOCOL §10), and
    /// the level-triggered check re-runs on same-count overwrites (DESIGN §3). A rejected
    /// trailing command emits nothing (INV-4).
    private static func runCompletion(_ c: [String: Any]) throws {
        guard let given = c["given"] as? [String: Any],
            let when = c["when"] as? [Any],
            let then = c["then"] as? [String: Any]
        else {
            throw VectorMismatch("completion case missing given/when/then")
        }
        let solution = buildSolution(given)
        var state = buildBoardState(given)
        var events: [[String: Any]] = []
        for step in when {
            guard let w = step as? [String: Any] else { continue }
            let result = applyWithCompletion(state, asCommand(w), solution)
            state = result.state
            for event in result.events { events.append(serializeEvent(event)) }
        }
        if let expectedEvents = then["events"] {
            try expectMatch(events as [Any], expectedEvents, "then.events")
        }
        if let expectedState = then["state"] {
            try expectMatch(serializeState(state), expectedState, "then.state")
        }
    }

    // MARK: - Check

    /// The attributed check vote (PROTOCOL §10, D32): the vote driver's shape plus the
    /// reducer's rejection convention. Apply each command in mailbox order through
    /// `applyWithVote`, accumulating the sequenced stream (cell, completion, and the three
    /// vote events); a rejected command (GRID_NOT_FULL / GAME_NOT_ONGOING / VOTE_PENDING /
    /// NO_VOTE_OPEN / NOT_ELECTOR / ALREADY_VOTED) emits nothing, consumes no seq (INV-2),
    /// and surfaces its code for `then.error`. An expiry with no vote open is a silent no-op
    /// (no event, no error), so `error` is only set by a real rejection.
    private static func runCheck(_ c: [String: Any]) throws {
        guard let given = c["given"] as? [String: Any],
            let when = c["when"] as? [Any],
            let then = c["then"] as? [String: Any]
        else {
            throw VectorMismatch("check case missing given/when/then")
        }
        let solution = buildSolution(given)
        var state = buildBoardState(given)
        var events: [[String: Any]] = []
        var error: String?
        for step in when {
            guard let w = step as? [String: Any] else { continue }
            let result = applyWithVote(state, asVoteCommand(w), solution)
            state = result.state
            for event in result.events { events.append(serializeVoteEvent(event)) }
            if let code = result.error { error = code.rawValue }
        }
        if let expectedEvents = then["events"] {
            try expectMatch(events as [Any], expectedEvents, "then.events")
        }
        if let expectedState = then["state"] {
            try expectMatch(serializeState(state), expectedState, "then.state")
        }
        // then.error follows the reducer convention; unasserted when absent.
        if then.keys.contains("error"), let expected = then["error"] {
            try expectMatch(jsonScalar(error), expected, "then.error")
        }
    }
}
