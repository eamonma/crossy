// The geometry fingerprint (EXPERIENCE.md §3 Rooms: "the grid's geometry as a
// fingerprint"). GET /games carries rows and cols only, deliberately no block
// lattice and no board (PROTOCOL.md §12, INV-6), so the honest mini-render is the
// grid's shape: its cell lattice at true aspect, nothing invented. The derivation is
// pure math over (rows, cols, tile side), pinned headlessly; the Canvas view is a
// thin reader of it, paper-toned on both grounds.

import CrossyDesign
import SwiftUI

/// Rows and cols clamped to the ingestion cap, plus the pure tile layout.
public struct GeometryFingerprint: Equatable, Sendable {
    /// The 25x25 ingestion cap (PROTOCOL.md §12 OVERSIZE_GRID); a degenerate value
    /// clamps to 1 so the tile always draws something sane.
    public static let dimensionCap = 25

    public let rows: Int
    public let cols: Int

    public init(rows: Int, cols: Int) {
        self.rows = min(max(rows, 1), Self.dimensionCap)
        self.cols = min(max(cols, 1), Self.dimensionCap)
    }

    /// The lattice placed in a square tile: square cells, true aspect, centered.
    public struct Layout: Equatable, Sendable {
        public let cellSide: Double
        public let originX: Double
        public let originY: Double
        public let width: Double
        public let height: Double
    }

    /// Fit the lattice into a `side` x `side` tile. Cells stay square (the longer
    /// dimension spans the tile), the shorter dimension centers, and a non-positive
    /// side collapses to the zero layout rather than dividing by zero.
    public func layout(fitting side: Double) -> Layout {
        guard side > 0 else {
            return Layout(cellSide: 0, originX: 0, originY: 0, width: 0, height: 0)
        }
        let cellSide = side / Double(max(rows, cols))
        let width = cellSide * Double(cols)
        let height = cellSide * Double(rows)
        return Layout(
            cellSide: cellSide,
            originX: (side - width) / 2,
            originY: (side - height) / 2,
            width: width,
            height: height)
    }
}

/// The mini-render: the lattice drawn in paper tones (cells on canvas, grid-line
/// hairlines). No glyphs, no blocks, no color; people live elsewhere on the card.
public struct GeometryFingerprintView: View {
    private let fingerprint: GeometryFingerprint
    private let ground: GridGround

    public init(rows: Int, cols: Int, ground: GridGround) {
        self.fingerprint = GeometryFingerprint(rows: rows, cols: cols)
        self.ground = ground
    }

    public var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let layout = fingerprint.layout(fitting: side)
            guard layout.cellSide > 0 else { return }
            let frame = CGRect(
                x: layout.originX + (size.width - side) / 2,
                y: layout.originY + (size.height - side) / 2,
                width: layout.width,
                height: layout.height)

            context.fill(Path(frame), with: .color(Color(rgb: ground.tokens.cell)))

            // Hairlines thin enough that a 25-wide lattice reads as texture, thick
            // enough that a mini reads as a grid.
            let line = max(0.5, layout.cellSide * 0.06)
            var lattice = Path()
            for col in 0...fingerprint.cols {
                let x = frame.minX + CGFloat(col) * layout.cellSide
                lattice.move(to: CGPoint(x: x, y: frame.minY))
                lattice.addLine(to: CGPoint(x: x, y: frame.maxY))
            }
            for row in 0...fingerprint.rows {
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
