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
    var body: some View {
        // The glassEffectID recheck rig (MorphLab.swift): evidence only.
        if ProcessInfo.processInfo.arguments.contains("-morphLab") {
            MorphLab()
        } else if ProcessInfo.processInfo.arguments.contains("-meltLab") {
            // The scrubbed melt's recheck rig (MeltLab.swift): evidence only.
            MeltLab()
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
            model: room.selection,
            chrome: room.chrome,
            onBack: onBack,
            // The offline fixture holds the operations to a no-op: no REST, no
            // pasteboard write worth making in a demo. The rows render so the
            // popover's composition and the roster's kick submenu are visible;
            // the actions do nothing.
            onCopyInviteCode: {},
            onEndGame: {},
            onKick: { _ in }
        )
        // The island (I5a): starts on backgrounding an ongoing room, per the
        // policy the composition root feeds (SolveActivityController).
        .solveActivity(store: room.store, chrome: room.chrome, roomName: room.roomName)
        .task { await room.run() }
    }
}

/// The live-stack room (RealRoom): REST fetch then the real socket. The view rebuilds
/// once the REST view lands (`ready` flips), so the placeholder geometry never renders
/// as playable truth (the store holds `connecting` until the welcome anyway). A fatal
/// wiring failure reads plainly instead of a blank room. `onBack` is the bar's
/// back button and `onExit` the kicked terminal's way home (both pop to Rooms);
/// the harness composition has nowhere to pop to and keeps the default no-ops.
@available(iOS 18.0, *)
struct RealRoomView: View {
    @State private var room: RealRoom
    private let onBack: () -> Void
    private let onExit: () -> Void
    @State private var ready = false
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
            } else {
                SolveScreen(
                    store: room.store,
                    puzzle: room.puzzle,
                    clues: room.clues,
                    roomName: room.roomName,
                    inviteCode: room.inviteCode,
                    model: room.selection,
                    chrome: room.chrome,
                    onBack: onBack,
                    onExit: onExit,
                    // The pasteboard write is the composition root's (CrossyUI
                    // stays UIKit-free); abandon rides the REST client through
                    // RealRoom (PROTOCOL.md §12).
                    onCopyInviteCode: {
                        if let code = room.inviteCode { UIPasteboard.general.string = code }
                    },
                    onEndGame: { room.endGame() },
                    onKick: { userId in room.kick(userId: userId) }
                )
                // The mapped geometry changes identity once the REST view lands, so the
                // SolveScreen's own @State (selection, chrome) reinitializes against the
                // real puzzle rather than the placeholder.
                .id(ready)
                // The island (I5a), same wiring as DemoRoom: the composition
                // stays, only the transport behind the store differs.
                .solveActivity(store: room.store, chrome: room.chrome, roomName: room.roomName)
            }
        }
        .task {
            await room.run(onReady: { ready = true })
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
}
