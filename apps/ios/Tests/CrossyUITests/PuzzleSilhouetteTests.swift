import XCTest

@testable import CrossyUI

// The puzzle silhouette's mask parse (EXPERIENCE.md §3 Rooms), the iOS twin of the web's
// `Silhouette` and of the server's `deriveMask` (packages/protocol). The parse is pure,
// so it pins headlessly: the mask is the black-square pattern only (PROTOCOL.md §12), read
// row-major exactly as the board indexes cells, and it can never paint a fill from anything
// but the block glyph (INV-6: a mask carries a pattern, never a letter or a solution).

final class PuzzleSilhouetteTests: XCTestCase {
    func test_parseBlocks_indexesRowMajor_PROTOCOL12() {
        // §12: cell index is `r * cols + c`, the board's own indexing. The 2x2 mask
        // ["#.", ".#"] blocks the two diagonal corners: indices 0 and 3 (twin of the TS
        // deriveMask 2x2 golden, packages/protocol inv6-no-solution-leak.test.ts).
        XCTAssertEqual(
            PuzzleSilhouette.parseBlocks(mask: ["#.", ".#"], rows: 2, cols: 2),
            [0, 3])
    }

    func test_parseBlocks_readsTheHashPatternAtTrueCoordinates_PROTOCOL12() {
        // A 3x4 mask (twin of the TS deriveMask 3x4 golden): a block at row 0 col 1 and at
        // row 2 col 3 is indices 1 and 11 (1 = 0*4+1, 11 = 2*4+3), nothing else.
        XCTAssertEqual(
            PuzzleSilhouette.parseBlocks(mask: [".#..", "....", "...#"], rows: 3, cols: 4),
            [1, 11])
    }

    func test_emptyMaskYieldsNoBlocks_soItFallsBackToTheBareLattice_PROTOCOL14() {
        // §14 additive tolerance: an older server that predates the mask (or a fixture that
        // carries none) sends an empty mask; the silhouette then draws the bare geometry
        // lattice, exactly the fingerprint, never a crash or an invented block.
        XCTAssertEqual(PuzzleSilhouette.parseBlocks(mask: [], rows: 15, cols: 15), [])
        XCTAssertTrue(PuzzleSilhouette(rows: 15, cols: 15, mask: []).blocks.isEmpty)
    }

    func test_onlyTheBlockGlyphFills_soNoLetterCanLeakAsAFill_INV6() {
        // INV-6: the mask is a pattern, never a letter. Only `#` is a block; every other
        // glyph (`.` or anything unexpected, like a letter that could never legitimately
        // appear) reads as playable, so no non-pattern content can ever paint a fill.
        XCTAssertEqual(
            PuzzleSilhouette.parseBlocks(mask: ["#A", ".."], rows: 2, cols: 2),
            [0],
            "the letter reads as playable; only the block glyph fills")
        XCTAssertEqual(
            PuzzleSilhouette.parseBlocks(mask: ["....", "...."], rows: 2, cols: 4),
            [],
            "an all-playable mask yields no blocks")
    }

    func test_shortOrRaggedMaskLeavesMissingCellsPlayable() {
        // Defensive: a mask with fewer rows than `rows`, or a row shorter than `cols`, never
        // crashes; the missing cells simply read as playable. Here only row 0's two present
        // `#` count (indices 0, 1); the absent rows 1 and 2 contribute nothing.
        XCTAssertEqual(
            PuzzleSilhouette.parseBlocks(mask: ["##"], rows: 3, cols: 3),
            [0, 1])
    }

    func test_maskLargerThanGeometryNeverPaintsOutsideTheLattice() {
        // A mask whose geometry disagrees with the row's `rows`/`cols` (here a 3x3 mask on a
        // 2x2 row) only ever counts cells inside the clamped `rows` x `cols`, so a block can
        // never land outside the painted lattice: row 2 and column 2 are ignored, leaving the
        // 2x2 fully blocked (indices 0..3).
        XCTAssertEqual(
            PuzzleSilhouette.parseBlocks(mask: ["###", "###", "###"], rows: 2, cols: 2),
            [0, 1, 2, 3])
    }
}
