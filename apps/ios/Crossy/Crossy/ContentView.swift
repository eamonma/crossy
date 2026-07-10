//
//  ContentView.swift
//  Crossy
//
//  The app's root: the full room (SolveScreen, I2c chrome) over the fixture room
//  (DemoRoom), shippable scaffolding the real connection replaces from the inside
//  in I3 (the transport swaps, the composition stays). Ground follows system
//  appearance inside SolveScreen (ID-3). Join in is stubbed here: the seat-change
//  endpoint is I3's.
//

import CrossyUI
import SwiftUI

struct ContentView: View {
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
