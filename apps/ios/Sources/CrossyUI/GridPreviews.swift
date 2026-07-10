// Preview fixtures: real-shaped boards fed through the store's real inbound path
// (ARCHITECTURE.md §7: previews run on a scripted transport shape, no server). The
// wire values are cribbed from Tests/CrossyProtocolTests/Fixtures/wire/welcome.json
// (participant "Ana", color #7F77DD, a live cursor) and grown to a symmetric 5x5
// mini and the 25x25 ingestion cap. Message construction stays inference-only: AD-2
// keeps CrossyProtocol out of CrossyUI's imports, and everything here spells only
// GameStore's own surface.

import CrossyDesign
import CrossyStore
import SwiftUI

@MainActor
enum GridPreviewFixtures {
    /// Board cells for a welcome frame, built through a caller-supplied maker so the
    /// wire cell type stays unnamed here (AD-2).
    private static func cells<T>(
        _ count: Int, fills: [Int: (value: String, by: String)],
        make: (String?, String?) -> T
    ) -> [T] {
        (0..<count).map { cell in
            let fill = fills[cell]
            return make(fill?.value, fill?.by)
        }
    }

    /// A symmetric 5x5 mini: blocks at 4 and 20, circles on the diagonal, one shaded
    /// cell, one rebus entry, a teammate cursor, and a spectator whose cursor must
    /// not render (root DESIGN.md §15).
    static func mini() -> (store: GameStore, puzzle: GridPuzzle) {
        let puzzle = GridPuzzle(
            rows: 5, cols: 5,
            blocks: [4, 20],
            circles: [6, 12, 18],
            shadedCircles: [16],
            numbers: GridPuzzle.numbering(from: [
                (1, 0), (5, 5), (7, 10), (8, 15), (9, 21),
                (1, 0), (2, 1), (3, 2), (4, 3), (6, 9),
            ]))
        let fills: [Int: (value: String, by: String)] = [
            0: ("S", "ana"), 1: ("O", "ana"), 2: ("L", "bee"), 3: ("V", "bee"),
            6: ("A", "ana"), 12: ("REBUS", "bee"), 18: ("E", "ana"), 21: ("D", "bee"),
        ]
        let store = GameStore()
        store.receive(
            .welcome(
                .init(
                    protocolVersion: 1,
                    selfIdentity: .init(userId: "ana", role: .solver),
                    board: .init(
                        seq: 8, status: .ongoing,
                        firstFillAt: "2026-07-07T19:02:11Z", completedAt: nil, abandonedAt: nil,
                        cells: cells(25, fills: fills) { .init(v: $0, by: $1) },
                        participants: [
                            .init(
                                userId: "ana", displayName: "Ana", color: "#7F77DD",
                                role: .host, connected: true),
                            .init(
                                userId: "bee", displayName: "Bee", color: "#2B9C8F",
                                role: .solver, connected: true),
                            .init(
                                userId: "sam", displayName: "Sam", color: "#C2497D",
                                role: .spectator, connected: true),
                        ],
                        cursors: [
                            .init(userId: "bee", cell: 12, direction: .down),
                            .init(userId: "sam", cell: 10, direction: .across),
                        ],
                        recentCommandIds: [], stats: nil))))
        return (store, puzzle)
    }

