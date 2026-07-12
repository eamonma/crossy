//
//  GooLabD.swift
//  Crossy
//
//  Variant D, the real-seam rehearsal. Variants A-C proved the goo on a fake
//  route flip (a state toggle). This one mounts the SAME persistent chrome
//  layer over an ACTUAL NavigationStack push: a fixture rooms list pushes a
//  fixture room, and the chrome swap fires on the path-change COMMIT, not on
//  the tap. This is the production seam: a room open is a real push (ContentView
//  -> ArrivalRootView's stack), the tab bar already rides path changes at the
//  transition's start (the path empties/fills there), and the chrome layer must
//  ride the same commit so it swaps in lockstep with the screen.
//
//  What this variant checks that the others cannot:
//
//    1. The commit timing. The chrome layer lives OUTSIDE the NavigationStack
//       (an overlay over the whole shell), so it does not push with the screen;
//       it observes `path` and swaps its children when the path gains/loses the
//       room. Does the goo land in step with the push, or lead/lag it?
//
//    2. navigationTransition(.zoom) underneath (PR #132's room-open zoom). The
//       zoom scales the pushed room out of the tapped card. With the chrome
//       goo running ABOVE it, do the two motions fight or compose? Toggle the
//       zoom ON and OFF and compare.
//
//    3. The interactive back-swipe. A swipe-to-pop scrubs the navigation
//       transition with a finger. The chrome swap is COMMIT-driven (it fires
//       when the path actually changes, at the swipe's release/cancel), so it
//       should ride the pop like the tab bar, not scrub with the finger. Record
//       what it actually looks like: does the cluster hold until the pop
//       commits and then pour back to Join, or does it flicker mid-scrub?
//
//  Evidence only. The chrome content here is the same endpoint shapes as A-C so
//  the feel is comparable across variants.
//

import CrossyUI
import SwiftUI

private struct GooRoomRoute: Hashable { let name: String }

struct RealSeamLab: View {
    @State private var path: [GooRoomRoute] = []
    @State private var zoomOn = true
    @Namespace private var zoom

    private var inRoom: Bool { !path.isEmpty }

    var body: some View {
        if #available(iOS 26.0, *) {
            ZStack(alignment: .top) {
                stack
                // THE PERSISTENT CHROME LAYER: outside the NavigationStack, over
                // the whole shell. It never pushes; it swaps its children when
                // the path commits (onChange below drives the animation).
                chromeLayer
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(.horizontal, GooLayout.sideInset)
                    .padding(.top, 60)
                    .allowsHitTesting(false)

                VStack {
                    Spacer()
                    ribbon
                }
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    @available(iOS 26.0, *)
    private var stack: some View {
        NavigationStack(path: $path) {
            fixtureList
                .navigationDestination(for: GooRoomRoute.self) { route in
                    fixtureRoom(route)
                }
        }
        // Ride the commit: when the path gains or loses the room, animate the
        // chrome swap in step. This is the tab-bar timing (path changes at the
        // transition's start), reproduced for the chrome layer.
        .onChange(of: path) { _, _ in
            // No explicit withAnimation here: the chrome layer's children are
            // in a GlassEffectContainer keyed on `inRoom`, and the transition
            // animates from the state change the push itself drives. A tap that
            // sets the path is already inside SwiftUI's transaction; a
            // back-swipe commit is not, so the chrome layer animates its own
            // swap on the chrome spring below.
        }
    }

    @available(iOS 26.0, *)
    private var fixtureList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: "Rooms (real push)")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.black.opacity(0.86))
                    .padding(.top, 56)
                ForEach(0..<6, id: \.self) { i in
                    let route = GooRoomRoute(name: ["Sunday quiet", "Tuesday themeless",
                        "The Wednesday", "Friday crew", "Saturday stumper", "Mini break"][i])
                    Button {
                        withAnimation(.smooth(duration: GooTiming.open)) {
                            path.append(route)
                        }
                    } label: {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(.white)
                            .frame(height: 76)
                            .overlay(alignment: .leading) {
                                Text(verbatim: route.name)
                                    .font(.system(size: 17, weight: .medium))
                                    .foregroundStyle(.black.opacity(0.8))
                                    .padding(.leading, 18)
                            }
                            .zoomSource(id: route.name, active: zoomOn, namespace: zoom)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 40)
        }
        .background(GooPaper().ignoresSafeArea())
        .navigationBarHidden(true)
    }

    @available(iOS 26.0, *)
    private func fixtureRoom(_ route: GooRoomRoute) -> some View {
        ZStack {
            GooPaper().ignoresSafeArea()
            FakeRoomBoard()
        }
        .navigationBarHidden(true)
        .zoomDestination(id: route.name, active: zoomOn, namespace: zoom)
    }

    // The chrome layer: the same endpoint swap as A, but keyed off the real
    // navigation state (inRoom = path is non-empty), animating on the chrome
    // spring so a back-swipe commit (outside a tap transaction) still animates.
    @available(iOS 26.0, *)
    private var chromeLayer: some View {
        GlassEffectContainer(spacing: GooLayout.clusterBlend) {
            ZStack(alignment: .top) {
                if !inRoom {
                    GooJoinCapsule()
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                if inRoom {
                    HStack(spacing: GooLayout.pillGap) {
                        GooBackButton()
                            .glassEffect(.regular.interactive(), in: .circle)
                        GooTimePill()
                            .glassEffect(.regular, in: .capsule)
                        Spacer(minLength: 0)
                    }
                }
            }
            .frame(height: GooLayout.pillHeight)
        }
        .animation(.smooth(duration: GooTiming.open), value: inRoom)
    }

    private var ribbon: some View {
        GooRibbon(
            title: "D — real-seam rehearsal · zoom \(zoomOn ? "ON" : "OFF")",
            detail: inRoom
                ? "In a pushed room. Swipe from the left edge to pop and watch the chrome pour back."
                : "Tap a room card: a real NavigationStack push. The chrome layer rides the path commit."
        ) {
            Button(zoomOn ? "zoom ON" : "zoom OFF") { zoomOn.toggle() }
                .buttonStyle(.bordered)
                .font(.system(size: 13, weight: .medium))
        }
    }
}

// MARK: - The zoom pairing (PR #132's mechanism, gated behind the toggle)

private extension View {
    @ViewBuilder
    func zoomSource(id: String, active: Bool, namespace: Namespace.ID) -> some View {
        if active, #available(iOS 18.0, *) {
            matchedTransitionSource(id: id, in: namespace)
        } else {
            self
        }
    }

    @ViewBuilder
    func zoomDestination(id: String, active: Bool, namespace: Namespace.ID) -> some View {
        if active, #available(iOS 18.0, *) {
            navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            self
        }
    }
}
