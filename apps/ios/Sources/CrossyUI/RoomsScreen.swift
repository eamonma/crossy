// Rooms, the signed-in home (EXPERIENCE.md §3): cards from GET /games, newest
// first, cursor-paginated; the empty state is an invitation, one line and the
// standing action. This slice ships Join with a code alone; New game rides the
// create-flow slice (recorded slice decision, not a divergence). The standing
// action is glass (chrome you hold); the cards are paper (content).
//
// The screen owns scroll, paging, and states; it reaches the network only through
// the injected page loader (AD-2: CrossyUI sees neither CrossyAPI nor the protocol
// twins, the composition root adapts both).

import CrossyDesign
import SwiftUI

/// One page of rooms as the screen consumes it: rows plus the `before` cursor for
/// the next page, nil when this page ended the list (PROTOCOL.md §12 pagination,
/// already digested by the composition root).
public struct RoomsPage: Equatable, Sendable {
    public let rooms: [RoomCardModel]
    public let nextBefore: String?

    public init(rooms: [RoomCardModel], nextBefore: String?) {
        self.rooms = rooms
        self.nextBefore = nextBefore
    }
}

public struct RoomsScreen: View {
    private let loadPage: (String?) async -> Result<RoomsPage, ArrivalFailure>
    private let onOpenRoom: (RoomCardModel) -> Void
    private let onJoinWithCode: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var rooms: [RoomCardModel] = []
    @State private var nextBefore: String?
    @State private var exhausted = false
    @State private var loaded = false
    @State private var loadingMore = false
    @State private var failure: ArrivalFailure?

    public init(
        loadPage: @escaping (String?) async -> Result<RoomsPage, ArrivalFailure>,
        onOpenRoom: @escaping (RoomCardModel) -> Void,
        onJoinWithCode: @escaping () -> Void
    ) {
        self.loadPage = loadPage
        self.onOpenRoom = onOpenRoom
        self.onJoinWithCode = onJoinWithCode
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        ZStack(alignment: .bottom) {
            content
            joinAction
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
        }
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        .task { await reload() }
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text(verbatim: ArrivalCopy.roomsTitle)
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .padding(.top, 8)
                    .padding(.bottom, 8)

                if let failure, rooms.isEmpty {
                    stateLine(failure.sentence)
                } else if loaded && rooms.isEmpty {
                    stateLine(ArrivalCopy.roomsEmpty)
                }

                ForEach(rooms) { room in
                    Button {
                        onOpenRoom(room)
                    } label: {
                        RoomCard(model: room, ground: ground)
                    }
                    .buttonStyle(.plain)
                    .onAppear {
                        if room.id == rooms.last?.id {
                            Task { await loadMore() }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            // Air for the standing action, so the last card scrolls clear of it.
            .padding(.bottom, ChromeLayout.barHeight + 32)
        }
        .refreshable { await reload() }
    }

    private func stateLine(_ sentence: String) -> some View {
        Text(verbatim: sentence)
            .font(.system(size: 14))
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .frame(maxWidth: .infinity, alignment: .center)
            .multilineTextAlignment(.center)
            .padding(.top, 48)
    }

    /// The standing action (glass): Join with a code. New game joins it in the
    /// create-flow slice; the cluster-merge-on-scroll moment rides with that pair.
    private var joinAction: some View {
        Button(action: onJoinWithCode) {
            Text(verbatim: ArrivalCopy.joinWithCode)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .frame(maxWidth: .infinity)
                .frame(height: ChromeLayout.barHeight)
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: ChromeLayout.barCornerRadius))
    }

    // MARK: - Paging

    private func reload() async {
        failure = nil
        switch await loadPage(nil) {
        case .success(let page):
            rooms = page.rooms
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
            rooms.append(contentsOf: page.rooms)
            nextBefore = page.nextBefore
            exhausted = page.rooms.isEmpty || page.nextBefore == nil
        case .failure:
            // A failed load-more never blanks what is already on screen; pull to
            // refresh is the recovery.
            exhausted = false
        }
    }
}
