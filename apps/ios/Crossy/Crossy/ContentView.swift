//
//  ContentView.swift
//  Crossy
//
//  The app's root: the full room (SolveScreen, I2c chrome) over one of two
//  compositions, selected by launch/env configuration (RoomConfig). A fresh clone
//  with no configuration lands in DemoRoom (the loopback fixture, a typeable board
//  with no network), the launch-arg precedent. When the CROSSY_IT_* facts are present
//  (the I1e harness pattern), it lands in RealRoom against the live stack: real REST
//  puzzle fetch, real GameStore + SessionDriver + WebSocketTransport. Ground follows
//  system appearance inside SolveScreen (ID-3). I3 swaps only RealRoom's token source
//  and base URLs; the composition stays.
//

import CrossyUI
import SwiftUI

struct ContentView: View {
    var body: some View {
        if let config = RoomConfig.resolve() {
            RealRoomView(config: config)
        } else {
            DemoRoomView()
        }
    }
}

/// The offline fixture room (DemoRoom): a typeable board with no network, the fresh
/// clone default.
private struct DemoRoomView: View {
    @State private var room = DemoRoom()

    var body: some View {
        SolveScreen(
            store: room.store,
            puzzle: room.puzzle,
            clues: room.clues,
            roomName: room.roomName,
            model: room.selection,
            chrome: room.chrome
        )
        .task { await room.run() }
    }
}

/// The live-stack room (RealRoom): REST fetch then the real socket. The view rebuilds
/// once the REST view lands (`ready` flips), so the placeholder geometry never renders
/// as playable truth (the store holds `connecting` until the welcome anyway). A fatal
/// wiring failure reads plainly instead of a blank room.
@available(iOS 18.0, *)
private struct RealRoomView: View {
    let config: RoomConfig
    @State private var room: RealRoom
    @State private var ready = false
    @Environment(\.colorScheme) private var colorScheme

    init(config: RoomConfig) {
        self.config = config
        _room = State(initialValue: RealRoom(config: config))
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
                    model: room.selection,
                    chrome: room.chrome
                )
                // The mapped geometry changes identity once the REST view lands, so the
                // SolveScreen's own @State (selection, chrome) reinitializes against the
                // real puzzle rather than the placeholder.
                .id(ready)
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
