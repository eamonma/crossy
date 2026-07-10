//
//  ContentView.swift
//  Crossy
//
//  The app's root: the full room (SolveScreen, I2c chrome). With the CROSSY_ROOM_*
//  environment present (the I2-exit proof and the local-stack dogfood inject it,
//  apps/ios/scripts/room.ts), the real room composes: REST puzzle fetch, production
//  store/driver/transport (RealRoom.swift). Without it, the fixture room (DemoRoom)
//  is unchanged, so a fresh clone still runs a typeable board with no network.
//  Ground follows system appearance inside SolveScreen (ID-3). Join in is stubbed
//  in the demo room: the seat-change endpoint is I3's.
//

import CrossyUI
import SwiftUI

struct ContentView: View {
    var body: some View {
        if let facts = RealRoomFacts.fromEnvironment() {
            RealRoomView(facts: facts)
        } else {
            DemoRoomView()
        }
    }
}

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

#Preview {
    ContentView()
}
