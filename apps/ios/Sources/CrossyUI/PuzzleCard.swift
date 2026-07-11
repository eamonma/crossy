// One puzzle card (the library tab): geometry fingerprint, title, author. The card
// is paper, not glass (DESIGN.md §1), and browse-only until the create-flow slice:
// no tap target, no chevron, nothing that promises a flow that isn't there yet. It
// carries no people row either — a puzzle has no members, and people are the only
// color a card earns.

import CrossyDesign
import SwiftUI

/// A puzzle as the card renders it, plain data (the RoomCardModel pattern: CrossyUI
/// names its own types, protocol twins stay in their ring, AD-2). The composition
/// root maps `GET /puzzles` rows here.
public struct PuzzleCardModel: Identifiable, Equatable, Sendable {
    public let puzzleId: String
    /// Display metadata, null when the document carried none (§12).
    public let title: String?
    public let author: String?
    public let rows: Int
    public let cols: Int

    public var id: String { puzzleId }

    public init(puzzleId: String, title: String?, author: String?, rows: Int, cols: Int) {
        self.puzzleId = puzzleId
        self.title = title
        self.author = author
        self.rows = rows
        self.cols = cols
    }

    /// The headline: the title when the document carried one, else the honest
    /// geometry (the RoomCard fallback, same words).
    public var headline: String {
        if let title, !title.isEmpty { return title }
        return "\(rows)\u{00D7}\(cols) crossword"
    }

    /// The author under the title, absent rather than empty when the document
    /// carried none.
    public var subline: String? {
        guard let author, !author.isEmpty else { return nil }
        return author
    }
}

/// The card itself: the room card's paper grammar without the people row.
public struct PuzzleCard: View {
    private let model: PuzzleCardModel
    private let ground: GridGround

    public init(model: PuzzleCardModel, ground: GridGround) {
        self.model = model
        self.ground = ground
    }

    public var body: some View {
        HStack(spacing: 14) {
            GeometryFingerprintView(rows: model.rows, cols: model.cols, ground: ground)
                .frame(width: 52, height: 52)

            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: model.headline)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .lineLimit(1)
                if let subline = model.subline {
                    Text(verbatim: subline)
                        .font(.system(size: 13))
                        .foregroundStyle(Color(rgb: ground.tokens.number))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(rgb: ground.tokens.cell))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(Color(rgb: ground.tokens.gridLine), lineWidth: 1))
        )
    }
}
