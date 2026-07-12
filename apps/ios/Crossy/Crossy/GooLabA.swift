//
//  GooLabA.swift
//  Crossy
//
//  Variant A, the near swap. One GlassEffectContainer overlay owns both
//  endpoint shapes. A tap swaps the fake rooms list for the fake room
//  underneath while, INSIDE the container, the Join-capsule child is removed
//  and the back-pill + time-pill children are inserted with a glass transition.
//  The shapes sit near each other (the Join capsule's top-trailing spot and the
//  cluster's top-leading spot are both in the top strip), so this is the
//  gentlest test of the fusion: do siblings a screen-width apart in one
//  container goo, or only crossfade?
//
//  Two toggles, both built (the owner rules by finger):
//    - matchedGeometry vs materialize (glassEffectTransition on the inserted
//      children). matchedGeometry is the near-shape blend; materialize is the
//      distant insert/remove. The liquid-glass skill: matchedGeometry for
//      nearby effects inside container spacing, materialize for distant ones.
//    - container spacing 6 (the cluster's real blend, below the fuse) vs 40
//      (MetaballRecipe's fuse spacing). At 6 the two shapes should never fuse;
//      at 40 the field-blend the Mail frames proved unreachable by tweening one
//      crisp rect can happen if the shapes fall within one spacing of each other.
//
//  Evidence only.
//

import CrossyUI
import SwiftUI

struct NearSwapLab: View {
    /// The "route": false is the rooms list + Join capsule, true is the room +
    /// the cluster. The tap flips it, animating the child swap inside the
    /// persistent container.
    @State private var inRoom = false
    @State private var transition: GooTransition = .matchedGeometry
    @State private var wideSpacing = false
    @Namespace private var glass

    var body: some View {
        if #available(iOS 26.0, *) {
            ZStack(alignment: .top) {
                // The paper below the chrome: it swaps hard (a screen swap is a
                // hard cut in production, a NavigationStack push), so ONLY the
                // chrome layer above owns the continuity.
                Group {
                    if inRoom { FakeRoomBoard() } else { FakeRoomsList() }
                }
                .transition(.opacity)

                chromeLayer
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(.horizontal, GooLayout.sideInset)
                    .padding(.top, GooLayout.chromeTop)

                VStack {
                    Spacer()
                    ribbon
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { toggle() }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    @available(iOS 26.0, *)
    private var chromeLayer: some View {
        // ONE persistent container owning both endpoints. The tap removes the
        // Join child and inserts the two cluster children (or the reverse); the
        // system melts the removed field into the inserted ones.
        GlassEffectContainer(spacing: wideSpacing ? 40 : GooLayout.clusterBlend) {
            ZStack(alignment: .top) {
                // Rooms endpoint: the Join capsule, top-trailing.
                if !inRoom {
                    GooJoinCapsule()
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .glassEffectID("join", in: glass)
                        .glassEffectTransition(glassTransition)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                // Room endpoint: the back button (leading) + the time pill,
                // the production cluster, back button leading.
                if inRoom {
                    HStack(spacing: GooLayout.pillGap) {
                        GooBackButton()
                            .glassEffect(.regular.interactive(), in: .circle)
                            .glassEffectID("back", in: glass)
                            .glassEffectTransition(glassTransition)
                        GooTimePill()
                            .glassEffect(.regular, in: .capsule)
                            .glassEffectID("time", in: glass)
                            .glassEffectTransition(glassTransition)
                        Spacer(minLength: 0)
                    }
                }
            }
            .frame(height: GooLayout.pillHeight)
        }
    }

    @available(iOS 26.0, *)
    private var glassTransition: GlassEffectTransition {
        transition == .matchedGeometry ? .matchedGeometry : .materialize
    }

    private func toggle() {
        withAnimation(.smooth(duration: inRoom ? GooTiming.close : GooTiming.open)) {
            inRoom.toggle()
        }
    }

    private var ribbon: some View {
        GooRibbon(
            title: "A — near swap · \(transition.rawValue) · spacing \(wideSpacing ? 40 : Int(GooLayout.clusterBlend))",
            detail: inRoom
                ? "In room: back + time cluster. Tap paper to pour back to Join."
                : "Rooms: Join capsule. Tap paper to open the room and melt into the cluster."
        ) {
            HStack(spacing: 10) {
                Button(transition == .matchedGeometry ? "matched" : "materialize") {
                    transition = transition == .matchedGeometry ? .materialize : .matchedGeometry
                }
                .buttonStyle(.bordered)
                Button(wideSpacing ? "spacing 40" : "spacing 6") {
                    wideSpacing.toggle()
                }
                .buttonStyle(.bordered)
            }
            .font(.system(size: 13, weight: .medium))
        }
    }
}
