//
//  ContentView.swift
//  Crossy
//
//  The app's root, routed by launch configuration (roadmap I3):
//
//    CROSSY_IT_* with a game id  straight into RealRoom against that stack (the I1e
//                                harness pattern; unchanged from I2)
//    any -i2* script or -demoRoom  DemoRoom, the loopback fixture (the fresh-clone
//                                demo path, exactly as before)
//    otherwise                   the arrival journey (EXPERIENCE.md §2): Welcome →
//                                sign in → Rooms → tap a room → the live solve.
//                                -i3Fixture walks it with no network and no key.
//
//  Ground follows system appearance inside every screen (ID-3).
//

import CrossyDesign
import CrossyProtocol
import CrossyStore
import CrossyUI
import SwiftUI
import UIKit

struct ContentView: View {
    var body: some View {
        // The glassEffectID recheck rig (MorphLab.swift): evidence only.
        if ProcessInfo.processInfo.arguments.contains("-morphLab") {
            MorphLab()
        } else if ProcessInfo.processInfo.arguments.contains("-reactionLab") {
            // The reaction sticker/fan rig (ReactionLab.swift, Wave 7.5): the
            // motion review surface for stickers, piles, the coalesce pulse, the
            // settle-boundary proof, and the fan. Evidence only.
            ReactionLab()
        } else if ProcessInfo.processInfo.arguments.contains("-meltLab") {
            // The scrubbed melt's recheck rig (MeltLab.swift): evidence only.
            MeltLab()
        } else if ProcessInfo.processInfo.arguments.contains("-islandLab") {
            // The island rendering rig (IslandLab.swift): a real Live Activity stepped
            // from the foreground, no APNs. Evidence only.
            IslandLab()
        } else if ProcessInfo.processInfo.arguments.contains("-pillArrivalLab") {
            // The constant-built board inset's live-timing rig (PillArrivalLab.swift,
            // DESIGN.md §2, SLICE C): delays the board and the welcome, pins the grid's
            // first-frame top against the live top so a capture proves the board never
            // moved when the pill arrived. Evidence only.
            PillArrivalLab()
        } else if ProcessInfo.processInfo.arguments.contains("-seededBirthLab") {
            // The seeded-birth rig (SeededBirthLab.swift, DESIGN.md §4, §12): stands the
            // withholding room's seeded bar (back + identity-true players + share, the
            // guest-spectator filtered, the timer welcome-gated), so the seeded frame
            // the live goo grows from is capturable offline. Evidence only.
            SeededBirthLab()
        } else if ProcessInfo.processInfo.arguments.contains("-analysisTabsLab") {
            // The Liquid Glass Clues/Analysis tab control in isolation
            // (AnalysisTabsLab), both grounds over a busy field: evidence only.
            AnalysisTabsLab()
        } else if let config = RoomConfig.resolve() {
            // The room's top chrome is the system nav bar's items now (the
            // toolbar-adoption ruling, DESIGN.md §4), and toolbar items render
            // only inside a navigation container: the standalone compositions
            // wrap in a stack wearing the same bar chrome as the pushed room,
            // so the harness and the evidence rigs keep the whole chrome.
            // Nothing pushes here; back keeps its standalone no-op.
            NavigationStack {
                RealRoomView(room: RealRoom(config: config))
                    .modifier(RoomNavBarChrome())
            }
        } else if wantsDemoRoom {
            NavigationStack {
                DemoRoomView()
                    .modifier(RoomNavBarChrome())
            }
        } else {
            ArrivalRootView()
        }
    }

    /// The demo fixture's triggers: its own flag, or any of the -i2* scripts that
    /// have always implied it (a scheme invocation from the I2 waves keeps landing
    /// exactly where it used to).
    private var wantsDemoRoom: Bool {
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.contains("-demoRoom")
            || arguments.contains { $0.hasPrefix("-i2") }
    }

    /// The reaction fan's placement (Wave 7.5, revised 2026-07-14: the owner leaned
    /// detached, so floating is the default and the in-bar corner is the flagged
    /// variant). One read for the demo room and the live one, so the A/B never
    /// diverges between them.
    static var reactionFanPlacement: ReactionFanPlacement {
        ProcessInfo.processInfo.arguments.contains("-reactionFanClueBarCorner")
            ? .clueBarCorner : .floating
    }
}

