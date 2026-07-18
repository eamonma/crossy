// The mark wash (apps/ios Wave 15.5 UX; design/check-vote/UX.md U6, owner ruling): the reveal
// after a passing check vote. The wrong-cell marks do not pop in all at once; they wash across
// the board in ascending cell order, each cell's check coat fading in over ~360 ms, staggered
// so the whole wash finishes under 900 ms. This is the pure timing model, so the stagger,
// the sub-900 ms bound, and the ascending order are asserted in XCTest without a running view.
// The Canvas draw pass reads `reveal(cell:now:)` to ramp each coat's opacity.
//
// Reduce Motion is not expressed here: the caller withholds the wash entirely under Reduce
// Motion (no start timestamp), so the coats draw at full opacity and the marks apply instantly.

import Foundation

/// One mark wash: the standing marks to reveal (ascending cell order) and the wall-clock
/// instant the wash begins. A cell's reveal is a function of its rank and `now`.
public struct CheckWash: Equatable, Sendable {
    /// The marks to reveal, ascending cell index (PROTOCOL.md §6: wrongCells is ascending).
    public let cells: [Int]
    /// The reference-date instant the wash begins (the caller stamps it after the breath).
    public let startedAt: TimeInterval
    private let rankOf: [Int: Int]

    public init(cells: [Int], startedAt: TimeInterval) {
        let ordered = cells.sorted()
        self.cells = ordered
        self.startedAt = startedAt
        var ranks: [Int: Int] = [:]
        for (index, cell) in ordered.enumerated() { ranks[cell] = index }
        self.rankOf = ranks
    }

    /// One cell's coat fade span. ~360 ms per the owner ruling.
    public static let cellAnimation: TimeInterval = 0.36
    /// The total stagger budget: the last cell starts no later than this after the first, so the
    /// whole wash (last start + one cell animation) stays under 900 ms (500 + 360 = 860).
    public static let staggerBudget: TimeInterval = 0.5
    /// The per-cell delay cap for small marks sets, so a 2-mark wash still reads as a sweep
    /// rather than a simultaneous pop.
    public static let perCellCap: TimeInterval = 0.06

    /// The delay between consecutive cells' starts: `min(60 ms, 500 ms / (n - 1))`, so a large
    /// mark set compresses to fit the budget and a small one keeps a legible 60 ms step. Zero
    /// for a single mark (nothing to stagger).
    public static func perCellDelay(count: Int) -> TimeInterval {
        count <= 1 ? 0 : min(perCellCap, staggerBudget / Double(count - 1))
    }

    public var perCellDelay: TimeInterval { Self.perCellDelay(count: cells.count) }

    /// The whole wash's span: the last cell's start (`(n-1) * perCellDelay`) plus one cell
    /// animation. Under 900 ms by construction (the staggerBudget bound).
    public var totalDuration: TimeInterval {
        Double(max(0, cells.count - 1)) * perCellDelay + Self.cellAnimation
    }

    /// A cell's check-coat reveal, 0...1, at `now`. A cell not in this wash reveals fully (it is
    /// not one of the marks this wash animates). Before a cell's staggered start it is 0; after
    /// its start plus the cell animation it is 1; between, a smooth ease.
    public func reveal(cell: Int, now: TimeInterval) -> Double {
        guard let rank = rankOf[cell] else { return 1 }
        let elapsed = now - startedAt - Double(rank) * perCellDelay
        return Self.ease(min(1, max(0, elapsed / Self.cellAnimation)))
    }

    /// Has the whole wash finished by `now`? The caller uses this to stop redrawing.
    public func isComplete(now: TimeInterval) -> Bool {
        now >= startedAt + totalDuration
    }

    /// Smoothstep, so a coat settles rather than snapping to full.
    static func ease(_ t: Double) -> Double { t * t * (3 - 2 * t) }
}
