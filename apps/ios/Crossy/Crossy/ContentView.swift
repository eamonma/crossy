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

import CrossyStore
import CrossyUI
import SwiftUI
import UIKit

struct ContentView: View {
    init() {
        // The facts card's morph character (PillInflation). The shipping
        // default is metaball on iOS 26+ (owner ruling 2026-07-11: the
        // system's materialize swap inside a GlassEffectContainer, falling
        // back to the clean frame-interpolation walk below 26). -gooClean and
        // -gooOvershoot override it for reference/regression; -gooMetaball is
        // the default and stays reachable as an explicit no-op.
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-gooClean") {
            PillInflation.character = .clean
        } else if arguments.contains("-gooOvershoot") {
            PillInflation.character = .overshoot
        } else if arguments.contains("-gooMetaball") {
            PillInflation.character = .metaball
        }
    }

    var body: some View {
        // The glassEffectID recheck rig (MorphLab.swift): evidence only.
        if ProcessInfo.processInfo.arguments.contains("-morphLab") {
            MorphLab()
        } else if ProcessInfo.processInfo.arguments.contains("-meltLab") {
            // The scrubbed melt's recheck rig (MeltLab.swift): evidence only.
            MeltLab()
        } else if ProcessInfo.processInfo.arguments.contains("-islandLab") {
            // The island rendering rig (IslandLab.swift): a real Live Activity stepped
            // from the foreground, no APNs. Evidence only.
            IslandLab()
        } else if let config = RoomConfig.resolve() {
            RealRoomView(room: RealRoom(config: config))
        } else if wantsDemoRoom {
            DemoRoomView()
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
            onKick: { _ in }
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
/// initializer), so this view withholds `SolveScreen` entirely rather than paint it: a
/// board built from the stand-in would show the wrong dimensions for one frame and
/// then reflow the instant `ready` flips, which is the bug I3f closes. `RoomOpening`
/// fills the same screen with no board at all until then (mirrors the web loading
/// shell, apps/web/src/LiveApp.tsx's `LoadingGameShell`: nothing renders at the wrong
/// size, ever). A fatal wiring failure reads plainly instead of a blank room. `onBack`
/// is the bar's back button and `onExit` the kicked terminal's way home (both pop to
/// Rooms); the harness composition has nowhere to pop to and keeps the default no-ops.
@available(iOS 18.0, *)
struct RealRoomView: View {
    @State private var room: RealRoom
    private let onBack: () -> Void
    private let onExit: () -> Void
    @State private var ready = false
    @State private var shareURL: URL?
    /// One avatar cache shared by the room's live pucks and the island snapshot, so the
    /// island writes the very images the room already resolved (no second fetch).
    @State private var avatarCache = AvatarImageCache()
    @Environment(\.colorScheme) private var colorScheme

    init(
        room: RealRoom,
        onBack: @escaping () -> Void = {},
        onExit: @escaping () -> Void = {}
    ) {
        _room = State(initialValue: room)
        self.onBack = onBack
        self.onExit = onExit
    }

    var body: some View {
        Group {
            if let fatal = room.fatal {
                RoomOpenFailure(message: fatal, dark: colorScheme == .dark)
            } else if !ready {
                RoomOpening(dark: colorScheme == .dark)
            } else {
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
                    onKick: { userId in room.kick(userId: userId) }
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
    }
}

/// The pre-REST instant (I3f): no board, because no true geometry exists yet. A quiet
/// canvas rather than a spinner, in the same two grounds every other terminal surface
/// uses (`RoomOpenFailure` next door); it holds the screen for at most one REST round
/// trip, so it never needs to say anything.
private struct RoomOpening: View {
    let dark: Bool

    var body: some View {
        (dark
            ? Color(red: 0.07, green: 0.067, blue: 0.094)
            : Color(red: 0.949, green: 0.945, blue: 0.925))
            .ignoresSafeArea()
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
}
