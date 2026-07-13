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

/// The room push's zoom source (native continuity, DESIGN.md §4): a tapped room
/// card is the surface the room grows from, and the room pours back into its card
/// on the pop. The namespace is handed down from the composition root exactly like
/// JoinSheetSource (AD-2: CrossyUI never owns the namespace; the push lives in the
/// arrival hierarchy). Unlike the join sheet's single source, the list carries many
/// cards, so the id is derived per room from the gameId through the pure helper
/// below; the stamp on the card and the room destination's zoom share that one
/// contract, so they always name the same source.
public struct RoomZoomSource {
    let namespace: Namespace.ID

    /// One card, one id, derived from its gameId. The card stamp and the room
    /// destination both build the id this way, so a tapped card and the room it
    /// pushes always name the same source. Pure and pinned (RoomZoomSourceTests),
    /// the register the repo holds for shared vocabulary (ArrivalCopyTests).
    public static func sourceID(for gameId: String) -> String {
        "crossy.room.\(gameId)"
    }

    /// The Join capsule's zoom id (slice 2), distinct from JoinSheetSource.id so
    /// the capsule can wear both stamps: the sheet's source AND the room push's,
    /// so a code-join grows the room from the same capsule the sheet melted back
    /// into. One room per join, so a constant suffices. Its own prefix, never the
    /// per-room "crossy.room." shape, so no gameId derivation can ever collide with
    /// it (RoomZoomSourceTests pins this).
    public static let joinCapsuleID = "crossy.join.capsule.room"

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
    /// The zoom source for the room push: each card IS the surface its room grows
    /// from (native continuity, DESIGN.md §4). nil in previews and on macOS, the
    /// same floor as the join source; the card then just pushes plainly.
    private let roomZoomSource: RoomZoomSource?
    /// The evidence walk (-i3AutoOpen): after the first load, open the first room
    /// through the exact production tap seam, so headless captures can watch the
    /// seeded birth and the goo. False everywhere but the rig composition.
    private let autoOpenFirstRoom: Bool

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
        joinSheetSource: JoinSheetSource? = nil,
        roomZoomSource: RoomZoomSource? = nil,
        autoOpenFirstRoom: Bool = false
    ) {
        self.loadPage = loadPage
        self.onOpenRoom = onOpenRoom
        self.onJoinWithCode = onJoinWithCode
        self.joinSheetSource = joinSheetSource
        self.roomZoomSource = roomZoomSource
        self.autoOpenFirstRoom = autoOpenFirstRoom
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        content
            .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
            // Join rides the system nav bar's trailing item now (the
            // toolbar-adoption ruling, DESIGN.md §4): the item goos into the
            // room's trailing cluster across the #132 zoom push. The screen
            // keeps its in-content 32pt "Rooms" title (the owner's typographic
            // voice); the composition root leaves the bar visible and
            // title-less. Below iOS 18 (and the macOS test host) the toolbar
            // still hosts the button, plainly, no zoom (§4 one-fallback rule).
            .toolbar { joinToolbarItem }
            .task {
                await reload()
                // The evidence walk (-i3AutoOpen): open the first loaded room
                // through the EXACT production tap seam (onOpenRoom records the
                // seed and the zoom source, then pushes), after one beat so the
                // list paints and the zoom source exists. Headless captures of
                // the seeded birth and the goo ride this; a hand never could be
                // scripted onto the glass. Evidence only; the composition root
                // passes true only for the rig arg.
                if autoOpenFirstRoom, let first = rooms.first {
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    onOpenRoom(first)
                }
            }
    }

    /// Join as a trailing nav-bar item (the toolbar-adoption ruling, DESIGN.md
    /// §4). SP-i6 finding: a `Label` in a 26 bar item renders icon-only, so the
    /// content is an explicit HStack (glyph + Text) to keep the word, matching
    /// the retired capsule's register (the owner's device eye confirms the
    /// register). The item wears BOTH zoom stamps the retired capsule did: the
    /// join sheet's source (the sheet grows out of it) and the room push's (a
    /// code-join grows the room from this same item after the sheet melts back
    /// into it, slice 2). The glass is the system's on 26, the plain bar
    /// material below (§4 one-fallback rule); the item never draws its own
    /// ChromeGlassSurface, which would stand glass the bar does not know.
    @ToolbarContentBuilder
    private var joinToolbarItem: some ToolbarContent {
        ToolbarItem(placement: BarPlacement.trailing) {
            Button(action: onJoinWithCode) {
                HStack(spacing: 6) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 15, weight: .semibold))
                    Text(verbatim: ArrivalCopy.joinAffordance)
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(Color(rgb: ground.tokens.ink))
            }
            .modifier(JoinSheetSourceMark(source: joinSheetSource))
            .modifier(JoinCapsuleRoomSourceMark(source: roomZoomSource))
            .accessibilityLabel(Text(verbatim: ArrivalCopy.joinTitle))
        }
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

                // The web's shelf grammar (Home.tsx GamesList): live rooms lead, then, only
                // when any exist, a quiet "Solved" section and then an "Ended" section gather
                // the terminal rooms (completed and host-ended) so the shelf reads current up
                // top. iOS leads the live rooms with a featured wall: the few most-recently-active
                // render as large silhouette cards (a 2x2 grid), the way the web home leads with
                // real grids, and the rest fall to the compact list below. Partition at render
                // time off the ONE appended `rooms` array (the pure helper), never a second
                // paging list: pages are createdAt-bounded and appended, so a terminal room from a
                // deeper page lands after the earlier terminal rooms within its trailing section
                // (§12 pagination stability).
                let shelved = RoomCardModel.shelved(rooms)
                let featured = Array(shelved.live.prefix(Self.featuredCount))
                let restLive = Array(shelved.live.dropFirst(Self.featuredCount))

                if !featured.isEmpty {
                    // The featured wall keeps its grid cell size no matter the count: a single
                    // live room sits in the first cell at the same face as a full 2x2, never
                    // ballooning to a lone full-width hero.
                    LazyVGrid(columns: Self.featuredColumns, spacing: 12) {
                        ForEach(featured) { room in
                            roomTap(room) { FeaturedRoomCard(model: room, ground: ground) }
                        }
                    }
                }

                // The live rooms past the featured slice, then the solved shelf, both compact.
                ForEach(restLive) { room in
                    roomTap(room) { RoomCard(model: room, ground: ground) }
                }

                if !shelved.solved.isEmpty {
                    sectionHeader(ArrivalCopy.roomsSolvedSection)
                    ForEach(shelved.solved) { room in
                        roomTap(room) { RoomCard(model: room, ground: ground) }
                    }
                }

                if !shelved.ended.isEmpty {
                    sectionHeader(ArrivalCopy.roomsEndedSection)
                    ForEach(shelved.ended) { room in
                        roomTap(room) { RoomCard(model: room, ground: ground) }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .refreshable { await reload() }
    }

    /// The featured wall: the few most-recently-active live rooms as large silhouette cards.
    /// Four fills a clean 2x2 on a phone (each face ~half width, still legible for a 15x15);
    /// a live count at or below this features them all, so the compact list appears only at
    /// five or more live rooms.
    private static let featuredCount = 4

    /// Two flexible columns for the featured wall, the web's card grid at phone width.
    private static let featuredColumns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    /// One tappable room card (compact or featured). The load-more trigger fires on the LAST
    /// card of the raw appended `rooms` array (not the visually last, which the featured slice
    /// and the solved section reorder), so paging stays keyed to the source of truth and never
    /// fires twice for one page.
    private func roomTap<Label: View>(
        _ room: RoomCardModel, @ViewBuilder label: () -> Label
    ) -> some View {
        Button {
            onOpenRoom(room)
        } label: {
            label()
        }
        .buttonStyle(.plain)
        // The card is the surface the room grows from: it stamps itself as the
        // push's zoom source with the per-room id, so the room destination reaches
        // it and the room pours back into this card on the pop (native continuity,
        // DESIGN.md §4). Absent on macOS and below iOS 18, the §4 one-fallback rule.
        .modifier(RoomZoomSourceMark(source: roomZoomSource, gameId: room.gameId))
        .onAppear {
            if room.id == rooms.last?.id {
                Task { await loadMore() }
            }
        }
    }

    /// The trailing shelf's quiet caps label: the app's chrome-achromatic label vocabulary
    /// (ClueChrome's browser sections), small and tracked, the ground's number ink. Never loud;
    /// the lifecycle fact is the section's to tell, not a chip on the card.
    private func sectionHeader(_ title: String) -> some View {
        Text(verbatim: title.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .padding(.top, 14)
            .padding(.bottom, 2)
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
            // Sort WITHIN the page by activity (PROTOCOL.md §12), the same order the server sends;
            // the client sort is belt-and-suspenders. Never re-sort across pages: pages are
            // createdAt-bounded and shown in order (page 2 is below the fold), so appending
            // preserves the documented "first page fully activity-ordered, deeper pages stable".
            rooms = RoomCardModel.orderedByActivity(page.rooms)
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
            // stopping is exactly the cursor contract. The incoming page is activity-ordered
            // within itself, then appended after the pages already shown (never a global re-sort).
            rooms.append(contentsOf: RoomCardModel.orderedByActivity(page.rooms))
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

// MARK: - The room-push zoom pairing (native continuity, DESIGN.md §4)

/// Stamps a room card as the push's zoom source with its per-room id, so the room
/// grows out of the card and pours back into it on the pop. Mirrors
/// JoinSheetSourceMark exactly: gated to iOS 18+ (the package floor on device); the
/// macOS test host (14) and any absent source leave the card bare, the §4
/// one-fallback rule.
private struct RoomZoomSourceMark: ViewModifier {
    let source: RoomZoomSource?
    let gameId: String

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 18.0, *), let source {
                content.matchedTransitionSource(
                    id: RoomZoomSource.sourceID(for: gameId), in: source.namespace)
            } else {
                content
            }
        #else
            content
        #endif
    }
}

/// Stamps the Join capsule as the room push's zoom source (slice 2): a code-join
/// grows the room from the capsule the sheet melted back into (native continuity,
/// DESIGN.md §4). Same gate as every other stamp (§4 one-fallback rule). This is a
/// SECOND source on the capsule (the join sheet's is the first): the two stamps
/// share the capsule's geometry under distinct ids, chained one over the other.
private struct JoinCapsuleRoomSourceMark: ViewModifier {
    let source: RoomZoomSource?

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 18.0, *), let source {
                content.matchedTransitionSource(
                    id: RoomZoomSource.joinCapsuleID, in: source.namespace)
            } else {
                content
            }
        #else
            content
        #endif
    }
}

extension View {
    /// The room push's destination half of the zoom: the room grows out of the
    /// card (or the Join capsule) that carries the matching source (native
    /// continuity, DESIGN.md §4). The composition root applies this to the room
    /// destination, passing the id of whichever source initiated the push; a nil id
    /// (a deep-link push, no visible source on screen) skips the zoom for the
    /// default push. Below iOS 18 (and the macOS test host) the room pushes plainly,
    /// the §4 one-fallback rule.
    public func roomZoom(from source: RoomZoomSource?, sourceID: String?) -> some View {
        modifier(RoomZoom(source: source, sourceID: sourceID))
    }
}

private struct RoomZoom: ViewModifier {
    let source: RoomZoomSource?
    let sourceID: String?

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 18.0, *), let source, let sourceID {
                content.navigationTransition(
                    .zoom(sourceID: sourceID, in: source.namespace))
            } else {
                content
            }
        #else
            content
        #endif
    }
}
