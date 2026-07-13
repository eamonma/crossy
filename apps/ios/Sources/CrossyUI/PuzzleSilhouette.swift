// The puzzle silhouette (EXPERIENCE.md §3 Rooms), the iOS twin of the web's
// `Silhouette` (apps/web Home.tsx): the black-square pattern of a puzzle, its face, the
// one strong object the signed-in home paints per room. GET /games now carries the
// `mask` (PROTOCOL.md §12): rows of `#`/`.`, the pattern only, derived server-side from
// geometry and block positions, never a letter, number, circle, or any solution content
// (INV-6). It is a strict upgrade of the geometry fingerprint: the same true-aspect
// lattice, now with the blocks filled in. When the mask is empty (an older server that
// predates the field, §14, or a fixture that carries none) the paint falls back to the
// bare lattice, exactly the fingerprint. The derivation is pure math over (rows, cols,
// mask); the Canvas view is a thin reader of it, paper-toned on both grounds.

import CrossyDesign
import SwiftUI

/// The parsed silhouette: the geometry fingerprint (rows/cols clamp plus tile layout,
/// reused verbatim) plus the block cells the mask names. Pure and Equatable, so it pins
/// headlessly (PuzzleSilhouetteTests) and never re-parses within a render.
public struct PuzzleSilhouette: Equatable, Sendable {
    /// The lattice geometry, reused from the fingerprint so the silhouette and the bare
    /// fingerprint place cells identically (a silhouette is a fingerprint with blocks).
    public let fingerprint: GeometryFingerprint
    /// Block cells as row-major indices (cell `r * cols + c`, the board's own indexing,
    /// PROTOCOL.md §12), within the clamped `rows`/`cols`. Empty when the mask is empty.
    public let blocks: Set<Int>

    public init(rows: Int, cols: Int, mask: [String]) {
        let fingerprint = GeometryFingerprint(rows: rows, cols: cols)
        self.fingerprint = fingerprint
        self.blocks = Self.parseBlocks(mask: mask, rows: fingerprint.rows, cols: fingerprint.cols)
    }

    /// Parse a mask (rows of `#`/`.`) to the set of block cell indices, row-major (§12:
    /// row `r`, column `c` is character `c` of string `r`, cell index `r * cols + c`).
    /// Defensive by construction: a short or ragged mask leaves the missing cells
    /// playable rather than crashing, and only cells inside the clamped `rows`x`cols`
    /// count, so a mask whose geometry disagrees with the row's `rows`/`cols` can never
    /// paint outside the lattice. An empty mask yields no blocks (the honest fallback: an
    /// older server or a fixture that carries none renders as the bare lattice). Only `#`
    /// is a block; every other glyph (`.`, or anything unexpected) reads as playable, so
    /// no non-pattern content can ever leak a fill (INV-6 stays a pattern, never a
    /// letter). Pure.
    public static func parseBlocks(mask: [String], rows: Int, cols: Int) -> Set<Int> {
        guard !mask.isEmpty else { return [] }
        var blocks: Set<Int> = []
        for row in 0..<rows where row < mask.count {
            let characters = Array(mask[row])
            for col in 0..<cols where col < characters.count && characters[col] == "#" {
                blocks.insert(row * cols + col)
            }
        }
        return blocks
    }
}

/// The silhouette render: the lattice drawn in paper tones with the blocks filled, the
/// web `Silhouette`'s twin. Paper cells, block squares, hairline grid lines; no glyphs,
/// no numbers, no color (people live elsewhere on the card). An empty mask draws exactly
/// the geometry fingerprint (lattice only), so this view supersedes it wherever a mask is
/// in hand.
public struct PuzzleSilhouetteView: View {
    private let silhouette: PuzzleSilhouette
    private let ground: GridGround

    public init(rows: Int, cols: Int, mask: [String], ground: GridGround) {
        self.silhouette = PuzzleSilhouette(rows: rows, cols: cols, mask: mask)
        self.ground = ground
    }

    public var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let layout = silhouette.fingerprint.layout(fitting: side)
            guard layout.cellSide > 0 else { return }
            let frame = CGRect(
                x: layout.originX + (size.width - side) / 2,
                y: layout.originY + (size.height - side) / 2,
                width: layout.width,
                height: layout.height)

            // Paper: every cell reads as the ground's cell tone first.
            context.fill(Path(frame), with: .color(Color(rgb: ground.tokens.cell)))

            // Blocks: the mask's `#` cells filled with the block tone, the silhouette's
            // whole point. One path for all blocks, one fill, so a 25-wide grid stays a
            // single paint pass (the CrossyGridView discipline).
            if !silhouette.blocks.isEmpty {
                let cols = silhouette.fingerprint.cols
                var squares = Path()
                for index in silhouette.blocks {
                    let row = index / cols
                    let col = index % cols
                    squares.addRect(
                        CGRect(
                            x: frame.minX + CGFloat(col) * layout.cellSide,
                            y: frame.minY + CGFloat(row) * layout.cellSide,
                            width: layout.cellSide,
                            height: layout.cellSide))
                }
                context.fill(squares, with: .color(Color(rgb: ground.tokens.block)))
            }

            // Hairlines thin enough that a 25-wide lattice reads as texture, thick enough
            // that a mini reads as a grid (the fingerprint's exact rule, so the two match).
            let line = max(0.5, layout.cellSide * 0.06)
            var lattice = Path()
            for col in 0...silhouette.fingerprint.cols {
                let x = frame.minX + CGFloat(col) * layout.cellSide
                lattice.move(to: CGPoint(x: x, y: frame.minY))
                lattice.addLine(to: CGPoint(x: x, y: frame.maxY))
            }
            for row in 0...silhouette.fingerprint.rows {
                let y = frame.minY + CGFloat(row) * layout.cellSide
                lattice.move(to: CGPoint(x: frame.minX, y: y))
                lattice.addLine(to: CGPoint(x: frame.maxX, y: y))
            }
            context.stroke(
                lattice, with: .color(Color(rgb: ground.tokens.gridLine)), lineWidth: line)
        }
        .accessibilityHidden(true)
    }
}
