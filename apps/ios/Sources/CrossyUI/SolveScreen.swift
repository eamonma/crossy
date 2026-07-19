// The room (roadmap I2c): room bar over the grid (a back button, the time pill
// carrying the weather and the ambient clock, the players pill; owner ruling
// 2026-07-10), the clue bar as its own glass over a separate key deck (owner
// ruling 2026-07-10; SP-i5), the clue browser as a custom overlay panel morphing
// from its chrome (SP-i1's single surface), the roster as a system Menu flowing
// out of the players pill (RosterMenu, the Mail mechanism), the room-facts card
// morphing from the time pill (the time pill is the room's facts; at completion
// it is the stats card, ID-2), weather per DESIGN.md §8, and the spectator edge
// with its one affordance, Join in. Ground follows system appearance through
// CrossyDesign tokens (ID-3: two renders of one drawing, never two code paths).
// Composition roots hand in a store, a mapped puzzle, a clue book, and a room
// name; the transport behind the store is the only thing that changes between
// the demo room and I3's real connection.

import CrossyDesign
import CrossyProtocol
import CrossyStore
import SwiftUI

#if canImport(Accessibility)
    import Accessibility
#endif

@available(iOS 18.0, macOS 14.0, *)
@MainActor
public struct SolveScreen: View {
    private let store: GameStore
    private let puzzle: GridPuzzle
    /// The one-host arrival (DESIGN.md §4, the mid-transition paint finding): the
    /// live room mounts this screen WITH the push and never swaps it, so the bar
    /// is hosted exactly once. `opening` withholds the board and the deck (the
    /// puzzle is still the composition root's stand-in; no true geometry exists
    /// until REST lands) while the toolbar host stays mounted underneath.
    /// `barSettled` is the push's settle beat: until it is true, the bar's ITEM
    /// SET is frozen at its birth shape (presence computes against `connecting`),
    /// because an item inserted or re-hosted while the zoom is in flight is
    /// measured but never composited (the hollow-capsule finding). Steady-state
    /// compositions (the demo, the labs) pass neither and keep today's behavior.
    private let opening: Bool
    private let barSettled: Bool
    private let clues: ClueBook
    private let roomName: String
    private let puzzleTitle: String?
    private let puzzleAuthor: String?
    private let puzzleDate: String?
    /// The room's invite code, held client-side (PROTOCOL.md §12: `GET
    /// /games/{id}` returns it to any member). Feeds the share menu's titled
    /// read-aloud header and gates the share pill (with the link); nil while a
    /// room has no code in hand yet.
    private let inviteCode: String?
    /// The room's shareable link (ShareInvite.url, built by the composition
    /// root, which owns the game id). The share pill stands only when this and
    /// the code exist: never a dead control (the share surface).
    private let shareUrl: URL?
    private let onBack: () -> Void
    private let onJoinIn: () -> Void
    private let onExit: () -> Void
    /// Copy the share LINK to the clipboard (the share menu's Copy link row;
    /// the composition root owns the platform pasteboard, CrossyUI reports the
    /// intent only). This is where invite copying lives now (owner ruling
    /// 2026-07-11: the facts card's copy-code row retired).
    private let onCopyShareLink: () -> Void
    /// Hand the link to the system share surface (UIActivityViewController
    /// lives in the app target, AD-2; the card only reports the intent).
    private let onShareInvite: () -> Void
    /// Whether this composition's transport carries `checkPuzzle` to a real
    /// server (design R8): the live room passes true; the demo's loopback DROPS
    /// the command, so it — and every lab and preview — keeps the default and
    /// the facts sheet never grows the check row. Gates the row's existence
    /// entirely, not just the send.
    private let supportsRoomCheck: Bool
    /// End the game, host abandon (`POST /games/{id}/abandon`, PROTOCOL.md §12).
    /// Confirmed in the facts card, then reported here.
    private let onEndGame: () -> Void
    /// Kick a member, host only (`DELETE /games/{id}/members/{userId}`,
    /// PROTOCOL.md §12). Confirmed in the roster menu, then reported here.
    private let onKick: (String) -> Void
    /// The post-game analysis fetch, injected by the composition root (it closes
    /// over the REST client and the game id, keeping CrossyUI out of the REST ring,
    /// AD-2). Nil for compositions with no analysis (labs, some previews): there the
    /// completion keeps the old last-writer bloom and no panel summons.
    private let fetchAnalysis: (() async -> RoomAnalysis?)?
    /// The completion share card's whole act (Wave 14.5), injected by the composition
    /// root: mint the share link, fetch the SERVER card PNG for the given ground, build
    /// the image, and present the system share sheet, returning true once the sheet has
    /// it and false on any failure. Closes over the REST client, URLSession, UIImage, and
    /// UIActivityViewController in the app target, so CrossyUI stays out of the REST ring
    /// and free of UIKit (AD-2). Nil for compositions with no server card (labs, the
    /// offline demo): the header carries no button then.
    private let prepareShareCard: (@MainActor (GridGround) async -> Bool)?
    /// Where the reaction fan stands (Wave 7.5, revised by the owner's device pass
    /// 2026-07-14): detached and floating by default, the in-bar corner variant
    /// behind the launch flag so the A/B stays possible.
    private let reactionFanPlacement: ReactionFanPlacement
    /// The person's live swipe-sensitivity preference resolved to thresholds
    /// (NavigationSettingsStore.swipeTuning), threaded into the board's gesture layer
    /// the way navigationPrefs feeds the cursor. The composition root reads the store
    /// live, so a Settings change reaches an open room's next swipe. Standard is the
    /// pre-preference behavior for callers that pass none.
    private let swipeTuning: SwipeTuning
    @State private var model: SelectionModel
    @State private var chrome: RoomChromeModel
    @State private var completion = CompletionModel()
    @State private var analysis = AnalysisModel()
    @State private var shareCard = ShareCardModel()
    @State private var terminalPourBack = TerminalPourBackGate()
    @State private var hapticFold = SolveHapticFold()
    /// Room-space frames reported inside the room hierarchy (the board, the clue
    /// slot). The bar items report globally and merge in through `chromeFrames`
    /// below (the toolbar-adoption ruling, DESIGN.md §4).
    @State private var frames: [ChromePiece: CGRect] = [:]
    /// The bar items' GLOBAL frames (back button, time pill): the toolbar lives
    /// outside the room's coordinate space, so these convert into room space
    /// against `roomOrigin` (BarItemFrames). The facts card's rest and the
    /// eclipse test read the converted values through `chromeFrames`.
    @State private var barItemFrames: [ChromePiece: CGRect] = [:]
    /// The room's own global origin, for the conversion above. nil until the
    /// room lays out; the morph geometry withholds until then.
    @State private var roomOrigin: CGPoint?
    /// The room container's top safe-area inset: the system bar's standing height
    /// (the band the full-bleed board bleeds under), read off the room's own
    /// container, not any bar item's reported frame (DESIGN.md §2, the constant-
    /// built board inset, SLICE C). This is the grid's STANDING top occlusion, so
    /// the board's top edge is at its final position on frame one and never moves
    /// when the pill arrives. Seeded 0; the container reports it before the first
    /// paint (it is layout, not a welcome-gated bar item), so the grid never sits
    /// high waiting for it. The facts card and the clue-bar melt still read the
    /// reported bar-item frames (post-welcome, live); only the board goes constant.
    @State private var roomTopInset: CGFloat = 0
    /// The facts surface: a system sheet out of the time pill (2026-07-12,
    /// replacing the inflate-from-the-pill morph). A mid-solve surface only, so
    /// openFacts gates it to `ongoing` and a terminal transition dismisses it.
    @State private var factsPresented = false
    // The check vote (PROTOCOL.md §10, D32; Wave 15.10 card). `voteMirror` mirrors
    // `store.checkVote` so a close callback can read the pre-close vote (the store has already
    // cleared it when the close beat fires); `voteAct` is what plays after a close (the in-card
    // resolution, the pass's "Checking…" capsule, the landed count), token-guarded against a
    // newer vote superseding a scheduled withdrawal; `voteCardDismissed` is a viewer WITHOUT a
    // ballot putting the card away (CheckVoteCardPolicy — the wire has no vote-cancel, so the
    // proposer and a non-elector are never held for the timebox; the elector's ballot is the
    // exit and also sets this).
    @State private var voteMirror: CheckVoteState?
    @State private var voteAct: CheckVoteAct = .none
    @State private var voteActToken = 0
    @State private var voteCardDismissed = false
    /// The mark wash (U6): the reference-date instant a passing check's coats begin revealing
    /// in ascending cell order. Set on a live attributed check (never on snapshot healing, never
    /// under Reduce Motion), a breath after the marks apply, and retired once the wash finishes;
    /// the token guards the retirement against a newer wash.
    @State private var checkWashStartedAt: TimeInterval?
    @State private var checkWashToken = 0
    @State private var relay = CursorRelayThrottle()
    @State private var relayTrailing: Task<Void, Never>?
    /// The reaction sticker book (Wave 7.5; PROTOCOL.md §9): beside the store, never
    /// inside it (D24). The grid renders it; the fan and the store's fan-out feed it.
    @State private var reactions = ReactionModel()
    /// The fan's grammar (pure; ReactionFanModel). Owned here so the room's one
    /// dismissal seam can close a standing fan like any transient. Rebuilt when the
    /// personal set changes (below), so a Settings edit reaches an open room live.
    @State private var fan: ReactionFanModel
    /// The personal reaction set (D25), the shared store the composition root also
    /// feeds Settings, so the fan wears the person's own five and follows an edit
    /// live. nil (a rig with no store) reads the default five.
    private let reactionSets: ReactionSetStore?
    /// One avatar cache for the room's live pucks (the pill cluster), url-keyed so a
    /// shared avatar fetches once and the 1 Hz clock tick never re-hits the network
    /// (AvatarImage.swift). Injected into the environment below. A composition root may
    /// pass in the same instance it hands `.solveActivity`, so the island snapshot reads
    /// the images the room already resolved; otherwise a fresh one is made in init.
    @State private var avatarCache: AvatarImageCache
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// `model` lets a composition root own the selection; `chrome` likewise owns
    /// the room's overlay state (the demo room scripts both for screenshots).
    /// `puzzleTitle`/`puzzleAuthor`/`puzzleDate` are render params for the facts
    /// card: the wire types carry no puzzle metadata yet, so composition roots
    /// pass what they know (the wire hookup is a follow-on). `onBack` is the
    /// back button's way out, wired by the arrival flow when it exists;
    /// `onJoinIn` is the spectator's seat-change intent, wired to the real
    /// endpoint in I3; `onExit` is the kicked exit's way back to Rooms, wired
    /// when Rooms exists (I3).
    public init(
        store: GameStore,
        puzzle: GridPuzzle,
        clues: ClueBook = .empty,
        roomName: String = "",
        puzzleTitle: String? = nil,
        puzzleAuthor: String? = nil,
        puzzleDate: String? = nil,
        inviteCode: String? = nil,
        shareUrl: URL? = nil,
        model: SelectionModel? = nil,
        chrome: RoomChromeModel? = nil,
        avatarCache: AvatarImageCache? = nil,
        opening: Bool = false,
        barSettled: Bool = true,
        supportsRoomCheck: Bool = false,
        onBack: @escaping () -> Void = {},
        onJoinIn: @escaping () -> Void = {},
        onExit: @escaping () -> Void = {},
        onCopyShareLink: @escaping () -> Void = {},
        onShareInvite: @escaping () -> Void = {},
        onEndGame: @escaping () -> Void = {},
        onKick: @escaping (String) -> Void = { _ in },
        fetchAnalysis: (() async -> RoomAnalysis?)? = nil,
        prepareShareCard: (@MainActor (GridGround) async -> Bool)? = nil,
        reactionFanPlacement: ReactionFanPlacement = .floating,
        reactionSets: ReactionSetStore? = nil,
        swipeTuning: SwipeTuning = .standard
    ) {
        self.store = store
        self.puzzle = puzzle
        self.clues = clues
        self.roomName = roomName
        self.puzzleTitle = puzzleTitle
        self.puzzleAuthor = puzzleAuthor
        self.puzzleDate = puzzleDate
        self.inviteCode = inviteCode
        self.shareUrl = shareUrl
        self.opening = opening
        self.barSettled = barSettled
        self.supportsRoomCheck = supportsRoomCheck
        self.onBack = onBack
        self.onJoinIn = onJoinIn
        self.onExit = onExit
        self.onCopyShareLink = onCopyShareLink
        self.onShareInvite = onShareInvite
        self.onEndGame = onEndGame
        self.onKick = onKick
        self.fetchAnalysis = fetchAnalysis
        self.prepareShareCard = prepareShareCard
        self.reactionFanPlacement = reactionFanPlacement
        self.reactionSets = reactionSets
        self.swipeTuning = swipeTuning
        // The fan is born wearing the personal five (or the defaults); the onChange
        // below re-dresses it if the set changes while the room stands.
        _fan = State(
            initialValue: ReactionFanModel(
                emojis: reactionSets?.slots ?? ReactionPolicy.defaultSet))
        _model = State(initialValue: model ?? SelectionModel(store: store, puzzle: puzzle))
        _chrome = State(initialValue: chrome ?? RoomChromeModel())
        // A composition root that also drives the island snapshot passes the SAME cache it
        // hands `.solveActivity`, so the island writer reads the very images the room already
        // resolved (no second fetch). A lone caller passes nil and gets a fresh cache.
        _avatarCache = State(initialValue: avatarCache ?? AvatarImageCache())
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    public var body: some View {
        // The kicked exit replaces the room outright (EXPERIENCE.md: the room
        // exits with one honest sentence); there is no board left to browse.
        if chrome.kicked {
            KickedExit(ground: ground, onExit: onExit)
        } else {
            room
        }
    }

    private var room: some View {
        let weather = RoomWeather.from(sync: store.sync)
        let members = rosterMembers
        let spectating = RosterList.selfIsSpectator(members, selfUserId: store.selfUserId)
        let status = roomStatus
        // The bar's item set freezes until the push settles (the mid-transition
        // paint finding, DESIGN.md §4): presence computes against `connecting`
        // until then, so nothing inserts into a bar the system will not
        // composite. The seeded players and share pills predate the freeze (they
        // are the birth shape, standing from the push's first frame); only the
        // timer and the unseeded cluster wait out the settle beat.
        let barSync: SyncState = barSettled ? store.sync : .connecting

        return ZStack {
            // The room's own bounds in its coordinate space (owner ask
            // 2026-07-13): a clear, inert layer whose reported frame gives the
            // completed clue melt the room's full width and its safe-area bottom
            // (meltMorph then bleeds past that edge). A flexible child accepting
            // the proposed size, so it never resizes the ZStack; the board and
            // slot frames are untouched.
            Color.clear
                .allowsHitTesting(false)
                .reportChromeFrame(.roomContainer)

            // The base layer: the full-bleed board over the deck (the owner's
            // full-bleed ruling, 2026-07-10). The board runs from the screen's
            // top edge to the deck's top and never under the deck (ID-4: the
            // deck sits over solid canvas, never over the grid); the room bar
            // and the clue bar float over it as separate layers, so neither
            // bar's height is the board's business.
            VStack(spacing: 0) {
                if opening {
                    // The withheld birth (the one-host arrival): no true geometry
                    // exists before REST, so the board and the deck stand down and
                    // the canvas holds the frame. The toolbar host below stays
                    // mounted throughout, which is the whole point: the bar is
                    // born once with the push and its content is never re-hosted.
                    Color.clear
                } else {
                    // The board's arrival is a fade IN PLACE: its top edge is
                    // layout truth from frame one (the constant-built inset,
                    // DESIGN.md §2) and must not move on any data beat, so the
                    // grid may only gain presence, never position.
                    boardArea(weather: weather)
                        .transition(.opacity)

                    // A terminal status retires the deck for everyone, spectator or
                    // not (RoomTerminal.deckRetired; a frozen room has no seat worth
                    // upgrading): mutations were already refused by the store and
                    // InputActions, this is the rendered truth. Selection stays for
                    // browsing; taps and swipes are pure navigation after the freeze.
                    Group {
                        switch status {
                        case .completed:
                            // The finished room breathes (owner ruling 2026-07-10,
                            // removing the first build's Solved-together zone and its
                            // Stats button): the deck just leaves, the board keeps the
                            // space, and the stats live behind the frozen clock.
                            Color.clear.frame(height: 12)
                        case .abandoned:
                            abandonedZone
                        case .ongoing:
                            if spectating {
                                watchingZone
                            } else {
                                deckZone
                            }
                        }
                    }
                    // The deck arrives the way a keyboard does: rising from the
                    // bottom edge (with the fade), the system's own grammar for
                    // this surface. Removal keeps the quiet crossfade a terminal
                    // status has always used (the deck "just leaves").
                    .transition(
                        .asymmetric(
                            insertion: .move(edge: .bottom).combined(with: .opacity),
                            removal: .opacity))
                }
            }
            // Transient panels yield to intent (DESIGN.md §4): every touch
            // below the bar dismisses an open roster or stats card AND
            // lands (simultaneous, so grid taps, deck presses, and the
            // zones' buttons all keep firing). The panels sit above this
            // layer and their inner blockers keep panel taps inside.
            .simultaneousGesture(TapGesture().onEnded { dismissTransients() })
            // A terminal status reshapes the room (the deck leaves, the board
            // takes its space): the board rides the layout change on the chrome
            // spring instead of jumping (owner finding 2026-07-10). Reduce
            // Motion cuts.
            .animation(reduceMotion ? nil : .crossyChrome, value: status)
            // The withheld birth's settle beat rides the same spring (the
            // one-host arrival): the grid fades in place, the deck rises. Reduce
            // Motion cuts, leaving the honest instant swap.
            .animation(reduceMotion ? nil : .crossyChrome, value: opening)

            // The completion confetti (owner ask 2026-07-11): a restrained
            // roster-colored drift riding the celebration's instant, between
            // paper and glass (§1: people between) so the chrome above stays
            // legible. The model owns its clock: never set under Reduce Motion,
            // nilled when the drift ends, so this layer simply unmounts.
            if let confettiStart = completion.confettiStartedAt {
                ConfettiOverlay(field: confettiField, startedAt: confettiStart)
            }

            // The room's top chrome is the system navigation bar's items now
            // (the toolbar-adoption ruling, DESIGN.md §4): the pieces goo into
            // the Rooms Join item across the #132 zoom push. The hand-drawn
            // overlay retired; the toolbar is attached at the bottom of `room`
            // (`.modifier(RoomToolbarHost(...))`), because ToolbarContent binds
            // to the navigation container, not this ZStack. No cluster
            // tap-catcher is needed here: the bar items report frames globally
            // and the room's base layer already yields any outside touch
            // (dismissTransients).

            if let morph = meltMorph {
                ClueChrome(
                    ground: ground,
                    morph: morph,
                    current: clues.current(for: model.selection),
                    acrossRows: ClueBrowserList.rows(
                        clues.across, selection: model.selection, filled: filledCells,
                        referenced: referencedIds),
                    downRows: ClueBrowserList.rows(
                        clues.down, selection: model.selection, filled: filledCells,
                        referenced: referencedIds),
                    glintMarks: glintMarks,
                    chrome: chrome,
                    // Completion turns the browser into the tabbed analysis surface
                    // (owner ruling 2026-07-13); mid-solve these are inert.
                    completed: status == .completed,
                    analysisPhase: analysis.phase,
                    analysisMembers: members,
                    selfUserId: store.selfUserId,
                    isolatedSolverId: completion.isolatedSolverId,
                    // Isolation exists only on the SETTLED wash: nil while the
                    // bloom plays keeps the legend rows plain labels, and the
                    // model's own gate holds even if a stale tap lands.
                    onIsolateSolver: completion.mosaicSettled
                        ? { completion.toggleIsolation($0) } : nil,
                    // The completion share card (Wave 14.5): the affordance stands only
                    // when the composition root injected a way to mint and present it
                    // (the live room; the offline demo and the labs pass none, so the
                    // header carries no button). The intent runs the injected mint +
                    // PNG fetch + present through the model's state machine, capturing
                    // this room's current ground so the server renders the matching card.
                    shareCard: prepareShareCard != nil ? shareCard : nil,
                    onShareCard: prepareShareCard.map { prepare in
                        { shareCard.share { await prepare(ground) } }
                    },
                    onDismissTransients: dismissTransients,
                    onPrevious: { model.swipe(.previousWord) },
                    onNext: { model.swipe(.nextWord) },
                    onJump: { model.jump(to: ClueBrowserList.jumpTarget($0)) },
                    // The fan rides the bar's corner (Wave 7.5) in the default
                    // placement; the deck-edge alternate hosts it below instead.
                    reactionFan: reactionFanPlacement == .clueBarCorner ? $fan : nil,
                    onReactionFire: { fireReaction($0) })
                    // The clue bar joins the settle beat's fade: it mounts one
                    // frame after the board (its rest slot is a reported frame),
                    // so it rides its own presence on the same spring instead of
                    // popping against the grid's fade.
                    .transition(.opacity)
                    // The completed melt pours to the phone's bottom edge as a
                    // sheet (owner ask 2026-07-13): let the surface draw past the
                    // bottom safe area so the glass reaches the true edge and the
                    // display's own corners clip it. Mid-solve the surface rests
                    // well above this, so it is inert then.
                    .ignoresSafeArea(.container, edges: .bottom)
            }

            // The check vote (PROTOCOL.md §10, D32; Wave 15.10): the centered blocking card
            // over its scrim. Mounted ABOVE the clue chrome (a pending vote is never buried;
            // a facts sheet or open browser yields at the open beat), and it never appears for
            // a solo electorate (the auto-pass shows no chrome for a frame).
            checkVoteLayer

            // The DETACHED fan, the default placement (owner lean 2026-07-14:
            // "separate from clue bar"): a lone glass button floating 10 pt above
            // the bar's trailing corner, over the feather, aligned to the bar's
            // trailing edge. It rides the slot's reported frame, so a wrapping
            // clue lifts it with the bar; it stands in EVERY status at melt rest
            // (completed and abandoned included: §9, reactions on the finished
            // grid are intended, the web's completed board keeps its tray), and
            // it clears the enlarged chevron targets by 4 pt plus topmost z. Any
            // melt progress hides it instantly (SP-i1: nothing animates under a
            // live finger; the open browser owns that geometry).
            // The fan yields while the blocking vote card stands (the vote wins the
            // stage; nothing floats over the scrim).
            if reactionFanPlacement == .floating, chrome.meltProgress < 0.05,
                !voteCardStanding,
                let slot = chromeFrames[.clueBarSlot]
            {
                ReactionFan(fan: $fan, ground: ground, onFire: fireReaction)
                    .position(
                        x: slot.maxX - ReactionFan.buttonSize / 2,
                        y: slot.minY - 10 - ReactionFan.buttonSize / 2)
            }

            // No tap-away catchers anywhere (DESIGN.md §4: transient panels
            // yield to intent): a touch outside an open panel dismisses it
            // through the surfaces it lands on, and still lands. The panels'
            // own inner tap blockers are the only thing keeping a touch from
            // falling through them. The roster is not here: it is a system
            // presentation out of the players pill (RosterMenu), so the system
            // owns its stage, its dismissal, and its stacking.

            // The room-facts surface is a system sheet now (owner ruling
            // 2026-07-12: the time pill's tap presents RoomFactsSheet, the
            // ShareQRSheet register, replacing the inflate-from-the-pill morph
            // the owner read as ad-hoc goo). Presented as a `.sheet` off the
            // room container below, so like the roster and share menus the
            // system owns its stage, its dismissal, and its stacking; nothing
            // custom stands here.

            // The share surface is a system Menu now (owner ruling
            // 2026-07-11), presented out of the share pill in the bar
            // (ShareMenuPill), so no custom panel stands here: the system
            // owns its stage, its dismissal, and its stacking, exactly as
            // the roster menu does.
        }
        // The clue bar's arrival scope (see its `.transition` above): its
        // presence flips when the rest slot's frame first reports, one frame
        // after `opening` flips, so it needs its own animation value.
        .animation(reduceMotion ? nil : .crossyChrome, value: meltMorph != nil)
        .coordinateSpace(name: ChromeLayout.roomSpace)
        // The room container's top safe-area inset: the system bar's standing
        // height, the band the full-bleed board bleeds under (DESIGN.md §2, the
        // constant-built board inset, SLICE C). Read off the room's OWN container
        // here (the ZStack under the visible, transparent nav bar), so the grid's
        // standing top occlusion is layout truth, not a welcome-gated bar item's
        // reported frame. The container reports this before the first paint, so the
        // board's top edge is final on frame one and never moves when the pill
        // arrives. `.onGeometryChange` is iOS 18 / macOS 15; older floors and the
        // macOS test host (14) keep the 0 seed (the room never renders on macOS;
        // tests read the pure GridOcclusion seam directly).
        .modifier(RoomTopInsetReader { roomTopInset = $0 })
        // The room's global origin, for converting the bar items' global frames
        // into room space (the toolbar-adoption ruling, DESIGN.md §4). Read off
        // the same ZStack the coordinate space is named on, so the origin IS the
        // room space's zero.
        .background(
            GeometryReader { proxy in
                Color.clear.preference(
                    key: RoomOriginKey.self, value: proxy.frame(in: .global).origin)
            }
        )
        .onPreferenceChange(ChromeFramesKey.self) { frames = $0 }
        // The bar items report through a closure (RoomBarInputs.reportFrame), not
        // a preference: a preference set inside a ToolbarItem never crosses the
        // UIKit nav-bar boundary (the integration trap, DESIGN.md §4). The room
        // origin is reported inside THIS hierarchy, so it stays a preference.
        .onPreferenceChange(RoomOriginKey.self) { roomOrigin = $0 }
        // The room's top chrome as the system nav bar's items (the
        // toolbar-adoption ruling, DESIGN.md §4). Attached here so the content
        // binds to the navigation container; the composition root leaves the bar
        // visible, title-less, and the system back hidden. On 26 the RoomToolbar
        // carries the ToolbarSpacer split; below 26 (and the macOS test host) the
        // fallback carries the same pieces plainly (the §4 one-fallback rule).
        .modifier(
            RoomToolbarHost(
                inputs: RoomBarInputs(
                    ground: ground,
                    weather: weather,
                    reconnectRetryAt: chrome.reconnectRetryAt,
                    firstFillAt: store.firstFillAt,
                    // The clock freezes at either terminal instant: completion
                    // freezes it by design (ID-2), and an abandoned room is
                    // terminal and quiet (EXPERIENCE.md), so its clock stops at
                    // the abandonment rather than ticking over a dead board.
                    completedAt: store.completedAt ?? store.abandonedAt,
                    members: members,
                    // No custom panel stands over the bar anymore (the facts
                    // card became a system sheet, which dims the room rather
                    // than burying a pill in our glass), so no pill is ever
                    // eclipsed: both stand for the sheet's life.
                    backHandedOff: false,
                    timeHandedOff: false,
                    // Each trailing piece gates per the seeded-birth rule (DESIGN.md
                    // §4 toolbar amendment, §12): the timer waits for the welcome on
                    // both paths (its clock needs the welcome), while the players and
                    // share pills stand from the push's first frame when the room was
                    // born with a seed (chrome.seeded), so a card-tap arrival keeps
                    // them standing across the withheld→ready swap and the goo plays
                    // on live data. Unseeded, all three wait for the welcome (the
                    // one-beat fallback). ClusterPresence is the one pure seam; share
                    // keeps `hasShare` on top for its payload gate.
                    showsTimer: ClusterPresence.showsTimer(sync: barSync),
                    showsPlayers: ClusterPresence.showsPlayers(
                        sync: barSync, seeded: chrome.seeded),
                    showsShare: ClusterPresence.showsShare(
                        sync: barSync, seeded: chrome.seeded),
                    hasShare: shareable != nil,
                    onBack: onBack,
                    // The tap presents the facts sheet (2026-07-12), mid-solve
                    // only: openFacts gates the summon to `ongoing`, so a tap on
                    // a sealed terminal pill does nothing.
                    onTapTimePill: { openFacts() },
                    // The share surface ships as the native menu (owner ruling
                    // 2026-07-11): the code for the titled section, the link the
                    // QR and copy rows carry, and the app-target seams.
                    shareCode: shareable?.code,
                    shareUrlString: shareable?.url.absoluteString,
                    onCopyShareLink: onCopyShareLink,
                    onShareInvite: onShareInvite,
                    status: status,
                    selfUserId: store.selfUserId,
                    onJoinIn: onJoinIn,
                    onKick: onKick,
                    onGoTo: { member in
                        guard let cursor = member.cursor else { return }
                        dismissTransients()
                        model.jump(
                            to: GridSelection(
                                cell: cursor.cell, isAcross: cursor.isAcross))
                    },
                    // The bar items hand their global frames here, escaping the
                    // toolbar's preference boundary (the integration trap): the
                    // melt reads the converted values through `chromeFrames`.
                    reportFrame: { piece, global in barItemFrames[piece] = global }))
        )
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        // The facts sheet (owner ruling 2026-07-12): the time pill's tap presents
        // it, the ShareQRSheet register. A mid-solve surface only, so openFacts
        // gates the summon to `ongoing` and a terminal transition dismisses it.
        .sheet(isPresented: $factsPresented) { factsSheet }
        // The clarity beat (DESIGN.md §4, §8): every standing surface reads the
        // flag through the environment; below iOS 26 the fallback stays inert.
        .environment(\.chromeClarified, completion.isClarityBeat)
        // The room's live pucks read the avatar cache here (the pill cluster); a
        // null or unresolved url just shows the initial (PROTOCOL.md §4).
        .environment(\.avatarImageCache, avatarCache)
        .onChange(of: model.selection) { _, selection in
            relayCursor(selection, spectating: spectating)
            observeHaptics()
        }
        // The board's haptic moments (DESIGN.md §7): selection above and the
        // filled composite here feed one fold with whole current state, so the
        // observers can fire in either order or collapse into one
        // (SolveHapticFold derives whose hand moved from the delta).
        .onChange(of: filledCells) { _, _ in observeHaptics() }
        // The gate's one firing (INV-3) carries the §7 completion haptic. The
        // facts surface no longer auto-summons at completion (owner ruling
        // 2026-07-12: not at game end): the pill seals and stands as the record,
        // and post-game stats move to the clue-panel analysis surface.
        .onChange(of: completion.celebrationFiredAt) { _, fired in
            guard fired != nil else { return }
            SolveHaptics.shared.play(.completion)
            // With no analysis fetch wired (labs, previews), keep the old instant
            // bloom: last-writer colors, no panel. With a fetch, the bloom waits for
            // the bundle (observed on analysis.phase below), so the color is
            // first-correct truth (owner ruling 2026-07-13).
            if fetchAnalysis == nil {
                completion.startMosaic(summonOnSettle: false, reduceMotion: reduceMotion)
            }
        }
        // The bloom paints first-correct owners, so it waits for the fetch (owner
        // ruling 2026-07-13). Only the LIVE completion edge blooms (the gate fired,
        // celebrationFiredAt set): a ready bundle blooms in first-correct color and
        // arms the panel summon; an absent bundle falls back to the last-writer bloom
        // with no summon. A reconnect into a completed room never blooms or summons
        // (the celebration is a live-edge moment, INV-3) — but the terminal board
        // WEARS the settled field once the bundle lands (standMosaic): the record
        // stands on every visit, it does not exist only inside the one bloom (the
        // flash-then-disappear fix's revisit half). An absent bundle stands nothing:
        // the wash is first-correct truth, and without the bundle there is none.
        .onChange(of: analysis.phase) { _, phase in
            if completion.celebrationFiredAt != nil {
                switch phase {
                case .ready:
                    completion.startMosaic(summonOnSettle: true, reduceMotion: reduceMotion)
                case .absent:
                    completion.startMosaic(summonOnSettle: false, reduceMotion: reduceMotion)
                case .idle, .loading:
                    break
                }
            } else if roomStatus == .completed, case .ready = phase {
                completion.standMosaic()
            }
        }
        // The panel arrives AFTER the bloom settles (owner ruling 2026-07-13): melt
        // the chrome open on the Analysis tab. The melt walk yields to a live finger
        // (SP-i1), and Reduce Motion cuts straight to the open state.
        .onChange(of: completion.summonToken) { _, token in
            guard token > 0 else { return }
            chrome.analysisTab = .analysis
            chrome.settleMelt(open: true, animated: !reduceMotion)
        }
        // The celebration derives from store TRANSITIONS, observed here and
        // seeded once on appear, never from render (INV-3; the gate is the
        // exactly-once fold). Both observers feed the same gate because either
        // fact can move alone; the gate is idempotent on repeats.
        .onChange(of: store.status) { _, _ in observeRoomState() }
        .onChange(of: store.sync) { _, _ in observeRoomState() }
        // Mirror the open vote so a close beat AND the resolution card can read the pre-close
        // vote (the store nils `checkVote` before the close renders, so the mirror keeps the
        // LAST vote standing rather than following it to nil — the recess card reads it for
        // its role and tally). A NEW vote (a different openedSeq — snapshot healing can swap
        // one in with no open beat) resets the dismissed flag so the fresh question presents.
        .onChange(of: store.checkVote) { old, vote in
            guard let vote else { return }
            if vote.openedSeq != old?.openedSeq { voteCardDismissed = false }
            voteMirror = vote
        }
        .onAppear {
            observeRoomState()
            // Seed the close-state mirror: a rejoin mid-vote heals `checkVote` from the
            // snapshot before this view observes any change, and without the seed the
            // eventual close would find no pre-close vote to resolve against.
            voteMirror = store.checkVote
            // Seed the haptic fold (the first observation never buzzes) and
            // keep the generators warm (the KeyHaptics discipline).
            observeHaptics()
            SolveHaptics.shared.prepare()
            wireReactionSink()
            // The room's check landing and the three vote beats (PROTOCOL.md §6, §10; D32):
            // the card, the haptics, and the reveal. Fired only for live sequenced events.
            wireCheckVoteBeats()
        }
        // The sink closes over the grid it validates against, so the live room's
        // retarget from the 1x1 stand-in must re-wire it (the stand-in would drop
        // every reaction as out of range forever).
        .onChange(of: puzzle) { _, _ in wireReactionSink() }
        // The personal set changed while the room stands (a Settings edit, or /me
        // landing after the push): re-dress the fan with the new five (D25). The
        // rebuild closes an open fan, which is the safe reading of a set change
        // mid-gesture; receive-side rendering is untouched (receive-any, §9).
        .onChange(of: reactionSets?.slots) { _, slots in
            guard let slots, fan.emojis != slots else { return }
            fan = ReactionFanModel(emojis: slots)
        }
        .onDisappear {
            relayTrailing?.cancel()
            relay.trailingCancelled()
        }
    }

    // MARK: - The full-bleed board

    /// The board and the clue bar's floating rest slot, one layer (the
    /// full-bleed ruling, owner ask 2026-07-10). The grid is the base, bled to
    /// the screen's top edge; the slot rides the board's bottom edge with the
    /// feather washing up beneath it, so a wrapping clue grows the slot upward
    /// on the chrome spring and the board underneath never moves. The camera,
    /// not the layout, keeps the selected cell readable: the standing insets
    /// clamp (GridOcclusion.standing, constant under clue growth) and the live
    /// slot only rescues the occluded cell (keepClear).
    private func boardArea(weather: RoomWeather) -> some View {
        // The bar freezes to a fixed single-line height on the completed Analysis
        // tab (owner ruling 2026-07-13): the door shows no clue, so the slot must not
        // breathe to the (invisible) clue's wrap. On the Clues tab and mid-solve it
        // still sizes to the clue.
        let analysisResting = roomStatus == .completed && chrome.analysisTab == .analysis
        let restingClue = analysisResting ? nil : clues.current(for: model.selection)
        return ZStack(alignment: .bottom) {
            CrossyGridView(
                store: store, puzzle: puzzle, ground: ground,
                selection: model.selection,
                // The cells the current clue names get a faint tint relative to the
                // selection: the same referencedIds that light the browser rows below,
                // mapped to their cells, so board and browser never disagree on what
                // the current clue names. A pure function of the same clue book and
                // selection, kept next to those derivations.
                crossReference: clues.cells(of: referencedIds),
                reactions: reactions,
                mosaicStartedAt: completion.mosaicStartedAt,
                // The bloom's colors are first-correct owners once GET /analysis
                // lands (owner ruling 2026-07-13); nil until then, where the grid
                // falls back to the event log's last writer (the absent fallback).
                mosaicOwners: analysis.bundle?.owners,
                // Once the envelope lands the wash STANDS and the grid's timeline
                // pauses (the flash-then-disappear fix: the settle returns the
                // letters to ink, never the board to plain).
                mosaicSettled: completion.mosaicSettled,
                // The isolation filter over the settled record: the analysis
                // legend's tapped solver holds the full wash, everyone else
                // recesses toward paper. One truth on CompletionModel, read by
                // the legend rows and this draw pass alike.
                mosaicIsolation: completion.isolation,
                // The check mark wash (Wave 15.5, U6): a passing check reveals its coats
                // in ascending cell order from this instant. Nil except during the reveal
                // (and always nil under Reduce Motion), where the coats draw instantly.
                checkWashStartedAt: checkWashStartedAt,
                // The approved directional loupe belongs only to the settled completed board's
                // Analysis reading. The Clues tab keeps the established frozen paper treatment.
                showsWordLoupe: analysisResting && completion.mosaicSettled,
                // The BOARD's standing occlusion is constant-built (DESIGN.md §2,
                // SLICE C): the top inset is the room container's system-bar height
                // (roomTopInset, read off the room's own container), never the
                // synthesized bar-item frame, so the grid's top edge is final on
                // frame one and does not move when the pill arrives.
                occlusion: .standing(
                    board: chromeFrames[.board], topInset: roomTopInset),
                keepClear: .keepClear(
                    board: chromeFrames[.board], topInset: roomTopInset,
                    clueSlot: chromeFrames[.clueBarSlot]),
                // The person's swipe-sensitivity preference (root DESIGN.md §5),
                // threaded live from Settings so the next swipe honors a change.
                swipeTuning: swipeTuning,
                // A swipe never becomes a tap, so the yield law needs
                // its own hook here (DESIGN.md §4): panels pour back,
                // the swipe still navigates.
                onSwipe: { intent in
                    dismissTransients()
                    model.swipe(intent)
                },
                onPlaceCursor: { cell in
                    dismissTransients()
                    model.tap(cell: cell)
                })
                .overlay {
                    // Reconnecting dims the room (DESIGN.md §8): a paper wash,
                    // never a modal, never a spinner. Input stays live; the
                    // store holds it gracefully (PROTOCOL.md §8).
                    if weather.boardDimmed {
                        Color(rgb: ground.tokens.canvas)
                            .opacity(RoomWeather.boardDimOpacity)
                            .allowsHitTesting(false)
                    }
                }
                .animation(.crossyChrome, value: weather.boardDimmed)
                // Reported BEFORE the safe-area bleed, so the frame rides the
                // expansion and the occlusion insets convert into the board's
                // real coordinates (reported after, the frame stays the safe
                // slot and the top inset comes up a safe-area short; measured
                // on the 17 Pro sim, 2026-07-10).
                .reportChromeFrame(.board)
                .ignoresSafeArea(edges: .top)

            // The clue bar's rest slot: the melting surface renders in the
            // outer overlay at exactly this frame, so layout owns the geometry
            // and the morph only borrows it. The slot is the row's invisible
            // twin (ClueBarSizer), bottom edge pinned to the board's floor, so
            // a wrapping clue grows the bar UP over the board and nothing else
            // re-lays out. The height change between clues rides the chrome
            // spring (the terminal-reshape precedent, owner finding
            // 2026-07-10); Reduce Motion cuts. Keyed on the clue, so mid-word
            // cursor moves never enter an animated transaction. The feather
            // rides as the slot's background, sized by the same layout.
            ClueBarSizer(
                ground: ground, current: restingClue,
                reservesFanSlot: reactionFanPlacement == .clueBarCorner
            )
                .reportChromeFrame(.clueBarSlot)
                .padding(.horizontal, ChromeLayout.inset)
                .background(alignment: .bottom) {
                    ClueFeatherWash(ground: ground)
                        .padding(.top, -ClueFeather.extent)
                }
                .animation(
                    reduceMotion || analysisResting ? nil : .crossyChrome,
                    value: restingClue?.tag)
        }
    }

    // MARK: - Derived render inputs

    /// The one frame map the room's geometry reads (the toolbar-adoption ruling,
    /// DESIGN.md §4). The room-space frames (the board, the clue slot) merge with
    /// the bar items' global frames converted into room space (the back button,
    /// the time pill), plus a synthesized `roomBar` frame for the FACTS CARD's span
    /// and the CLUE-BAR MELT's rest (both post-welcome, when the frames are live).
    /// The BOARD's standing occlusion no longer reads this map at all (SLICE C): its
    /// top inset is the room container's constant-built system-bar height
    /// (roomTopInset), so the grid never waits on a reported frame. Withheld pieces
    /// (not yet measured) stay absent, and the card and melt withhold until the
    /// geometry is real, exactly as before.
    private var chromeFrames: [ChromePiece: CGRect] {
        var merged = frames
        let converted = BarItemFrames.inRoomSpace(barItemFrames, roomOrigin: roomOrigin)
        merged.merge(converted) { _, bar in bar }
        if let bar = synthesizedRoomBar(from: merged) {
            merged[.roomBar] = bar
        }
        return merged
    }

    /// The synthesized `roomBar` frame for the FACTS CARD's horizontal span and the
    /// CLUE-BAR MELT's geometry (the toolbar-adoption ruling; the pure seam is
    /// BarItemFrames.synthesizedRoomBar). Anchored on the back button, which stands
    /// in the bar row from frame one, so the span holds identical before and after
    /// the time pill arrives. The board's standing inset is constant-built and does
    /// NOT read this (SLICE C, §2); the card and melt read it only post-welcome,
    /// when their own reported frames (the pill, the clue slot) are live too, so a
    /// pre-welcome value never launches either morph.
    private func synthesizedRoomBar(from merged: [ChromePiece: CGRect]) -> CGRect? {
        BarItemFrames.synthesizedRoomBar(from: merged, inset: ChromeLayout.inset)
    }

    /// The store's status as render data (the RosterMember pattern: protocol
    /// types stay in their ring, AD-2).
    private var roomStatus: RoomStatus {
        switch store.status {
        case .ongoing: return .ongoing
        case .completed: return .completed
        case .abandoned: return .abandoned
        }
    }

    /// The facts card's words (RoomFactsContent pins the rule): mid-solve the
    /// room's name and the puzzle's facts, at completion the lexicon word and
    /// the server's stats.
    private var factsContent: RoomFactsContent {
        RoomFactsContent.make(
            roomName: roomName,
            puzzleTitle: puzzleTitle,
            puzzleAuthor: puzzleAuthor,
            puzzleDate: puzzleDate,
            completed: roomStatus == .completed,
            totalEvents: store.stats?.totalEvents,
            participantCount: store.stats?.participantCount,
            // The mid-solve check record (R10): "Checked once" among the facts.
            checkCount: store.checkCount,
            // The sitting count as completed-facts context (D29): "· 2 sittings",
            // rendered only at two or more; nil (a pre-D29 row) reads as today.
            sittingCount: store.stats?.sittingCount)
    }

    /// The facts card's operations (FactsOperations pins the rule): the room
    /// check above the host's end-game, only while the room runs. The check row
    /// stands for hosts and solvers on a check-capable transport (R8: the demo
    /// never grows it) and enables only on a full SEQUENCED grid (R9: the store's
    /// filledCount excludes overlays, mirroring the server's own gate); the
    /// destructive end-game renders only for the host (the server enforces both
    /// gates regardless; the client simply does not offer what it will refuse).
    /// A terminal card carries none: it is the record, not a control surface
    /// (ending an already-ended game is a no-op, INV-4).
    private var factsPanelOperations: FactsOperations {
        guard roomStatus == .ongoing else { return .none }
        let members = rosterMembers
        let selfIsHost =
            members.first { $0.userId == store.selfUserId }?.isHost ?? false
        return FactsOperations.make(
            isHost: selfIsHost,
            isSpectator: RosterList.selfIsSpectator(members, selfUserId: store.selfUserId),
            supportsCheck: supportsRoomCheck,
            emptyCells: puzzle.playableCellCount - store.filledCount)
    }

    /// The invite in hand, or nil when there is nothing to share yet: the
    /// share menu requires both the link (the QR row and copy row's payload)
    /// and the code (the menu's titled read-aloud header). The composition
    /// root builds the link FROM the code (ShareInvite.url), so in practice
    /// they arrive together.
    private var shareable: (url: URL, code: String)? {
        guard let shareUrl, let inviteCode, !inviteCode.isEmpty else { return nil }
        return (shareUrl, inviteCode)
    }

    private func observeRoomState() {
        // The room's own moments yield like any touch (DESIGN.md §4): the one
        // observed transition into a terminal status pours back the melt and
        // dismisses the facts sheet. A fold, not a render fact, so a reconnect
        // into an already-terminal room never replays the pour-back. (An open
        // roster menu is the system's; it holds until a touch, which is how
        // Mail behaves too.)
        if terminalPourBack.observe(roomStatus) {
            // Never rip the melt from a live finger (SP-i1: the finger owns
            // progress): a melt mid-drag when the room turns terminal stays
            // with the finger, and the release settles it as usual.
            chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
            // An open mid-solve facts sheet dismisses when the room turns
            // terminal: its operations just died with the room, and the facts
            // surface is not shown at game end (owner ruling 2026-07-12). The
            // sealed pill stands as the record instead.
            factsPresented = false
            // The share menu is the system's now: it dismisses on any touch,
            // Mail's own behavior, so there is nothing here to pour back.
        }
        completion.observe(
            status: roomStatus,
            live: store.sync == .live,
            reduceMotion: reduceMotion)
        // The analysis fetch fires once the room is completed (a live finish OR a
        // reconnect into an already-completed room), so the Analysis tab has data
        // whether or not the celebration played. Idempotent (fetches at most once);
        // a 404 during the completion race retries (AnalysisModel). A composition
        // with no fetch wired stays on the old last-writer bloom (see the
        // celebrationFiredAt observer).
        if roomStatus == .completed, let fetchAnalysis {
            analysis.load(fetchAnalysis)
        }
    }

    /// The board's haptic moments (DESIGN.md §7), derived by the pure fold and
    /// rendered by the player. A frozen room browses silently (the finished
    /// board is an object, not a solve); the completion pattern rides the
    /// INV-3 gate, not this fold.
    private func observeHaptics() {
        guard store.status == .ongoing else { return }
        guard
            let haptic = hapticFold.observe(
                filled: filledCells, selection: model.selection, puzzle: puzzle)
        else { return }
        SolveHaptics.shared.play(haptic)
    }

    /// The store's participants as chrome-shaped data (the GridPresence pattern:
    /// the view maps, the types stay in their rings). Each member's live cursor
    /// (PROTOCOL.md §4, §9) rides along for the roster's Go to action; a
    /// spectator is never in `store.cursors` (client-side suppression, DESIGN.md
    /// §15), so `RosterList.canJump` needs no extra role check.
    private var rosterMembers: [RosterMember] {
        store.participants.map {
            RosterMember(
                userId: $0.userId,
                displayName: $0.displayName,
                wireColor: $0.color,
                avatarUrl: $0.avatarUrl,
                isHost: $0.role == .host,
                isSpectator: $0.role == .spectator,
                connected: $0.connected,
                cursor: store.cursors[$0.userId].map {
                    RosterCursor(cell: $0.cell, isAcross: $0.direction == .across)
                })
        }
    }

    /// Solo = the only connected host/solver (the electorate would be one), so the vote
    /// auto-passes and the Check control keeps the plain confirm (PROTOCOL.md §10, D32; Wave
    /// 15.5). Spectators never vote, so they never count toward multiplayer.
    private var isSoloRoom: Bool {
        store.participants.filter { $0.connected && $0.role != .spectator }.count <= 1
    }

    /// Cells rendering non-null (the INV-10 composite), for the browser's
    /// de-emphasis rule.
    private var filledCells: Set<Int> {
        Set((0..<puzzle.cellCount).filter { store.renderValue($0) != nil })
    }

    /// The entry ids the current clue cross-references, filtered to real rows and
    /// self-excluded (ClueBook.referencedIds, the web's LiveApp memo). One parse feeds
    /// both the browser's faint row wash and the board's referencedCells tint, so the
    /// two never disagree on what the current clue names. A pure function of the clue
    /// book and the selection, exactly like filledCells above it.
    private var referencedIds: Set<String> {
        clues.referencedIds(for: clues.current(for: model.selection))
    }

    /// The confetti's palette: the room's writers in their roster colors (the
    /// people are the only color, DESIGN.md §1), spectators lending none, mapped
    /// through the ground so both grounds drift in their own registers.
    /// Deterministically seeded, so the field is stable across the few renders
    /// it lives through.
    private var confettiField: ConfettiField {
        let colors = store.participants
            .filter { $0.role != .spectator }
            .map {
                ground.rosterColor(
                    GridPresence.rosterColor(wireColor: $0.color, userId: $0.userId))
            }
        return ConfettiField.make(colors: colors)
    }

    /// Teammates whose cursors sit under the bar's clue: presence marks (already
    /// filtered of self and spectators, colored for the ground) on the current
    /// word's cells, ordered for deterministic glint attribution.
    private var glintMarks: [PresenceMark] {
        let word = puzzle.wordCells(
            through: model.selection.cell, isAcross: model.selection.isAcross)
        guard !word.isEmpty, !store.cursors.isEmpty else { return [] }
        let marks = GridPresence.marks(
            cursors: store.cursors.values.map {
                GridPresence.CursorInput(
                    userId: $0.userId, cell: $0.cell, isAcross: $0.direction == .across)
            },
            participants: store.participants.map {
                GridPresence.ParticipantInput(
                    userId: $0.userId, displayName: $0.displayName, color: $0.color,
                    isSpectator: $0.role == .spectator)
            },
            selfUserId: store.selfUserId,
            ground: ground)
        return word.sorted().flatMap { marks[$0] ?? [] }
    }

    /// The facts sheet, extracted so its initializer type-checks in reasonable time (the
    /// large-initializer split; the vote's soloRoom flag pushed the inline call over the
    /// solver's budget).
    private var factsSheet: some View {
        RoomFactsSheet(
            ground: ground,
            content: factsContent,
            operations: factsPanelOperations,
            // The headline Time is active time (owner ruling, D29): the stats
            // twin's preference rule, wall-clock fallback for frozen pre-D29 rows.
            solveTimeSeconds: store.stats?.headlineSolveSeconds,
            firstFillAt: store.firstFillAt,
            completedAt: store.completedAt ?? store.abandonedAt,
            // The confirm-time race resolves in layers (design R2): fullness re-derives from
            // SEQUENCED state at the propose tap — a teammate emptying a cell between render
            // and propose quietly falls back to the row, already disabled again — and a server
            // GRID_NOT_FULL / VOTE_PENDING stays quiet (§11 non-fatal). The send is the store's
            // intent (R1); the sheet closes so the vote or the marks land in view.
            onCheckPuzzle: {
                guard store.filledCount == puzzle.playableCellCount else { return }
                store.checkPuzzle()
                factsPresented = false
            },
            // The abandon's terminal transition dismisses the sheet through observeRoomState
            // anyway; closing here too keeps it prompt.
            onEndGame: {
                onEndGame()
                factsPresented = false
            },
            // Solo keeps the plain confirm; a multiplayer room proposes through the
            // hold-to-propose control, opening the vote for the room (PROTOCOL.md §10, D32;
            // Wave 15.5). Solo is the only connected host/solver (the electorate of one).
            soloRoom: isSoloRoom)
    }

    // MARK: - The check vote (PROTOCOL.md §10, D32; Wave 15.10)

    /// The card layer. A live multiplayer vote presents the blocking card over its scrim
    /// (never for a solo electorate); a viewer without a ballot may have put it away
    /// (`voteCardDismissed`; the wire has no vote-cancel, so the proposer and a non-elector
    /// are never held for the timebox), in which case the board stands and the resolution
    /// re-presents. After the close, `voteAct` plays: the in-card resolution for its ~2.5 s
    /// recess (scrim lifted — the room has answered, the board is already back), or the
    /// pass's condensed capsule ("Checking…", then "{n} to fix") above the clue bar while
    /// the wash owns the board (U6).
    @ViewBuilder private var checkVoteLayer: some View {
        Group {
            if let vote = store.checkVote, CheckVoteCardModel.shouldPresent(vote: vote),
                let model = checkVoteCardModel(vote), !voteCardDismissed
            {
                CheckVoteScrim(ground: ground) {
                    guard
                        CheckVoteCardPolicy.isDismissible(
                            role: model.viewerRole,
                            hasOpenBallot: model.showsVerbs(selfUserId: store.selfUserId))
                    else { return }
                    withAnimation(reduceMotion ? nil : .crossyChrome) {
                        voteCardDismissed = true
                    }
                }
                .transition(.opacity)
                CheckVoteCard(
                    model: model, selfUserId: store.selfUserId, ground: ground,
                    reduceMotion: reduceMotion, resolution: nil,
                    memberFor: checkVoteMember,
                    onApprove: {
                        store.castCheckVote(voteSeq: model.voteSeq, approve: true)
                        castBallotExit()
                    },
                    onReject: {
                        store.castCheckVote(voteSeq: model.voteSeq, approve: false)
                        castBallotExit()
                    },
                    onDismiss: {
                        withAnimation(reduceMotion ? nil : .crossyChrome) {
                            voteCardDismissed = true
                        }
                    })
                    .transition(voteCardTransition)
            } else if case .resolution(let resolution) = voteAct,
                let vote = voteMirror, let model = checkVoteCardModel(vote)
            {
                CheckVoteCard(
                    model: model, selfUserId: store.selfUserId, ground: ground,
                    reduceMotion: reduceMotion, resolution: resolution,
                    memberFor: checkVoteMember,
                    onApprove: {}, onReject: {}, onDismiss: {})
                    .allowsHitTesting(false)
                    .transition(voteCardTransition)
            } else if case .checking = voteAct {
                voteStatusCapsule(CheckVoteCopy.checking)
            } else if case .revealed(let count) = voteAct {
                voteStatusCapsule(CheckVoteCopy.toFix(count))
            }
        }
        // The card arrives on its own spring (a people surface, a whisper of life); every
        // act change settles on the chrome spring. Reduce Motion crossfades via the
        // transitions' opacity halves.
        .animation(
            reduceMotion ? nil : .checkVoteArrival,
            value: store.checkVote?.openedSeq)
        .animation(reduceMotion ? nil : .crossyChrome, value: voteAct)
        .animation(reduceMotion ? nil : .crossyChrome, value: voteCardDismissed)
    }

    private var voteCardTransition: AnyTransition {
        reduceMotion ? .opacity : .scale(scale: 0.94).combined(with: .opacity)
    }

    /// Is the blocking card up right now? (The open posture only; the inert resolution and
    /// the capsule never block.) Read by the fan so nothing floats over the scrim.
    private var voteCardStanding: Bool {
        store.checkVote != nil && CheckVoteCardModel.shouldPresent(vote: store.checkVote)
            && !voteCardDismissed
    }

    /// The pass's condensed voice: the capsule floats centered just above the clue bar's
    /// slot (the board is the star during the wash; the count is its caption, at the line
    /// the eye already reads). Withheld until the slot's frame is real.
    @ViewBuilder private func voteStatusCapsule(_ text: String) -> some View {
        if let slot = chromeFrames[.clueBarSlot] {
            CheckVoteStatusCapsule(text: text, ground: ground)
                .position(x: slot.midX, y: slot.minY - 32)
                .transition(.opacity)
        }
    }

    /// Casting a ballot is the exit (owner ruling 2026-07-18): the card withdraws with the
    /// ballot on the wire; the resolution re-presents when the room answers.
    private func castBallotExit() {
        withAnimation(reduceMotion ? nil : .crossyChrome) { voteCardDismissed = true }
    }

    private func checkVoteCardModel(_ vote: CheckVoteState) -> CheckVoteCardModel? {
        CheckVoteCardModel.make(vote: vote, selfUserId: store.selfUserId) { id in
            store.participants.first { $0.userId == id }?.displayName
        }
    }

    /// An elector's roster identity for the card's pucks (real avatars and colors). A
    /// departed member reads as the neutral "Player" — never a raw userId — colored by the
    /// id hash exactly as GridPresence colors an unknown cursor.
    private func checkVoteMember(_ userId: String) -> RosterMember {
        rosterMembers.first { $0.userId == userId }
            ?? RosterMember(
                userId: userId, displayName: CheckVoteCopy.fallbackElector, wireColor: "",
                avatarUrl: nil, isHost: false, isSpectator: false, connected: true)
    }

    /// Post a polite VoiceOver announcement for a vote beat (U10). The strings are pinned
    /// pure (CheckVoteAnnouncement); only the posting lives here.
    private func announceVote(_ line: String) {
        #if os(iOS)
            AccessibilityNotification.Announcement(line).post()
        #endif
    }

    /// Wire the vote beats (PROTOCOL.md §6, §10; D32) to the card, the haptics (U9), and the
    /// VoiceOver announcements (U10). Fired only under the store's §7 seq gate, so snapshot
    /// healing stays silent; solo votes are skipped entirely (no chrome, no beat).
    private func wireCheckVoteBeats() {
        store.onCheckVoteOpened = { _ in
            guard let vote = store.checkVote, !vote.isSolo else { return }
            voteActToken += 1  // a fresh question supersedes any standing recess
            withAnimation(reduceMotion ? nil : .checkVoteArrival) {
                voteAct = .none
                voteCardDismissed = false
            }
            // The vote wins the stage (the collision ruling): the facts sheet and an open
            // clue browser yield, so a pending vote is never invisible. Other transients
            // (the fan) yield through the same seam.
            dismissTransients()
            chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
            SolveHaptics.shared.play(.checkVoteOpened)  // one firm impact: the floor is called
            if let model = checkVoteCardModel(vote) {
                announceVote(CheckVoteAnnouncement.opened(model: model))
            }
        }
        store.onCheckVoteCast = { _ in
            guard store.checkVote != nil else { return }
            SolveHaptics.shared.play(.checkVoteBallot)  // the division counts, one light tick
        }
        store.onCheckVoteClosed = { msg in
            // The store cleared `checkVote` already; read the pre-close vote from the mirror
            // (seeded on appear, so a rejoin mid-vote resolves cleanly too).
            guard let vote = voteMirror, !vote.isSolo, let model = checkVoteCardModel(vote)
            else {
                voteAct = .none
                return
            }
            let token = voteActToken + 1
            voteActToken = token
            let act = CheckVoteCloseAct.forClose(
                outcome: msg.outcome, reason: msg.reason, viewerRole: model.viewerRole,
                approvals: vote.approvals.count, needed: vote.needed)
            switch act {
            case .none:
                // Terminal: the card vanishes silently (completion/abandon supersedes, U1).
                withAnimation(reduceMotion ? nil : .crossyChrome) { voteAct = .none }
            case .checking:
                // The pass: the card condenses to "Checking…" and yields the board to the
                // breath and the wash (onPuzzleChecked). The success haptic fires there,
                // timed to the wash (U6), never here.
                withAnimation(reduceMotion ? nil : .crossyChrome) { voteAct = .checking }
                announceVote(CheckVoteCopy.checking)
                // A pass close is always followed by puzzleChecked at the next seq; if a
                // drop swallows it, the capsule still stands down.
                scheduleActWithdraw(token: token, after: 5000)
            case .resolution(let resolution):
                // The recess (U7): two soft taps, the one calm line (plus the proposer's
                // tally) stands ~2.5 s in the card, then it withdraws.
                if let haptic = CheckVoteHaptics.forClose(
                    outcome: msg.outcome, reason: msg.reason)
                {
                    SolveHaptics.shared.play(haptic)
                }
                withAnimation(reduceMotion ? nil : .crossyChrome) { voteAct = act }
                announceVote(CheckVoteAnnouncement.closed(resolution))
                scheduleActWithdraw(token: token, after: 2500)
            case .revealed:
                break  // never staged by a close
            }
        }
        // The check landing (PROTOCOL.md §6, §10; D32). A vote pass (the capsule holds
        // "Checking…") runs the U6 ceremony: the just-applied coats hide, one deliberate
        // ~600 ms breath, then they wash in ascending cell order (< 900 ms) with the success
        // haptic timed to the wash start, and "{n} to fix" lands LAST, after the wash
        // settles. A solo pass and a bare rollout check are instant: the quiet checkLanded
        // thud (Wave 15.10 fix: the fanfare belongs only to a vote that really stood), no
        // wash, no chrome.
        store.onPuzzleChecked = { msg in
            guard case .checking = voteAct else {
                SolveHaptics.shared.play(
                    CheckVoteHaptics.forPuzzleChecked(
                        attributed: msg.by != nil, voteStood: false))
                return
            }
            let count = msg.wrongCells.count
            let token = voteActToken + 1
            voteActToken = token
            guard !reduceMotion else {
                // Reduce Motion: no breath, no wash. The coats are already at full opacity
                // (checkWashStartedAt stays nil); land the count and the success now.
                SolveHaptics.shared.play(.checkVotePassed)
                voteAct = .revealed(count)
                announceVote(CheckVoteAnnouncement.toFix(count))
                scheduleActWithdraw(token: token, after: 2500)
                return
            }
            // Hide the coats now (a future start makes every reveal 0 during the breath),
            // then wash them in.
            let breathMilliseconds = 600
            let start = Date().timeIntervalSinceReferenceDate + Double(breathMilliseconds) / 1000
            checkWashStartedAt = start
            let washToken = checkWashToken + 1
            checkWashToken = washToken
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(breathMilliseconds))
                SolveHaptics.shared.play(.checkVotePassed)  // timed to the wash start
                // Retire the wash once it finishes (< 900 ms), re-pausing the grid
                // timeline, then land the count last (U6).
                try? await Task.sleep(for: .milliseconds(950))
                if checkWashToken == washToken { checkWashStartedAt = nil }
                guard voteActToken == token else { return }
                withAnimation(.crossyChrome) { voteAct = .revealed(count) }
                announceVote(CheckVoteAnnouncement.toFix(count))
                scheduleActWithdraw(token: token, after: 2500)
            }
        }
    }

    /// Withdraw the standing act after its beat, unless a newer vote or act superseded it
    /// (the token guards against a fresh proposal landing during the withdrawal).
    private func scheduleActWithdraw(token: Int, after milliseconds: Int) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(milliseconds))
            guard voteActToken == token else { return }
            withAnimation(reduceMotion ? nil : .crossyChrome) { voteAct = .none }
        }
    }

    // MARK: - Morph geometry

    /// The melt: rest is the bar's layout slot; open grows the top edge to just
    /// under the room bar, bottom edge anchored, so the surface never overlaps
    /// the deck or the room bar (glass never stacks, DESIGN.md §4).
    private var meltMorph: GlassMorph? {
        let f = chromeFrames
        guard let rest = f[.clueBarSlot], let roomBar = f[.roomBar],
            rest.height > 0
        else { return nil }
        let top = roomBar.maxY + ChromeLayout.panelTopGap
        guard rest.maxY > top else { return nil }

        // A completed room opens the melt as a bottom sheet (owner ask
        // 2026-07-13): the deck is retired, so the surface pours to the phone's
        // true edges (full width, past the bottom safe area) with its top corners
        // only, the door capsule unfolding into a sheet. Mid-solve it stays the
        // inset card that clears the live deck (glass never stacks, ID-4), so the
        // sheet geometry is gated on `.completed` and borrows the full-bleed
        // container frame the room reports for exactly this.
        if roomStatus == .completed, let container = f[.roomContainer] {
            // container is the room's SAFE-AREA rect, so bleed the panel past its
            // bottom by more than any home-indicator inset; the display's own
            // corners clip the overrun, leaving the glass flush to the phone's
            // true edge with its square bottom corners hidden below it.
            let open = CGRect(
                x: container.minX, y: top,
                width: container.width,
                height: container.maxY + ChromeLayout.sheetBottomBleed - top)
            return GlassMorph(
                rest: rest,
                open: open,
                restCornerRadius: rest.height / 2,
                openCornerRadius: ChromeLayout.sheetTopCornerRadius)
        }

        return GlassMorph(
            rest: rest,
            open: CGRect(x: rest.minX, y: top, width: rest.width, height: rest.maxY - top),
            // Half the slot's height, not the bar constant: a wrapped clue
            // grows the bar and the capsule register holds (DESIGN.md §5).
            restCornerRadius: rest.height / 2,
            openCornerRadius: ChromeLayout.panelCornerRadius)
    }

    // MARK: - Intents

    /// The one dismissal seam (DESIGN.md §4: transient surfaces yield to
    /// intent). It dismisses the facts sheet, so every outside surface routes
    /// here before its own action; in practice the sheet dims the room and
    /// dismisses itself on an outside touch, so this only closes it for the
    /// callers that act without a preceding touch (a swipe, a jump). The melt is
    /// not a tap-away transient (a gesture owns it): it pours back only when
    /// another surface opens or the room turns terminal.
    private func dismissTransients() {
        factsPresented = false
        // A standing (tap-opened) fan yields to intent like any transient (DESIGN.md
        // §4): the touch closes it AND lands. The fan's own surface never routes
        // here (its overlay stands outside the chrome's dismiss gestures).
        withAnimation(reduceMotion ? nil : .crossyChrome) { fan.tapAway() }
    }

    /// The facts sheet's summon (2026-07-12: the pill's tap presents
    /// RoomFactsSheet). A mid-solve surface only: a tap on a sealed terminal
    /// pill does nothing (owner ruling: not at game end). The drag-scrubbed melt
    /// pours back first (SP-i1) so the two surfaces never stand together.
    private func openFacts() {
        guard roomStatus == .ongoing else { return }
        chrome.pourBackMeltUnlessDragging(animated: !reduceMotion)
        factsPresented = true
    }

    /// The cursor relay (deferred from I2b): every selection change goes to the
    /// room, throttled to the wire's 10/s cap with a leading send and one
    /// coalesced trailing send that always carries the latest position (the web's
    /// posture, PROTOCOL.md §9). Spectators never send (their cursors are
    /// suppressed by default, root DESIGN.md §15); the store refuses sends while
    /// `connecting`.
    private func relayCursor(_ selection: GridSelection, spectating: Bool) {
        if spectating { return }
        switch relay.selectionChanged(now: Date.now.timeIntervalSinceReferenceDate) {
        case .send:
            sendCursor(selection)
        case .scheduleTrailing(let afterSeconds):
            relayTrailing = Task { @MainActor in
                try? await Task.sleep(for: .seconds(afterSeconds))
                guard !Task.isCancelled else { return }
                relay.trailingFired(now: Date.now.timeIntervalSinceReferenceDate)
                sendCursor(model.selection)
            }
        case .coalesce:
            break
        }
    }

    private func sendCursor(_ selection: GridSelection) {
        store.moveCursor(
            cell: selection.cell, direction: selection.isAcross ? .across : .down)
    }

    // MARK: - Reactions (Wave 7.5; PROTOCOL.md §9, D24)

    /// The fan fired: send-gate on the fan's own slots (§9: only sending is gated,
    /// and the fan wears the personal set, D25) plus the emoji-shape rule the wire
    /// gate applies, so an out-of-set or malformed grapheme never leaves the client.
    /// Then echo locally through the model (which owns the 5/s cap) and put the frame
    /// on the wire at the CURSOR cell — the reaction is anchored where you stand. A
    /// capped attempt sends nothing anywhere. Spectators react by design (§9), so
    /// unlike the cursor relay nothing here checks the seat.
    private func fireReaction(_ emoji: String) {
        guard fan.emojis.contains(emoji), ReactionSetSpec.isReactionEmoji(emoji) else { return }
        let cell = model.selection.cell
        guard
            reactions.send(
                userId: store.selfUserId ?? "you", emoji: emoji, cell: cell,
                at: Date().timeIntervalSinceReferenceDate)
        else { return }
        store.react(emoji: emoji, cell: cell)
        SolveHaptics.shared.play(.reactionSent)
    }

    /// Inbound reactions land here (GameStore.onReaction, the onConflictFlash
    /// pattern): render any well-formed emoji (receive-any, §9) whose cell exists on
    /// this grid, and tap softly when it lands on or beside the active word (the
    /// proximity gate; toggleable, default on). Re-wired on a puzzle change because
    /// the closure captures the grid it validates against (the live room retargets
    /// from the 1x1 stand-in when REST lands).
    private func wireReactionSink() {
        let puzzle = self.puzzle
        store.onReaction = { notice in
            guard notice.cell >= 0, notice.cell < puzzle.cellCount,
                !puzzle.blocks.contains(notice.cell)
            else { return }
            reactions.receive(
                userId: notice.userId, emoji: notice.emoji, cell: notice.cell,
                at: Date().timeIntervalSinceReferenceDate)
            if ReactionSettings.receiveHapticsEnabled,
                ReactionProximity.landsNearActiveWord(
                    cell: notice.cell, selection: model.selection, puzzle: puzzle)
            {
                SolveHaptics.shared.play(.reactionLanded)
            }
        }
    }

    // MARK: - The deck zone

    /// The deck over solid canvas (ID-4), the rebus inline field surfacing above it
    /// while an entry is open (EXPERIENCE.md baseline; the exhale bubble is I4).
    private var deckZone: some View {
        VStack(spacing: 10) {
            if let buffer = model.rebusBuffer {
                RebusField(buffer: buffer, ground: ground)
            }
            KeyDeck(ground: ground, isRebusActive: model.isRebusActive) { key in
                // A press is intent (DESIGN.md §4): panels yield at touch-down
                // (the deck presses on first contact), the letter still lands.
                dismissTransients()
                model.press(key)
            }
        }
        .padding(.horizontal, ChromeLayout.inset)
        .padding(.top, 10)
        // The deck's lift off the bottom safe-area line (owner on-device ruling):
        // the original tight gap read bottom-stuck on the tall Max screen, so the
        // keys rise off the home indicator.
        .padding(.bottom, 30)
        .background(Color(rgb: ground.tokens.canvas))
        .animation(
            .spring(
                response: Motion.Springs.chromeResponse,
                dampingFraction: Motion.Springs.chromeDampingFraction),
            value: model.isRebusActive)
    }

    /// The abandoned room (EXPERIENCE.md: terminal and quiet): the board freezes
    /// with a one-line notice, nothing else. Browsing stays live above.
    private var abandonedZone: some View {
        Text(verbatim: RoomTerminal.abandonedNotice)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .frame(maxWidth: .infinity)
            .padding(.top, 16)
            .padding(.bottom, 18)
            .background(Color(rgb: ground.tokens.canvas))
    }

    /// The spectator edge (EXPERIENCE.md Watching): the full live room, read-only,
    /// one affordance. The deck leaves; the words are plain (ID-5).
    private var watchingZone: some View {
        VStack(spacing: 10) {
            Text(verbatim: "Watching")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color(rgb: ground.tokens.number))
            Button(action: onJoinIn) {
                Text(verbatim: "Join in")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .modifier(ChromeGlassSurface(cornerRadius: 23))
        }
        .padding(.horizontal, ChromeLayout.inset)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(Color(rgb: ground.tokens.canvas))
    }
}

