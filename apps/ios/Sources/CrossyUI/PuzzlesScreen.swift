// Puzzles, the library tab: the caller's uploaded puzzles from GET /puzzles, newest
// first, cursor-paginated, the RoomsScreen grammar exactly (title in the scroll,
// paper cards, pull to refresh, quiet state lines). Browse-only for now: starting a
// game from a puzzle rides the create-flow slice (recorded slice decision), so the
// cards are inert paper and the screen carries no standing action.
//
// The screen owns scroll, paging, and states; it reaches the network only through
// the injected page loader (AD-2: CrossyUI sees neither CrossyAPI nor the protocol
// twins, the composition root adapts both).

import CrossyDesign
import SwiftUI

/// One page of puzzles as the screen consumes it (the RoomsPage pattern): rows plus
/// the `before` cursor for the next page, nil when this page ended the list
/// (PROTOCOL.md §12 pagination, already digested by the composition root).
public struct PuzzlesPage: Equatable, Sendable {
    public let puzzles: [PuzzleCardModel]
    public let nextBefore: String?

    public init(puzzles: [PuzzleCardModel], nextBefore: String?) {
        self.puzzles = puzzles
        self.nextBefore = nextBefore
    }
}

public struct PuzzlesScreen: View {
    private let loadPage: (String?) async -> Result<PuzzlesPage, ArrivalFailure>

    @Environment(\.colorScheme) private var colorScheme
    @State private var puzzles: [PuzzleCardModel] = []
    @State private var nextBefore: String?
    @State private var exhausted = false
    @State private var loaded = false
    @State private var loadingMore = false
    @State private var failure: ArrivalFailure?

    public init(loadPage: @escaping (String?) async -> Result<PuzzlesPage, ArrivalFailure>) {
        self.loadPage = loadPage
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text(verbatim: ArrivalCopy.puzzlesTitle)
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .padding(.top, 8)
                    .padding(.bottom, 8)

                if let failure, puzzles.isEmpty {
                    stateLine(failure.sentence)
                } else if loaded && puzzles.isEmpty {
                    stateLine(ArrivalCopy.puzzlesEmpty)
                }

                ForEach(puzzles) { puzzle in
                    PuzzleCard(model: puzzle, ground: ground)
                        .onAppear {
                            if puzzle.id == puzzles.last?.id {
                                Task { await loadMore() }
                            }
                        }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
        .refreshable { await reload() }
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        .task { await reload() }
    }

    private func stateLine(_ sentence: String) -> some View {
        Text(verbatim: sentence)
            .font(.system(size: 14))
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .frame(maxWidth: .infinity, alignment: .center)
            .multilineTextAlignment(.center)
            .padding(.top, 48)
    }

    // MARK: - Paging (the RoomsScreen contract, verbatim)

    private func reload() async {
        failure = nil
        switch await loadPage(nil) {
        case .success(let page):
            puzzles = page.puzzles
            nextBefore = page.nextBefore
            exhausted = page.nextBefore == nil
        case .failure(let arrivalFailure):
            failure = arrivalFailure
        }
        loaded = true
    }

    private func loadMore() async {
        guard !exhausted, !loadingMore, let cursor = nextBefore else { return }
        loadingMore = true
        defer { loadingMore = false }
        switch await loadPage(cursor) {
        case .success(let page):
            // An empty page is the §12 end of iteration; appending nothing and
            // stopping is exactly the cursor contract.
            puzzles.append(contentsOf: page.puzzles)
            nextBefore = page.nextBefore
            exhausted = page.puzzles.isEmpty || page.nextBefore == nil
        case .failure:
            // A failed load-more never blanks what is already on screen; pull to
            // refresh is the recovery.
            exhausted = false
        }
    }
}