/// The offline fixture room (DemoRoom): a typeable board with no network.
/// `onBack` pops home when the arrival flow composes this room (-i3Fixture);
/// the standalone -i2* launches have nowhere to go and keep the no-op.
struct DemoRoomView: View {
    @State private var room = DemoRoom()
    /// One avatar cache shared by the room's live pucks and the island snapshot, so the
    /// island writes the very images the room already resolved (no second fetch).
    @State private var avatarCache = AvatarImageCache()
    @State private var shareURL: URL?
    /// The personal reaction set the fan wears (D25): the arrival flow passes the
    /// model's shared store so a Settings edit reaches this room live; the standalone
    /// -i2*/-demoRoom rigs pass none and the fallback below still reads the cached
    /// five off the shared UserDefaults, so every composition wears the person's set.
    var reactionSets: ReactionSetStore?
    @State private var fallbackReactionSets = ReactionSetStore()
    var onBack: () -> Void = {}

    var body: some View {
        SolveScreen(
            store: room.store,
            puzzle: room.puzzle,
            clues: room.clues,
            roomName: room.roomName,
            puzzleTitle: room.puzzleTitle,
            puzzleAuthor: room.puzzleAuthor,
            puzzleDate: room.puzzleDate,
            inviteCode: room.inviteCode,
            // The fixture's shareable link: the share pill, its menu, and its
            // QR sheet all render offline over the same URL a live room would
            // build (ShareInvite.url), so the whole surface is judgeable with
            // no network.
            shareUrl: ShareInvite.url(
                gameId: room.gameId, code: room.inviteCode),
            model: room.selection,
            chrome: room.chrome,
            avatarCache: avatarCache,
            onBack: onBack,
            // Copy link is real even offline (it writes only to the local
            // pasteboard; no network, no REST): the share menu's primary row
            // is device-judgeable over the fixture URL.
            onCopyShareLink: {
                if let url = ShareInvite.url(
                    gameId: room.gameId, code: room.inviteCode)
                {
                    UIPasteboard.general.string = url.absoluteString
                }
            },
            // The share sheet itself is real (it writes nothing; PROTOCOL.md
            // has no bearing on it), so the demo presents it exactly as a
            // live room would, over the fixture URL: the tertiary channel is
            // device-judgeable offline.
            onShareInvite: {
                shareURL = ShareInvite.url(
                    gameId: room.gameId, code: room.inviteCode)
            },
            onEndGame: {},
            onKick: { _ in },
            // The Wave 7.5 placement pick (owner lean 2026-07-14): floating by
            // default, the in-bar corner behind -reactionFanClueBarCorner.
            reactionFanPlacement: ContentView.reactionFanPlacement,
            // The personal five (D25): the shared store when the arrival flow
            // composes this room, else the cache-backed fallback.
            reactionSets: reactionSets ?? fallbackReactionSets
        )
        // The island (I5a): starts on backgrounding an ongoing room, per the
        // policy the composition root feeds (SolveActivityController). `total` is
        // the puzzle's playable-cell count, so the born-live first frame carries the
        // room's real progress (§12a).
        .solveActivity(
            store: room.store, chrome: room.chrome, roomName: room.roomName,
            total: room.puzzle.playableCellCount, avatarCache: avatarCache)
        .shareInviteSheet(url: $shareURL)
        .task { await room.run() }
    }
}

/// The live-stack room (RealRoom): REST fetch then the real socket. Before the REST
/// view lands, `room.puzzle` is a 1x1 stand-in that carries no true geometry (RealRoom
/// initializer), so SolveScreen mounts with its board WITHHELD (`opening`): a board
/// built from the stand-in would show the wrong dimensions for one frame and then
/// reflow, the bug I3f closes (mirrors the web loading shell, apps/web/src/LiveApp.tsx's
/// `LoadingGameShell`: nothing renders at the wrong size, ever). The screen itself is
/// never swapped: ONE SolveScreen, one toolbar host, from the push's first frame to the
/// room's last (the mid-transition paint finding, DESIGN.md §4). A fatal wiring failure
/// reads plainly instead of a blank room. `onBack` is the bar's back button and `onExit`
/// the kicked terminal's way home (both pop to Rooms); the harness composition has
/// nowhere to pop to and keeps the default no-ops.
@available(iOS 18.0, *)
struct RealRoomView: View {
    @State private var room: RealRoom
    private let onBack: () -> Void
    private let onExit: () -> Void
    @State private var ready = false
    /// The push's settle beat (the mid-transition paint finding, DESIGN.md §4): bar
    /// item content hosted or re-hosted while the zoom push is in flight is measured
    /// but never composited — the capsules stand hollow until the next whole-bar
    /// rebuild (the owner's "empty pills", both eras) — and even a settled host SWAP
    /// blanks every item for a beat (the owner's flash). The room therefore mounts
    /// ONE SolveScreen with the push (one toolbar host for the room's whole life)
    /// and freezes the bar's ITEM SET (SolveScreen.barSettled) until the transition
    /// is over, so the timer only ever inserts into a settled, standing bar. The
    /// BOARD does not wait for this beat: our own hierarchy paints fine mid-flight
    /// (only bar content goes hollow), so the room's content arrives at `ready`.
    @State private var pushSettled = false
    @State private var shareURL: URL?
    /// One avatar cache shared by the room's live pucks and the island snapshot, so the
    /// island writes the very images the room already resolved (no second fetch).
    @State private var avatarCache = AvatarImageCache()
    /// The personal reaction set the fan wears (D25): the arrival flow passes the
    /// model's shared store, so a Settings edit reaches this room live; the harness
    /// composition passes none and the fallback still reads the cached five.
    private let reactionSets: ReactionSetStore?
    @State private var fallbackReactionSets = ReactionSetStore()
    @Environment(\.colorScheme) private var colorScheme

