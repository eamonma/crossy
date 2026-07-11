// Puzzles, the library tab: the caller's uploaded puzzles from GET /puzzles, newest
// first, cursor-paginated, the RoomsScreen grammar exactly (title in the scroll,
// paper cards, pull to refresh, quiet state lines). Each card's one action starts a
// fresh game from that upload (POST /games, the replay-without-reupload path; the web
// gallery mirrors it): on success the composition root pushes the created room, the
// same navigation an opened room card takes.
//
// The screen owns scroll, paging, states, and per-card start progress; it reaches the
// network only through the two injected closures (AD-2: CrossyUI sees neither
// CrossyAPI nor the protocol twins, the composition root adapts both). A start
// resolves to the created gameId or an ArrivalFailure; success is handed up so the
// root does the push, a failure reads inline on the card and the card recovers.

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
    /// Start a game from a puzzle: `POST /games` behind the seam, resolving to the
    /// created gameId on success. The screen owns the in-flight and failure state;
    /// the root does the navigation with the returned id.
    private let startGame: (PuzzleCardModel) async -> Result<String, ArrivalFailure>
    /// The created room, handed to the composition root to push (the RoomsScreen
    /// onOpenRoom shape: navigation is the root's, not the screen's).
    private let onOpenRoom: (String) -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var puzzles: [PuzzleCardModel] = []
    @State private var nextBefore: String?
    @State private var exhausted = false
    @State private var loaded = false
    @State private var loadingMore = false
    @State private var failure: ArrivalFailure?
    /// The puzzleId whose `POST /games` is currently out; nil when none. One start at
    /// a time is enough (a person taps one card), and it keeps the disabled control
    /// unambiguous.
    @State private var starting: String?
    /// A per-card inline failure sentence, keyed by puzzleId; cleared when that card
    /// is tapped again.
    @State private var startFailures: [String: String] = [:]

    public init(
        loadPage: @escaping (String?) async -> Result<PuzzlesPage, ArrivalFailure>,
        startGame: @escaping (PuzzleCardModel) async -> Result<String, ArrivalFailure> = { _ in
            .failure(ArrivalFailure(code: nil))
        },
        onOpenRoom: @escaping (String) -> Void = { _ in }
    ) {
        self.loadPage = loadPage
        self.startGame = startGame
        self.onOpenRoom = onOpenRoom
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
                    PuzzleCard(
                        model: puzzle,
                        ground: ground,
                        starting: starting == puzzle.id,
                        failure: startFailures[puzzle.id],
                        onStart: { Task { await start(puzzle) } }
                    )
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

    // MARK: - Start a game (POST /games; the create-flow slice, closed)

    /// Start a fresh game from one puzzle: mark the card in flight, clear any prior
    /// failure on it, then run the injected create. Success hands the created gameId
    /// to the root, which pushes the room the same way an opened card does; a failure
    /// stays on the list and reads inline on the card (a toast would be noise), keyed
    /// on the §12 code. A second tap while one start is out is a no-op (the button is
    /// already disabled, this guards the closure too).
    private func start(_ puzzle: PuzzleCardModel) async {
        guard starting == nil else { return }
        starting = puzzle.id
        startFailures[puzzle.id] = nil
        defer { starting = nil }
        switch await startGame(puzzle) {
        case .success(let gameId):
            onOpenRoom(gameId)
        case .failure(let arrivalFailure):
            startFailures[puzzle.id] = ArrivalCopy.puzzleStartFailure(
                forCode: arrivalFailure.code)
        }
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
