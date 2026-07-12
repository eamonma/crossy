import Foundation
import XCTest

import CrossyProtocol

// The clue-formatting `runs` field (owner ruling 2026-07-12: clue markup renders as
// structured runs, never stripped, never raw HTML), decoded on every clue the puzzle
// carries. The additive, absent-tolerant contract these tests defend:
//   absent      a clue with no `runs` decodes with runs == nil (every pre-wave puzzle,
//               and every unstyled clue: plain `text` is the permanent fallback)
//   present     a well-formed `runs` array decodes to its spans; runs' `t` == `text`
//   unknown `s` an unrecognized style string SURVIVES decode verbatim (the mapper drops
//               it; the wire model keeps [String] so a newer server never fails decode)
//   malformed   a wrong-shaped `runs` (object, bad element, `t` missing) FALLS BACK to
//               nil and never sinks the clue, so `text` still carries it
//   whole-puzzle a malformed run inside one clue leaves the rest of the ClientPuzzle,
//               and every other clue, decoding cleanly
// The load-bearing case is malformed-falls-back: one broken run must never fail a whole
// puzzle decode. Twin of packages/protocol's clue-runs codec tests.

final class ClueRunsDecodeTests: XCTestCase {
    private func clue(_ extra: String) -> Data {
        Data(
            """
            {"number":1,"text":"Cat, informally","cellIndices":[0,1,2]\(extra)}
            """.utf8)
    }

    private func decodeClue(_ extra: String) throws -> Clue {
        try JSONDecoder().decode(Clue.self, from: clue(extra))
    }

    // MARK: - Absent (a pre-wave or unstyled clue decodes; text is the fallback)

    func test_clueRunsAbsentReadsAsNil_wave20260712() throws {
        let value = try decodeClue("")
        XCTAssertNil(value.runs, "an unstyled clue must still decode, runs nil")
        XCTAssertEqual(value.text, "Cat, informally", "text carries the clue alone")
    }

