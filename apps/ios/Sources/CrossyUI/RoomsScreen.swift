// Rooms, the signed-in home (EXPERIENCE.md §3): cards from GET /games, newest
// first, cursor-paginated; the empty state is an invitation, one line and the
// Join affordance. Join stands top-trailing as a small glass capsule (code or
// QR, one panel; owner ruling 2026-07-10 late) — the bottom standing slot is
// New game's when the create-flow slice lands. Glass is chrome you hold; the
// cards are paper (content).
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

/// The join sheet's zoom source, handed down from the composition root so the
/// button and the sheet share one namespace (arrival notes, DESIGN.md §4). The
/// composition root owns the @Namespace because the sheet lives in its hierarchy,
/// not the screen's; the screen only stamps the button as the source.
public struct JoinSheetSource {
    let namespace: Namespace.ID
    /// A stable id so the button and the presented sheet match. One source per
    /// screen, so a constant suffices.
    static let id = "crossy.join.sheet"

    public init(namespace: Namespace.ID) {
        self.namespace = namespace
    }
}

public struct RoomsScreen: View {
    private let loadPage: (String?) async -> Result<RoomsPage, ArrivalFailure>
    private let onOpenRoom: (RoomCardModel) -> Void
    private let onJoinWithCode: () -> Void
    /// The zoom source for the join sheet: the button IS the surface the sheet
    /// grows from (arrival notes, DESIGN.md §4). nil in previews and on macOS,
    /// where the transition floor (iOS 18) is absent; the button then just taps.
    private let joinSheetSource: JoinSheetSource?

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
        onJoinWithCode: @escaping () -> Void,
        joinSheetSource: JoinSheetSource? = nil
    ) {
        self.loadPage = loadPage
        self.onOpenRoom = onOpenRoom
        self.onJoinWithCode = onJoinWithCode
        self.joinSheetSource = joinSheetSource
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        content
            // The Join affordance stands over the top-trailing corner, aligned
            // with the "Rooms" title: a small glass capsule, the arrival grammar
            // (DESIGN.md §4). It never scrolls; it is chrome.
            .overlay(alignment: .topTrailing) { joinAffordance }
            .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
            .task { await reload() }
    }

    /// Join, top-trailing: the glyph says the camera is welcome, the word says
    /// what happens. The capsule is the join panel's zoom source, so the glass
    /// sheet grows out of it (arrival notes, DESIGN.md §4).
    private var joinAffordance: some View {
        Button(action: onJoinWithCode) {
            HStack(spacing: 6) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 16, weight: .semibold))
                Text(verbatim: ArrivalCopy.joinAffordance)
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundStyle(Color(rgb: ground.tokens.ink))
            .padding(.horizontal, 16)
            .frame(height: 40)
            // The whole capsule takes the tap (the WelcomeScreen finding).
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .modifier(ChromeGlassSurface(cornerRadius: 20))
        .modifier(JoinSheetSourceMark(source: joinSheetSource))
        .padding(.trailing, 20)
        .padding(.top, 12)
        .accessibilityLabel(ArrivalCopy.joinTitle)
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
            .padding(.bottom, 24)
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

// MARK: - The zoom pairing (arrival notes, DESIGN.md §4)

/// Stamps the Join button as the sheet's zoom source. Gated to iOS 18+ (the
/// package floor on device); the macOS test host (14) and any absent source
/// leave the button bare, the §4 one-fallback rule for the transition.
private struct JoinSheetSourceMark: ViewModifier {
    let source: JoinSheetSource?

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 18.0, *), let source {
                content.matchedTransitionSource(
                    id: JoinSheetSource.id, in: source.namespace)
            } else {
                content
            }
        #else
            content
        #endif
    }
}

extension View {
    /// The join sheet's destination half of the zoom: the sheet grows out of the
    /// button that carries the matching source (arrival notes, DESIGN.md §4). The
    /// composition root applies this to the sheet content. Below iOS 18 (and the
    /// macOS test host) the sheet slides in plainly, no glass required (§4 floor).
    public func joinSheetZoom(from source: JoinSheetSource?) -> some View {
        modifier(JoinSheetZoom(source: source))
    }
}

private struct JoinSheetZoom: ViewModifier {
    let source: JoinSheetSource?

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 18.0, *), let source {
                content.navigationTransition(
                    .zoom(sourceID: JoinSheetSource.id, in: source.namespace))
            } else {
                content
            }
        #else
            content
        #endif
    }
}
