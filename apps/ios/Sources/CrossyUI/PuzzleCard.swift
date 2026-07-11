// One puzzle card (the library tab): geometry fingerprint, title, author, and the
// one action that starts a fresh game from this upload (POST /games, the
// replay-without-reupload path the empty state points at; the web gallery mirrors
// it). The card is paper, not glass (DESIGN.md §1). It carries no people row — a
// puzzle has no members, and people are the only color a card earns — so the action
// is the card's only tint-free control.

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

/// The card itself: the room card's paper grammar with a trailing "New game" action.
/// The face and facts lead; the action follows, in flight while its `POST /games` is
/// out (the label reads "Starting" and the control is inert, so a double tap never
/// fires a second create). A per-card failure line reads beneath, inline, no toast.
public struct PuzzleCard: View {
    private let model: PuzzleCardModel
    private let ground: GridGround
    private let starting: Bool
    private let failure: String?
    private let onStart: () -> Void

    public init(
        model: PuzzleCardModel,
        ground: GridGround,
        starting: Bool = false,
        failure: String? = nil,
        onStart: @escaping () -> Void = {}
    ) {
        self.model = model
        self.ground = ground
        self.starting = starting
        self.failure = failure
        self.onStart = onStart
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
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

                startButton
            }

            if let failure {
                Text(verbatim: failure)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .fixedSize(horizontal: false, vertical: true)
            }
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

    /// The one control: a quiet ink capsule (paper's own ink token, no glass, no
    /// color). In flight it reads "Starting" and disables, so a double tap never
    /// fires a second `POST /games`.
    private var startButton: some View {
        Button(action: onStart) {
            Text(verbatim: starting ? ArrivalCopy.puzzleStarting : ArrivalCopy.puzzleStartGame)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.cell))
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(
                    Capsule().fill(Color(rgb: ground.tokens.ink))
                        .opacity(starting ? 0.55 : 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(starting)
        .accessibilityLabel(
            Text(verbatim: "\(ArrivalCopy.puzzleStartGame): \(model.headline)"))
    }
}