    func test_clueRunsNullReadsAsNil_wave20260712() throws {
        let value = try decodeClue(#","runs":null"#)
        XCTAssertNil(value.runs, "an explicit null runs reads as nil, not a decode failure")
    }

    // MARK: - Present (a well-formed runs array decodes; projection equals text)

    func test_clueRunsPresentDecodesSpans_wave20260712() throws {
        let value = try decodeClue(
            #","runs":[{"t":"Cat, "},{"t":"informally","s":["i"]}]"#)
        let runs = try XCTUnwrap(value.runs)
        XCTAssertEqual(runs.count, 2)
        XCTAssertEqual(runs[0], ClueRun(t: "Cat, "))
        XCTAssertEqual(runs[1], ClueRun(t: "informally", s: ["i"]))
    }

    func test_clueRunsProjectionEqualsText_wave20260712() throws {
        let value = try decodeClue(
            #","runs":[{"t":"Cat, "},{"t":"informally","s":["i"]}]"#)
        let projection = try XCTUnwrap(value.runs).map(\.t).joined()
        XCTAssertEqual(
            projection, value.text,
            "the server's guarantee: the runs' t concatenate to the plain text")
    }

    func test_clueRunAbsentStylesReadAsEmpty_wave20260712() throws {
        let value = try decodeClue(#","runs":[{"t":"Cat, informally"}]"#)
        XCTAssertEqual(try XCTUnwrap(value.runs).first?.s, [], "a run with no s decodes to no styles")
    }

    // MARK: - Unknown style (survives decode; the mapper drops it, not the codec)

    func test_clueRunUnknownStyleSurvivesDecode_wave20260712() throws {
        // Forward compatibility: a style the client does not know must not fail decode.
        // The wire model keeps the raw string; the CrossyUI mapper is what ignores it.
        let value = try decodeClue(#","runs":[{"t":"x","s":["b","strike"]}]"#)
        XCTAssertEqual(
            try XCTUnwrap(value.runs).first?.s, ["b", "strike"],
            "an unknown style is kept verbatim, never a decode failure")
    }

    // MARK: - Malformed (falls back to nil; text carries the clue, decode survives)

    func test_clueRunsWrongShapeFallsBackToNil_wave20260712() throws {
        // An object where an array belongs: swallowed to nil, clue still decodes.
        let value = try decodeClue(#","runs":{"t":"x"}"#)
        XCTAssertNil(value.runs, "a wrong-shaped runs falls back to nil, never fails the clue")
        XCTAssertEqual(value.text, "Cat, informally", "text stays the fallback")
    }

    func test_clueRunsBadElementFallsBackToNil_wave20260712() throws {
        // A run missing its required `t`: the array decode fails, and the clue swallows
        // it to nil rather than propagating the failure.
        let value = try decodeClue(#","runs":[{"s":["i"]}]"#)
        XCTAssertNil(value.runs, "a run with no t falls back to nil, never fails the clue")
    }

    func test_clueRunsNonStringStyleFallsBackToNil_wave20260712() throws {
        // A numeric style element makes the s array malformed, so the run and thus the
        // runs array fails to decode; the clue swallows it to nil.
        let value = try decodeClue(#","runs":[{"t":"x","s":[7]}]"#)
        XCTAssertNil(value.runs, "a non-string style falls back to nil, never fails the clue")
        XCTAssertEqual(value.text, "Cat, informally")
    }

    // MARK: - Whole-puzzle tolerance (one bad run never sinks the puzzle)

    func test_malformedRunNeverSinksTheWholePuzzleDecode_wave20260712() throws {
        // A ClientPuzzle whose first across clue carries a malformed runs and whose second
        // carries a good one: the whole puzzle decodes, the bad clue falls back to text,
        // and the good clue keeps its runs.
        let json = Data(
            """
            {
              "rows": 1, "cols": 3, "blocks": [], "circles": [],
              "clues": {
                "across": [
                  {"number":1,"text":"Bad","cellIndices":[0],"runs":{"broken":true}},
                  {"number":2,"text":"Good","cellIndices":[1],"runs":[{"t":"Good","s":["b"]}]}
                ],
                "down": []
              }
            }
            """.utf8)
        let puzzle = try JSONDecoder().decode(ClientPuzzle.self, from: json)
        XCTAssertEqual(puzzle.clues.across.count, 2, "the whole puzzle decodes")
        XCTAssertNil(puzzle.clues.across[0].runs, "the malformed clue falls back to text")
        XCTAssertEqual(puzzle.clues.across[0].text, "Bad")
        XCTAssertEqual(
            puzzle.clues.across[1].runs, [ClueRun(t: "Good", s: ["b"])],
            "a sibling clue's good runs are untouched by the bad one")
    }

    // MARK: - Re-encode posture (absent stays off the wire; present round-trips)

    func test_clueWithoutRunsStaysAbsentOnReencode_wave20260712() throws {
        let value = try decodeClue("")
        let reencoded = try JSONEncoder().encode(value)
        let keys = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: reencoded) as? NSDictionary).allKeys
        XCTAssertFalse(
            keys.contains { $0 as? String == "runs" },
            "an absent runs stays off the wire, never becomes null")
    }

    func test_clueRunsSurviveRoundTrip_wave20260712() throws {
        let value = try decodeClue(#","runs":[{"t":"Cat, "},{"t":"x","s":["b","i"]}]"#)
        let reencoded = try JSONEncoder().encode(value)
        let round = try JSONDecoder().decode(Clue.self, from: reencoded)
        XCTAssertEqual(round.runs, value.runs, "present runs survive a decode/encode/decode trip")
    }

    func test_clueRunEmptyStylesStayOffTheWire_wave20260712() throws {
        // Canonical form: an unstyled run carries no s on re-encode, so the round trip is
        // stable and matches the wire's unstyled-run spelling.
        let value = ClueRun(t: "plain")
        let reencoded = try JSONEncoder().encode(value)
        let keys = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: reencoded) as? NSDictionary).allKeys
        XCTAssertFalse(
            keys.contains { $0 as? String == "s" }, "an unstyled run's s stays off the wire")
    }
}
