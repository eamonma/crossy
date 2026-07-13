import Foundation
import XCTest

@testable import CrossyUI

// The display-name sanitizer's honesty (docs/design/name-onboarding.md §5, §9.4), pinned
// to vectors/identity/display-name.json exactly as the server validator and the web
// sanitizer are, so the three cannot drift (R6). INV-1 (ASCII-only casing) does NOT apply
// to names: a name is user content shown back verbatim, never folded (the cases assert
// "ada" stays "ada", "ADA" stays "ADA"). The vector carries two intents: `canonicalize`
// (the submit path: NFC + trim + collapse, then validate) and `sanitize` (the
// per-keystroke edge filter: strip disallowed scalars, cap at 40, no trim/collapse).

final class DisplayNameEntryTests: XCTestCase {
    // One vector case. `intent` selects which function runs; `then` is the expectation:
    // for canonicalize, `ok` with a `value` or `ok:false` with a `code`; for sanitize, a
    // `value` (the filter never rejects, it only cleans and caps).
    private struct Case: Decodable {
        let name: String
        let intent: String
        let input: String
        let then: Expectation
    }

    private struct Expectation: Decodable {
        let ok: Bool?
        let value: String?
        let code: String?
    }

    /// vectors/identity/display-name.json, from this file's compiled-in path (the
    /// SharedRESTFixtures / RepoLayout pattern): up four from the test file to the repo
    /// root, then into vectors/identity.
    private static let vectorURL: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // CrossyUITests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // apps/ios
        .deletingLastPathComponent()  // apps
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("vectors/identity/display-name.json")

    private func loadCases() throws -> [Case] {
        let data = try Data(contentsOf: Self.vectorURL)
        return try JSONDecoder().decode([Case].self, from: data)
    }

    func test_theVectorFileIsPresentAndNonEmpty() throws {
        let cases = try loadCases()
        XCTAssertFalse(
            cases.isEmpty, "vectors/identity/display-name.json must exist with cases")
    }

    // The sanitizer agrees with the shared spec on every vector case. INV-1: names are not
    // ASCII-folded; the casing-preserved cases prove it.
    func test_sanitizerAgreesWithTheSharedVector_INV1() throws {
        for testCase in try loadCases() {
            switch testCase.intent {
            case "canonicalize":
                assertCanonicalize(testCase)
            case "sanitize":
                assertSanitize(testCase)
            default:
                XCTFail("unknown vector intent \(testCase.intent) in \(testCase.name)")
            }
        }
    }

    // MARK: - Per-intent assertions

    /// The canonicalize + validate path. `ok:true` -> the canonical value equals `value`
    /// AND the name is complete (passes validation). `ok:false` -> the name is NOT complete
    /// (the client cannot submit it), and the vector's `code` is the rejection the server
    /// would answer; the client cannot key the exact code without re-running the block-list,
    /// so it asserts the coarse "isComplete is false" contract, which is what gates submit.
    private func assertCanonicalize(_ testCase: Case) {
        let canonical = DisplayNameEntry.canonicalize(testCase.input)
        if testCase.then.ok == true {
            XCTAssertEqual(
                canonical, testCase.then.value,
                "canonicalize(\(debug(testCase.input))) [\(testCase.name)]")
            XCTAssertTrue(
                DisplayNameEntry.isComplete(testCase.input),
                "isComplete should accept \(debug(testCase.input)) [\(testCase.name)]")
        } else {
            XCTAssertFalse(
                DisplayNameEntry.isComplete(testCase.input),
                "isComplete should reject \(debug(testCase.input)) "
                    + "(expected \(testCase.then.code ?? "?")) [\(testCase.name)]")
        }
    }

    /// The per-keystroke sanitize path: strips disallowed scalars and caps at 40 graphemes
    /// without trimming or collapsing whitespace. The vector's `value` is the exact expected
    /// output.
    private func assertSanitize(_ testCase: Case) {
        let sanitized = DisplayNameEntry.sanitize(testCase.input)
        XCTAssertEqual(
            sanitized, testCase.then.value,
            "sanitize(\(debug(testCase.input))) [\(testCase.name)]")
    }

    // MARK: - Focused spec assertions (INV-1 + block-list, greppable by invariant)

    func test_casingIsPreserved_namesAreNotASCIIFolded_INV1() {
        XCTAssertEqual(DisplayNameEntry.canonicalize("ada"), "ada")
        XCTAssertEqual(DisplayNameEntry.canonicalize("ADA"), "ADA")
        XCTAssertTrue(DisplayNameEntry.isComplete("ada"))
        XCTAssertTrue(DisplayNameEntry.isComplete("ADA"))
    }

    func test_capIsFortyGraphemes_aFamilyEmojiCountsAsOne() {
        // 40 'a' passes; 41 does not.
        XCTAssertTrue(DisplayNameEntry.isComplete(String(repeating: "a", count: 40)))
        XCTAssertFalse(DisplayNameEntry.isComplete(String(repeating: "a", count: 41)))
        // A multi-codepoint ZWJ family emoji is one grapheme, so it passes and is not
        // stripped by the lone-zero-width check (the ZWJ is inside the cluster).
        let family = "👨‍👩‍👧‍👦"
        XCTAssertEqual(family.count, 1)
        XCTAssertTrue(DisplayNameEntry.isComplete(family))
        XCTAssertEqual(DisplayNameEntry.sanitize(family), family)
    }

    func test_disallowedScalarsAreStrippedOnEdgeAndRejectedOnSubmit() {
        // A lone zero-width space is a single-scalar grapheme: stripped by sanitize,
        // rejected by isComplete (via the canonical value still carrying it if untrimmed,
        // but the field never holds it because sanitize runs on every keystroke).
        XCTAssertEqual(DisplayNameEntry.sanitize("Ada\u{200B}Lovelace"), "AdaLovelace")
        // Control chars and bidi overrides likewise.
        XCTAssertEqual(DisplayNameEntry.sanitize("Ada\u{0000}\u{202E}Lovelace"), "AdaLovelace")
        XCTAssertFalse(DisplayNameEntry.isComplete("Ada\nLovelace"))
    }

    private func debug(_ string: String) -> String {
        // Render control/zero-width scalars visibly so a failure message is readable.
        string.unicodeScalars.map { scalar in
            scalar.value < 0x20 || (0x200B...0x206F).contains(scalar.value)
                ? "U+\(String(scalar.value, radix: 16, uppercase: true))"
                : String(scalar)
        }.joined()
    }
}
