//
//  ContentView.swift
//  Crossy
//
//  The app's root, I2b shape: the solve screen over the fixture room (DemoRoom),
//  shippable scaffolding the real room replaces from the inside in I2c (the
//  transport swaps, the composition stays). Ground follows system appearance
//  inside SolveScreen (ID-3).
//

import CrossyUI
import SwiftUI

struct ContentView: View {
    @State private var room = DemoRoom()

    var body: some View {
        SolveScreen(store: room.store, puzzle: room.puzzle)
            .task { await room.run() }
    }
}

#Preview {
    ContentView()
}
