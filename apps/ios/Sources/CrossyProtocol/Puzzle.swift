// The client puzzle (INV-6, DESIGN.md §4, §7; PROTOCOL.md §12). Twin of the client half
// of packages/protocol/src/puzzle.ts.
//
// INV-6 is structural here, deliberately more so than in the TS twin: this module
// defines NO `ServerPuzzle` and no `Solution` type at all. The solution-bearing shape
// exists only server-side; a client that cannot even spell the type cannot decode,
// hold, or re-encode a solution. INV6NoSolutionTests pins this with a reflection sweep
// and a decode-with-solution-present golden.
//
// PROTOCOL.md §12 pins the load-bearing fact (the solution split) and leaves the
// exhaustive puzzle schema (image clues, cross-references, per-cell numbering) to
// ingestion; this is the faithful minimal model the wire contract needs, matching
// `PuzzleBase` field for field.

/// One styled span of a clue's prose (clue-formatting wave, owner ruling 2026-07-12:
/// clue markup renders as structured runs, never stripped, never raw HTML). Twin of
/// the wire `ClueRun`: a piece of literal text `t` plus the styles `s` that wrap it.
///
/// Guarantees the server holds and the client relies on: the concatenation of a clue's
/// runs' `t` equals its plain `text`; runs are canonical (no empty runs, adjacent
/// equal-style runs pre-merged, style order "b","i","sub","sup"). Styles decode
/// tolerantly: an unknown style string is dropped by the mapper (forward compatibility,
/// so a newer server's style never breaks an older client), which is why `s` is
/// `[String]` here rather than an enum that would reject the unknown value and fail the
/// whole decode.
public struct ClueRun: Sendable, Equatable, Codable {
    /// The literal text of this span. The runs' `t` concatenate to the clue's `text`.
    public let t: String
    /// The styles wrapping this span ("i", "b", "sub", "sup"); absent when unstyled.
    /// Unknown strings are kept verbatim on decode so the mapper can ignore them,
    /// never rejected (a rejected value would fail the clue, contra the wave's rule).
    public let s: [String]

    public init(t: String, s: [String] = []) {
        self.t = t
        self.s = s
    }

    private enum CodingKeys: String, CodingKey { case t, s }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.t = try container.decode(String.self, forKey: .t)
        // `s` is optional-and-absent for an unstyled run (the wire omits it); a missing
        // or null field reads as no styles.
        self.s = try container.decodeIfPresent([String].self, forKey: .s) ?? []
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(t, forKey: .t)
        // Canonical form omits an empty style set, matching the wire (unstyled runs
        // carry no `s`), so a decode/encode round trip stays stable.
        if !s.isEmpty { try container.encode(s, forKey: .s) }
    }
}

/// A clue, structured at ingestion (DESIGN.md §7). No answer field, on either side of
/// the split. Twin of `Clue`.
///
/// `runs` is the additive clue-formatting field (owner ruling 2026-07-12): the styled
/// spelling of `text`. It is absent for unstyled clues and for every puzzle stored
/// before this feature, so plain `text` is the permanent fallback and the only field a
/// renderer ever needs. Decoding is deliberately tolerant: a missing or empty `runs`
/// means plain text, and a MALFORMED `runs` value (wrong shape, a bad element) also
/// falls back to nil rather than failing the clue, so one broken run can never sink a
/// whole puzzle decode. The custom `init(from:)` exists only for that swallow; the rest
/// of the shape stays the boring synthesized behavior.
public struct Clue: Sendable, Equatable, Codable {
    public let number: Int
    public let text: String
    public let cellIndices: [Int]
    /// The styled spelling of `text`, or nil for a plain clue. When present, the runs'
    /// `t` concatenate to `text` (the server's guarantee); when malformed on the wire,
    /// it decodes to nil and `text` carries the clue alone.
    public let runs: [ClueRun]?

    public init(number: Int, text: String, cellIndices: [Int], runs: [ClueRun]? = nil) {
        self.number = number
        self.text = text
        self.cellIndices = cellIndices
        self.runs = runs
    }

    private enum CodingKeys: String, CodingKey {
        case number, text, cellIndices, runs
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.number = try container.decode(Int.self, forKey: .number)
        self.text = try container.decode(String.self, forKey: .text)
        self.cellIndices = try container.decode([Int].self, forKey: .cellIndices)
        // Tolerant by design: a malformed `runs` must never sink the puzzle decode
        // (the wave's rule). `try?` swallows a wrong-shaped value to nil, leaving
        // `text` as the fallback; a truly absent field reads as nil too.
        self.runs = try? container.decodeIfPresent([ClueRun].self, forKey: .runs)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(number, forKey: .number)
        try container.encode(text, forKey: .text)
        try container.encode(cellIndices, forKey: .cellIndices)
        // Absent stays off the wire (the omit-when-nil posture, matching shadedCircles).
        try container.encodeIfPresent(runs, forKey: .runs)
    }
}

/// Across and down clue lists. Twin of `Clues`.
public struct Clues: Sendable, Equatable, Codable {
    public let across: [Clue]
    public let down: [Clue]

    public init(across: [Clue], down: [Clue]) {
        self.across = across
        self.down = down
    }
}

/// The only puzzle type on any client-facing payload (REST §12). No solution field,
/// transitively (INV-6). Twin of `ClientPuzzle` (= `PuzzleBase`). `shadedCircles` is
/// genuinely optional-and-absent (the TS field is `?`; ingestion omits it when empty),
/// so synthesized Codable's decodeIfPresent/encodeIfPresent is exactly right and the
/// conformance stays synthesized.
public struct ClientPuzzle: Sendable, Equatable, Codable {
    public let rows: Int
    public let cols: Int
    /// Black-square cell indices: unplayable and immutable (PROTOCOL.md §4).
    public let blocks: [Int]
    /// Circled cell indices, a visual overlay (DESIGN.md §2).
    public let circles: [Int]
    /// Shaded-circle cells, a render variant of circles (DESIGN.md §7). Absent when none.
    public let shadedCircles: [Int]?
    public let clues: Clues

    public init(
        rows: Int,
        cols: Int,
        blocks: [Int],
        circles: [Int],
        shadedCircles: [Int]? = nil,
        clues: Clues
    ) {
        self.rows = rows
        self.cols = cols
        self.blocks = blocks
        self.circles = circles
        self.shadedCircles = shadedCircles
        self.clues = clues
    }
}