    /// The 25x25 ingestion cap, generated deterministically: a symmetric block
    /// lattice, scattered fills, four participants, and a shared cell for the count
    /// badge.
    static func cap25() -> (store: GameStore, puzzle: GridPuzzle) {
        let rows = 25
        let cols = 25
        var blocks: Set<Int> = []
        for cell in 0..<(rows * cols) {
            let row = cell / cols
            let col = cell % cols
            if (row % 6 == 2 && col % 4 == 3) || (row % 4 == 0 && col % 6 == 5) {
                blocks.insert(cell)
                blocks.insert(rows * cols - 1 - cell)
            }
        }
        // Standard numbering scan: a playable cell numbers when it starts an across
        // or a down run (fixture-side derivation; the real app maps ingested clues).
        var starts: [(number: Int, cell: Int)] = []
        var next = 1
        for cell in 0..<(rows * cols) where !blocks.contains(cell) {
            let row = cell / cols
            let col = cell % cols
            let startsAcross = col == 0 || blocks.contains(cell - 1)
            let startsDown = row == 0 || blocks.contains(cell - cols)
            if startsAcross || startsDown {
                starts.append((next, cell))
                next += 1
            }
        }
        let puzzle = GridPuzzle(
            rows: rows, cols: cols,
            blocks: blocks,
            circles: Set((0..<25).map { $0 * cols + $0 }).subtracting(blocks),
            numbers: GridPuzzle.numbering(from: starts))
        var fills: [Int: (value: String, by: String)] = [:]
        let writers = ["ana", "bee", "kit", "moe"]
        for cell in 0..<(rows * cols) where !blocks.contains(cell) && cell % 5 != 3 {
            let letter = String(UnicodeScalar(UInt8(65 + (cell * 7) % 26)))
            fills[cell] = (letter, writers[cell % writers.count])
        }
        let store = GameStore()
        store.receive(
            .welcome(
                .init(
                    protocolVersion: 1,
                    selfIdentity: .init(userId: "ana", role: .solver),
                    board: .init(
                        seq: 412, status: .ongoing,
                        firstFillAt: "2026-07-07T19:02:11Z", completedAt: nil, abandonedAt: nil,
                        cells: cells(rows * cols, fills: fills) { .init(v: $0, by: $1) },
                        participants: [
                            .init(
                                userId: "ana", displayName: "Ana", color: "#7F77DD",
                                role: .host, connected: true),
                            .init(
                                userId: "bee", displayName: "Bee", color: "#2B9C8F",
                                role: .solver, connected: true),
                            .init(
                                userId: "kit", displayName: "Kit", color: "#DE5722",
                                role: .solver, connected: true),
                            .init(
                                userId: "moe", displayName: "Moe", color: "#3D6BD6",
                                role: .solver, connected: true),
                        ],
                        cursors: [
                            .init(userId: "bee", cell: 58, direction: .across),
                            .init(userId: "kit", cell: 58, direction: .down),
                            .init(userId: "moe", cell: 340, direction: .down),
                        ],
                        recentCommandIds: [], stats: nil))))
        return (store, puzzle)
    }
}

/// Preview host: owns a live selection so taps place the cursor in the canvas.
private struct GridPreviewHost: View {
    let store: GameStore
    let puzzle: GridPuzzle
    let ground: GridGround
    @State private var selection: GridSelection?

    init(fixture: (store: GameStore, puzzle: GridPuzzle), ground: GridGround, selection: GridSelection? = nil) {
        self.store = fixture.store
        self.puzzle = fixture.puzzle
        self.ground = ground
        _selection = State(initialValue: selection)
    }

    var body: some View {
        CrossyGridView(store: store, puzzle: puzzle, ground: ground, selection: selection) { cell in
            selection = GridSelection(cell: cell, isAcross: selection?.isAcross ?? true)
        }
        .ignoresSafeArea()
    }
}

#Preview("Studio mini") {
    GridPreviewHost(
        fixture: GridPreviewFixtures.mini(), ground: .studio,
        selection: GridSelection(cell: 10, isAcross: true))
}

#Preview("Observatory mini") {
    GridPreviewHost(
        fixture: GridPreviewFixtures.mini(), ground: .observatory,
        selection: GridSelection(cell: 10, isAcross: true))
}

#Preview("Studio 25x25") {
    GridPreviewHost(
        fixture: GridPreviewFixtures.cap25(), ground: .studio,
        selection: GridSelection(cell: 56, isAcross: true))
}

#Preview("Observatory 25x25") {
    GridPreviewHost(
        fixture: GridPreviewFixtures.cap25(), ground: .observatory,
        selection: GridSelection(cell: 56, isAcross: true))
}