    init(
        room: RealRoom,
        reactionSets: ReactionSetStore? = nil,
        onBack: @escaping () -> Void = {},
        onExit: @escaping () -> Void = {}
    ) {
        _room = State(initialValue: room)
        self.reactionSets = reactionSets
        self.onBack = onBack
        self.onExit = onExit
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    /// The FAILURE screen's seeded trailing cluster (the seeded-birth rule, DESIGN.md
    /// §4, §12), or nil when the room was not born with a seed (a deep link or a
    /// code-join), which keeps that bar back-only. The live path no longer uses the
    /// opening host (one SolveScreen owns the bar for the room's whole life; the
    /// mid-transition paint finding): this seed dresses only the room-cannot-open
    /// screen, so the goo still has something identity-true to land on. Built from
    /// the SEEDED
    /// store: `room.store.participants` are the card's members (seeded at construction,
    /// still standing pre-welcome), mapped to RosterMember through the SAME field map
    /// SolveScreen and the island use, so the withholding pill renders through the exact
    /// same RosterMenu → RosterList.cluster path the live pill uses (solvers-only, so a
    /// seeded spectator seeds the store but never widens the pill). The share payload is
    /// built from the seeded invite code exactly as SolveScreen's is (ShareInvite.url),
    /// so the withholding share pill and the live one carry the same URL. The action
    /// closures match SolveScreen's (copy/share through ShareInvite, kick through the
    /// room); onJoinIn stays the SolveScreen default (the spectator seat-change is not
    /// wired in the live room yet).
    private var openingSeed: RoomOpeningSeed? {
        guard room.chrome.seeded else { return nil }
        let members = room.store.participants.map {
            RosterMember(
                userId: $0.userId, displayName: $0.displayName, wireColor: $0.color,
                avatarUrl: $0.avatarUrl,
                isHost: $0.role == .host, isSpectator: $0.role == .spectator,
                connected: $0.connected)
        }
        let shareUrl = ShareInvite.url(gameId: room.gameId, code: room.inviteCode)
        return RoomOpeningSeed(
            members: members,
            selfUserId: room.store.selfUserId,
            shareCode: room.inviteCode,
            shareUrlString: shareUrl?.absoluteString,
            onKick: { userId in room.kick(userId: userId) },
            onCopyShareLink: {
                if let shareUrl { UIPasteboard.general.string = shareUrl.absoluteString }
            },
            onShareInvite: { shareURL = shareUrl })
    }

    var body: some View {
        Group {
            if let fatal = room.fatal, pushSettled {
                // The failure branch keeps a way out (DESIGN.md §4, the live-data birth
                // rule): OUR back button stands so a room that cannot open is never a
                // dead end. A seeded room stands its identity-true players and share
                // pills here too (the goo has something to land on even when the room
                // then fails); the timer stays welcome-gated, so it never appears.
                RoomOpenFailure(message: fatal, dark: colorScheme == .dark)
                    .modifier(
                        RoomOpeningToolbarHost(
                            ground: ground, seed: openingSeed, onBack: onBack))
            } else {
                // The bar is born with the push and hosted exactly once (DESIGN.md
                // §4, the live-data birth rule + the mid-transition paint finding):
                // SolveScreen mounts here from the push's first frame, its board
                // withheld until the REST geometry lands AND the zoom settles, its
                // bar's item set frozen until the settle beat. OUR back button (and,
                // seeded, the identity-true players and share pills) stand from
                // frame one so the #132 zoom push goos them in place; the timer and
                // the board arrive together against the settled, standing bar, so
                // no capsule is ever hosted mid-flight (hollow) or re-hosted (the
                // flash).
                SolveScreen(
                    store: room.store,
                    puzzle: room.puzzle,
                    clues: room.clues,
                    roomName: room.roomName,
                    inviteCode: room.inviteCode,
                    // The composition root owns the game id, so it builds the
                    // link (ShareInvite.url): the same URL the share menu's QR
                    // sheet encodes, the Copy link row writes, and the sheet
                    // sends.
                    shareUrl: ShareInvite.url(
                        gameId: room.gameId, code: room.inviteCode),
                    model: room.selection,
                    chrome: room.chrome,
                    avatarCache: avatarCache,
                    // The board is OUR hierarchy: it paints fine mid-transition
                    // (only BAR content hosted mid-flight goes hollow), so the
                    // grid, clue bar, and deck arrive the instant the geometry
                    // does — on a fast wire that is inside the zoom itself, the
                    // old immediacy — while the bar's item set alone waits out
                    // the settle beat.
                    opening: !ready,
                    barSettled: pushSettled,
                    // The live socket carries checkPuzzle (PROTOCOL.md §5), so the
                    // facts sheet grows its check row here — and only here (design
                    // R8: the demo's loopback drops the command and keeps the
                    // default false, so the demo never offers a dead act).
                    supportsRoomCheck: true,
                    onBack: onBack,
                    onExit: onExit,
                    // The pasteboard write is the composition root's (CrossyUI
                    // stays UIKit-free); abandon rides the REST client through
                    // RealRoom (PROTOCOL.md §12). Copy link now owns invite
                    // copying (owner ruling 2026-07-11: the facts card's
                    // copy-code row retired for the share menu).
                    onCopyShareLink: {
                        if let url = ShareInvite.url(
                            gameId: room.gameId, code: room.inviteCode)
                        {
                            UIPasteboard.general.string = url.absoluteString
                        }
                    },
                    // Same seam, same reasoning: the composition root owns
                    // UIActivityViewController (ShareSheet.swift) so CrossyUI
                    // stays UIKit-free. The URL is the same one the QR
                    // encodes, never re-derived differently.
                    onShareInvite: {
                        shareURL = ShareInvite.url(
                            gameId: room.gameId, code: room.inviteCode)
                    },
                    onEndGame: { room.endGame() },
                    onKick: { userId in room.kick(userId: userId) },
                    // The analysis fetch closes over the REST client and game id here
                    // (AD-2: CrossyUI stays out of the REST ring); the solve screen
                    // owns the when (completed) and the retries (owner ruling
                    // 2026-07-13).
                    fetchAnalysis: { await room.fetchAnalysis() },
                    // The Wave 7.5 placement pick, same flag as the demo room.
                    reactionFanPlacement: ContentView.reactionFanPlacement,
                    // The personal five (D25): the shared store when the arrival
                    // flow composes this room, else the cache-backed fallback.
                    reactionSets: reactionSets ?? fallbackReactionSets
                )
                // The island (I5a), same wiring as DemoRoom, plus the push-token
                // registration (§12a): the live room threads its game id and REST sink so
                // the server can drive the island. `total` is the puzzle's playable-cell
                // count for the born-live first frame (§12a). The offline fixture passes
                // no registration.
                .solveActivity(
                    store: room.store, chrome: room.chrome, roomName: room.roomName,
                    total: room.puzzle.playableCellCount,
                    registration: room.liveActivityRegistration,
                    avatarCache: avatarCache)
                .shareInviteSheet(url: $shareURL)
            }
        }
        .task {
            await room.run(onReady: { ready = true })
        }
        // The settle clock starts with the push (this view mounts when the zoom
        // begins). 0.8s clears the zoom's ~0.6s run with margin; a slow network
        // dominates it anyway (`ready` lands later), so only LAN-fast arrivals
        // actually wait, and what they wait for is a bar that paints.
        .task {
            try? await Task.sleep(nanoseconds: 800_000_000)
            pushSettled = true
        }
    }
}

/// The one honest sentence when a room cannot open (EXPERIENCE.md copy voice: say what
/// went wrong, no apology). A plain screen, not a modal.
private struct RoomOpenFailure: View {
    let message: String
    let dark: Bool

    var body: some View {
        ZStack {
            (dark
                ? Color(red: 0.07, green: 0.067, blue: 0.094)
                : Color(red: 0.949, green: 0.945, blue: 0.925))
                .ignoresSafeArea()
            Text(verbatim: message)
                .font(.system(size: 16, weight: .medium))
                .multilineTextAlignment(.center)
                .foregroundStyle(
                    dark
                        ? Color(red: 0.929, green: 0.918, blue: 0.886)
                        : Color(red: 0.114, green: 0.106, blue: 0.094))
                .padding(32)
        }
    }
}

#Preview {
    ContentView()
        .environment(PendingInvite())
        .environment(PendingMagicLink())
}
