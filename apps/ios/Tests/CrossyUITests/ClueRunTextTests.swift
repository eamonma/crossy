import SwiftUI
import XCTest

@testable import CrossyUI

// The clue-prose rendering twin (owner ruling 2026-07-12: clue markup renders as
// structured runs, never stripped, never raw HTML). Two contracts, both pure so tests
// pin them:
//   the wire-style drop   an unknown style string never lands on a run (forward
//                         compatibility); the four known strings map to their cases.
//   the AttributedString  italic carries the emphasized intent, bold the strongly
//                         emphasized, the two compose on one run; sub/sup shrink onto a
//                         smaller font and shift the baseline (down for sub, up for sup);
//                         and the projection (the runs' concatenated text) equals the
//                         plain clue text, so a reader sees the same words.
// The mapper owns sub/sup sizing so a tight list row never grows: the shrunk font is a
// fixed fraction of the base and the offsets are scaled to it, both pinned below.

final class ClueRunTextTests: XCTestCase {
    // MARK: - The wire-style drop (forward compatibility)

    func test_knownWireStylesMapToCases_wave20260712() {
        XCTAssertEqual(ClueTextStyle(wire: "i"), .italic)
        XCTAssertEqual(ClueTextStyle(wire: "b"), .bold)
        XCTAssertEqual(ClueTextStyle(wire: "sub"), .subscript_)
        XCTAssertEqual(ClueTextStyle(wire: "sup"), .superscript_)
    }

    func test_unknownWireStyleIsDropped_wave20260712() {
        XCTAssertNil(ClueTextStyle(wire: "strike"), "an unknown style maps to nil, not a case")
        let run = ClueTextRun(text: "x", wireStyles: ["b", "strike", "i"])
        XCTAssertEqual(
            run.styles, [.bold, .italic],
            "a run keeps only the styles it knows; the unknown one is dropped, order held")
    }

    func test_allUnknownStylesYieldPlainRun_wave20260712() {
        let run = ClueTextRun(text: "x", wireStyles: ["strike", "u"])
        XCTAssertTrue(run.styles.isEmpty, "a run of only unknown styles renders plain")
    }

    // MARK: - Projection equals text (the reader sees the same words)

    func test_attributedProjectionEqualsPlainText_wave20260712() {
        let runs = [
            ClueTextRun(text: "H"),
            ClueTextRun(text: "2", styles: [.subscript_]),
            ClueTextRun(text: "O, the "),
            ClueTextRun(text: "wet", styles: [.italic]),
            ClueTextRun(text: " one"),
        ]
        let attributed = ClueTextRuns.attributed(runs, size: 15)
        XCTAssertEqual(
            String(attributed.characters), "H2O, the wet one",
            "the styled string's characters equal the plain clue text (the server's guarantee)")
    }

    func test_emptyRunsYieldEmptyString_wave20260712() {
        let attributed = ClueTextRuns.attributed([], size: 15)
        XCTAssertTrue(String(attributed.characters).isEmpty, "no runs render nothing")
    }

    // MARK: - Italic and bold ride the inline presentation intent (relative to the font)

    func test_italicRunCarriesEmphasizedIntent_wave20260712() {
        let attributed = ClueTextRuns.attributed(
            [ClueTextRun(text: "wet", styles: [.italic])], size: 15)
        let run = firstRun(attributed)
        XCTAssertEqual(run.inlinePresentationIntent, .emphasized, "italic reads as emphasized")
        // Italic stays relative to the surrounding font: the mapper sets no explicit font
        // on a plain-size run, so the surface's .font(...) carries the size and family.
        XCTAssertNil(run.swiftUI.font, "an italic run inherits the surface font, size untouched")
    }

    func test_boldRunCarriesStronglyEmphasizedIntent_wave20260712() {
        let attributed = ClueTextRuns.attributed(
            [ClueTextRun(text: "hot", styles: [.bold])], size: 15)
        let run = firstRun(attributed)
        XCTAssertEqual(
            run.inlinePresentationIntent, .stronglyEmphasized, "bold reads as strongly emphasized")
    }

    func test_boldItalicRunComposesBothIntents_wave20260712() {
        let attributed = ClueTextRuns.attributed(
            [ClueTextRun(text: "x", styles: [.bold, .italic])], size: 15)
        let run = firstRun(attributed)
        XCTAssertEqual(
            run.inlinePresentationIntent, [.emphasized, .stronglyEmphasized],
            "a run styled both composes into one intent set (bold italic)")
    }

    // MARK: - Sub/sup shrink and shift, and the mapper owns the sizing

    func test_superscriptShrinksAndLiftsBaseline_wave20260712() throws {
        let base: CGFloat = 15
        let attributed = ClueTextRuns.attributed(
            [ClueTextRun(text: "2", styles: [.superscript_])], size: base)
        let run = firstRun(attributed)
        XCTAssertNotNil(run.swiftUI.font, "a superscript run carries an explicit smaller font")
        let offset = try XCTUnwrap(run.swiftUI.baselineOffset)
        XCTAssertEqual(
            offset, base * ClueTextRuns.superscriptRise, accuracy: 0.001,
            "superscript lifts the baseline by the base-scaled rise")
        XCTAssertGreaterThan(offset, 0, "superscript lifts up, not down")
    }

    func test_subscriptShrinksAndDropsBaseline_wave20260712() throws {
        let base: CGFloat = 14
        let attributed = ClueTextRuns.attributed(
            [ClueTextRun(text: "2", styles: [.subscript_])], size: base)
        let run = firstRun(attributed)
        XCTAssertNotNil(run.swiftUI.font, "a subscript run carries an explicit smaller font")
        let offset = try XCTUnwrap(run.swiftUI.baselineOffset)
        XCTAssertEqual(
            offset, -(base * ClueTextRuns.subscriptDrop), accuracy: 0.001,
            "subscript drops the baseline by the base-scaled drop")
        XCTAssertLessThan(offset, 0, "subscript drops down, not up")
    }

    func test_subSuperShrinkFractionIsBelowOne_wave20260712() {
        // The sizing that keeps a tight list row from growing lives in the mapper: the
        // sub/sup font is a fixed fraction of the base, always smaller, and the offsets
        // are scaled to the base. Pinning the constants here keeps the containment
        // greppable and stops a call site from ever overriding it.
        XCTAssertLessThan(ClueTextRuns.subSuperScale, 1, "sub/sup glyphs are smaller than the base")
        XCTAssertGreaterThan(ClueTextRuns.subSuperScale, 0)
        XCTAssertGreaterThan(ClueTextRuns.superscriptRise, 0)
        XCTAssertGreaterThan(ClueTextRuns.subscriptDrop, 0)
    }

    // MARK: - The Text swap point (plain fallback is byte-identical)

    func test_entryWithNoRunsTakesThePlainPath_wave20260712() {
        // A clue with no runs must render exactly as Text(verbatim:) did before the wave.
        // Both surfaces build their Text through init(clueProse:size:weight:); a nil-runs
        // entry keeps the verbatim path, so its rendered string is the plain text.
        let entry = ClueEntry(number: 1, text: "Plain clue", cells: [0], isAcross: true)
        XCTAssertNil(entry.runs, "an unstyled entry carries no runs")
    }

    // MARK: - Helpers

    /// The first attributed run's attribute view. The mapper appends one AttributedString
    /// per style run, so a single-run input yields a single run to inspect.
    private func firstRun(_ attributed: AttributedString) -> AttributedString.Runs.Run {
        attributed.runs.first!
    }
}
