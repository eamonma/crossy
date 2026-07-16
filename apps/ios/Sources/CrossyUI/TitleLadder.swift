// The solver-titles display table (design/post-game/TITLES.md; PROTOCOL.md §12): the
// client half of the award ladder. Who won what is decided server-side by the engine's
// TITLE_LADDER (packages/engine/src/titles.ts), the one authority, so no reducer twin
// exists here; this table owns only the words, and the words are the web's
// (apps/web/src/ui/titlesReadout.ts TITLE_COPY, mirrored string for string), so the
// same room reads identically on both platforms (ROADMAP Wave 10.6). Each entry
// follows its rung's evidence semantics: counts render as pluralized counts, the two
// whole-seconds rungs (the ice breaker's stall, the long hauler's span) render M:SS,
// and the two no-evidence rungs carry a fixed line. The copy obeys the amended law: a
// title cites its own number and nothing else — no rate, no rank, no two people's
// numbers against each other.
//
// Forward compatibility is the whole shape: a client MUST ignore an unknown title key
// (§12, how the ladder grows without client lockstep), so `card(for:)` answers nil for
// a key it does not know and the section simply renders one fewer card. Evidence rides
// as a count or null (INV-6, never a letter); a rung whose expected number did not
// arrive degrades to the label alone rather than inventing copy (the web's withCount).

/// One render-ready title card: whose it is, what the title is called, and the claim
/// line that rides under the name.
public struct TitleCard: Equatable, Sendable {
    public let userId: String
    /// The title's display name ("The saboteur").
    public let label: String
    /// The evidence-woven claim ("Overwrote 7 correct squares"), or nil when the rung
    /// cites a number the wire did not carry.
    public let detail: String?

    public init(userId: String, label: String, detail: String?) {
        self.userId = userId
        self.label = label
        self.detail = detail
    }
}

/// The pinned ladder's display copy, keyed by the wire's title keys.
public enum TitleLadder {
    /// The pinned keys, in ladder rank order (the TITLES.md ladder table; exactly the
    /// engine TITLE_LADDER's keys — v1's fifteen plus the D29 fast-follow's marathoner
    /// at rank 8). The wire already orders titles by rank, so this list exists to pin
    /// the display table's coverage, not to sort.
    public static let keys: [String] = [
        "saboteur",
        "one-hit-wonder",
        "ice-breaker",
        "bullseye",
        "headliner",
        "sprinter",
        "meddler",
        "marathoner",
        "quick-starter",
        "closer",
        "specialist",
        "long-hauler",
        "wanderer",
        "scribbler",
        "collector",
        "workhorse",
    ]

    /// The card for one wire title, or nil for an unknown key (skipped silently,
    /// PROTOCOL.md §12 forward compatibility). Copy is the web's TITLE_COPY verbatim.
    public static func card(for title: RoomTitle) -> TitleCard? {
        let e = title.evidence
        let copy: (label: String, detail: String?)
        switch title.key {
        case "saboteur":
            copy = ("The saboteur", e.map { "Overwrote \(counted($0, "correct square"))" })
        case "one-hit-wonder":
            // Evidence: none (the rung cites nothing); the copy is the whole claim.
            copy = ("The one-hit wonder", "One square, flawlessly chosen")
        case "ice-breaker":
            // Evidence: the room's stall in whole seconds, read as a duration. The D29
            // revisit re-based the stall onto within-sitting active time (TITLES.md, the
            // wrinkle retired), so the silence is one the room actually sat through; the
            // copy already read that way and did not move.
            copy = ("The ice breaker", e.map { "Ended the room's \(formatMSS($0)) silence" })
        case "bullseye":
            copy = ("The bullseye", e.map { "\(counted($0, "square")), none wrong" })
        case "headliner":
            // The marquee fallback never claims "theme", only the long answers
            // (TITLES.md marquee rule), so neither does the copy.
            copy = ("The headliner", e.map { "Led \($0) of the long ones" })
        case "sprinter":
            // 30 is the engine's BURST_WINDOW_MS in whole seconds, the window the
            // stat was counted over (the web derives this from the shared constant).
            copy = ("The sprinter", e.map { "\(counted($0, "square")) in 30 seconds" })
        case "meddler":
            copy = ("The meddler", e.map { "Finished \(counted($0, "word")) others started" })
        case "marathoner":
            // Evidence: the room's sitting count (always >= 2; the rung is silent in a
            // one-sitting room), so the plural branch is the only one that ever renders.
            copy = ("The marathoner", e.map { "Showed up for all \(counted($0, "sitting"))" })
        case "quick-starter":
            copy = ("The quick starter", e.map { "\(counted($0, "square")) in the opening stretch" })
        case "closer":
            copy = ("The closer", e.map { "\(counted($0, "square")) in the closing stretch" })
        case "specialist":
            copy = ("The specialist", e.map { "Kept to one corner, \(counted($0, "square"))" })
        case "long-hauler":
            // Evidence: the solver's span in whole seconds, read as a duration.
            copy = ("The long hauler", e.map { "On the case for \(formatMSS($0))" })
        case "wanderer":
            // Evidence: none; the territory is the claim.
            copy = ("The wanderer", "Roamed the whole grid")
        case "scribbler":
            // writes counts every event, clears included: letters put down, not kept.
            copy = ("The scribbler", e.map { "Busiest pencil, \(counted($0, "letter")) down" })
        case "collector":
            copy = ("The collector", e.map { "Had a hand in \(counted($0, "word"))" })
        case "workhorse":
            copy = ("The workhorse", e.map { "\(counted($0, "square")) filled" })
        default:
            return nil
        }
        return TitleCard(userId: title.userId, label: copy.label, detail: copy.detail)
    }

    /// "7 squares" / "1 square": a count with a naive plural, so a floor title earned
    /// on a single square never reads "1 squares" (the web's counted).
    private static func counted(_ n: Int, _ noun: String) -> String {
        "\(n) \(noun)\(n == 1 ? "" : "s")"
    }

    /// Whole seconds as the shared CrossyUI moment formatter (formatMSS in
    /// RoomAnalysis.swift): "M:SS", hours split out past sixty minutes ("1:01:40"),
    /// matching the web's formatMSS (apps/web analysisReadout.ts) byte for byte, the
    /// same formatter the Analysis header renders so both surfaces agree.
    private static func formatMSS(_ totalSeconds: Int) -> String {
        CrossyUI.formatMSS(Double(totalSeconds))
    }
}