// MARK: - The feather

/// The feather: the clue bar floats over live cells now (the full-bleed
/// ruling, owner ask 2026-07-10), so the ground's canvas washes up from the
/// board's bottom edge, full strength behind the glass and fading to nothing
/// over ClueFeather.extent above it. No hard edge anywhere; Studio and
/// Observatory differ only by token (ID-3). Inert to touch: cells under the
/// feather still take taps.
@available(iOS 17.0, macOS 14.0, *)
struct ClueFeatherWash: View {
    let ground: GridGround

    var body: some View {
        let canvas = Color(rgb: ground.tokens.canvas)
        VStack(spacing: 0) {
            LinearGradient(
                stops: [
                    .init(color: canvas.opacity(0), location: 0),
                    .init(
                        color: canvas.opacity(ClueFeather.kneeAlpha),
                        location: ClueFeather.kneeLocation),
                    .init(color: canvas.opacity(ClueFeather.barAlpha), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
            .frame(height: ClueFeather.extent)
            canvas.opacity(ClueFeather.barAlpha)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - The rebus inline field

/// The baseline rebus entry (EXPERIENCE.md §6: a plain inline field qualifies): the
/// buffer as it grows, committed as one value by the deck's rebus key. Clear glass,
/// the momentary register (DESIGN.md §4), with the §4 blur fallback below iOS 26.
/// Chrome stays achromatic (DESIGN.md §3), so the caret is ink.
@MainActor
struct RebusField: View {
    let buffer: String
    let ground: GridGround

    var body: some View {
        HStack(spacing: 3) {
            if buffer.isEmpty {
                Text(verbatim: "Rebus")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            } else {
                Text(verbatim: buffer)
                    .font(.system(size: 17, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
            }
            RoundedRectangle(cornerRadius: 1)
                .fill(Color(rgb: ground.tokens.ink))
                .frame(width: 2, height: 18)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .modifier(RebusSurface())
        .accessibilityLabel(
            Text(verbatim: buffer.isEmpty ? "Rebus entry" : "Rebus entry \(buffer)"))
    }
}

/// Clear glass on iOS 26+; the one blur-material fallback below (DESIGN.md §4).
private struct RebusSurface: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content.glassEffect(.clear, in: .capsule)
            } else {
                content.background(Capsule().fill(.regularMaterial))
            }
        #else
            content.background(Capsule().fill(.regularMaterial))
        #endif
    }
}
