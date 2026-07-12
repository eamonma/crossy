//
//  GooLabE.swift
//  Crossy
//
//  Variant E, the system-toolbar route (owner's clarified grammar, 2026-07-11
//  evening). The reference is Mail's toolbar transition: home has Edit
//  top-right; pushing into a mailbox, the top-right becomes Select + "..." as
//  two separate pills, and Edit goos into those two SAME SIDE, IN PLACE. One
//  shape splitting into shapes where it stands, no cross-screen travel. That
//  kills variant B's screen-width flight for the ask (kept in the lab for the
//  record) and makes the near swap (A) the goo-quality test.
//
//  The load-bearing observation: Mail achieves this ACROSS A PUSH because
//  Edit/Select/... are system toolbar items in the navigation bar, chrome that
//  persists across the push, whose items the system morphs on iOS 26. Crossy
//  hides the system nav bar on every screen and hand-draws its top chrome,
//  which is why we never see this for free. If the system does the morph on
//  its own, the production route is adopting real ToolbarItems for top chrome
//  and letting NavigationStack do it, far cheaper than the persistent overlay
//  layer variants A-D rehearse.
//
//  The rig: a real NavigationStack with the system navigation bar VISIBLE
//  (this variant only; A-D stay bar-less).
//    Screen 1 (fake rooms list): ONE trailing ToolbarItem carrying a Join-like
//      capsule (the Edit analog).
//    Screen 2 (pushed fake room): TWO trailing items, a time-pill-like pill
//      and a circular ellipsis glyph (the Select + "..." analog), split by
//      ToolbarSpacer(.fixed) so they read as separate glass pills like Mail's.
//
//  Questions the device answers (the sim records structure, not goo):
//    1. Does the system goo the trailing item(s) across the push/pop the way
//       Mail does, by DEFAULT, with no matching API at all?
//    2. If the default crossfades: does matchedTransitionSource on the item
//       plus navigationTransition(.zoom) change the item morph, or only the
//       screen transition? (A toggle builds both.)
//    3. The system back button's arrival: does it materialize from the leading
//       edge cleanly?
//    4. The interactive back-swipe: does the system scrub the item goo under
//       the finger mid-pop? If it does, that beats anything we can hand-build
//       and likely decides the architecture.
//
//  -gooLabAutoPush scripts a push ~3 s after the list appears so a screenshot
//  loop can catch the transition mid-flight (the MorphLab -morphLabPopover
//  precedent: simctl cannot tap).
//
//  Evidence only.
//

import SwiftUI

private struct GooERoute: Hashable { let name: String }

struct SystemToolbarLab: View {
    @State private var path: [GooERoute] = []
    /// The matching experiment: matchedTransitionSource on the Join item plus
    /// navigationTransition(.zoom) on the destination. OFF is the default
    /// system transition, the first thing to judge.
    @State private var zoomMatch = false
    @Namespace private var match

    var body: some View {
        if #available(iOS 26.0, *) {
            ZStack(alignment: .bottom) {
                NavigationStack(path: $path) {
                    roomsList
                        .navigationDestination(for: GooERoute.self) { route in
                            room(route)
                        }
                }
                ribbon
            }
            .onAppear {
                guard ProcessInfo.processInfo.arguments.contains("-gooLabAutoPush")
                else { return }
                Task {
                    try? await Task.sleep(for: .seconds(3))
                    path.append(GooERoute(name: "Friday crew"))
                }
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    // MARK: Screen 1, the rooms list (Edit's home: one trailing item)

    @available(iOS 26.0, *)
    private var roomsList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(0..<6, id: \.self) { i in
                    let route = GooERoute(name: ["Sunday quiet", "Tuesday themeless",
                        "The Wednesday", "Friday crew", "Saturday stumper", "Mini break"][i])
                    Button {
                        path.append(route)
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
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(GooPaper().ignoresSafeArea())
        .navigationTitle(Text(verbatim: "Rooms"))
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            // The Edit analog: one trailing item, the Join capsule's content.
            // The system wraps it in nav-bar glass on 26; no glassEffect here,
            // the whole point is the SYSTEM owning the surface.
            ToolbarItem(placement: .topBarTrailing) {
                Button {} label: {
                    Label {
                        Text(verbatim: "Join")
                    } icon: {
                        Image(systemName: "qrcode.viewfinder")
                    }
                    // A recorded finding: the 26 toolbar collapses a Label to
                    // its icon by default (the first sim run rendered a bare
                    // glyph circle). Mail's Edit is a TEXT pill, so the Edit
                    // analog must ask for the title explicitly.
                    .labelStyle(.titleAndIcon)
                }
                .modifier(MatchSource(active: zoomMatch, namespace: match))
            }
        }
    }

    // MARK: Screen 2, the pushed room (Select + "...": two trailing items)

    @available(iOS 26.0, *)
    private func room(_ route: GooERoute) -> some View {
        ZStack {
            GooPaper().ignoresSafeArea()
            FakeRoomBoard()
        }
        .navigationTitle(Text(verbatim: route.name))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The Select analog: the time pill's content as a text-ish item.
            ToolbarItem(placement: .topBarTrailing) {
                Button {} label: {
                    HStack(spacing: 6) {
                        Circle().fill(.primary.opacity(0.7)).frame(width: 7, height: 7)
                        Text(verbatim: "4:12")
                            .font(.system(size: 13, weight: .medium))
                            .monospacedDigit()
                    }
                }
            }
            // The break that makes two SEPARATE glass pills (Mail's grammar);
            // without it the two items share one grouped capsule.
            ToolbarSpacer(.fixed, placement: .topBarTrailing)
            // The "..." analog: a circular glyph item.
            ToolbarItem(placement: .topBarTrailing) {
                Button {} label: {
                    Image(systemName: "ellipsis")
                }
            }
        }
        .modifier(MatchDestination(active: zoomMatch, namespace: match))
    }

    // MARK: The ribbon

    private var ribbon: some View {
        GooRibbon(
            title: "E — system toolbar · match \(zoomMatch ? "ON" : "OFF")",
            detail: path.isEmpty
                ? "Real nav bar, Join as a ToolbarItem. Push a room: does the system goo Join into the two pills, Mail's grammar?"
                : "Two trailing items (pill + glyph). Swipe back slowly: does the system scrub the item morph under the finger?"
        ) {
            Button(zoomMatch ? "match ON" : "match OFF") { zoomMatch.toggle() }
                .buttonStyle(.bordered)
                .font(.system(size: 13, weight: .medium))
        }
    }
}

// MARK: - The matching experiment (question 2)

/// matchedTransitionSource on the Join item. iOS 18 API; applied only when the
/// toggle asks, so the DEFAULT transition is judged first.
private struct MatchSource: ViewModifier {
    let active: Bool
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if active, #available(iOS 18.0, *) {
            content.matchedTransitionSource(id: "join-item", in: namespace)
        } else {
            content
        }
    }
}

/// The destination half: navigationTransition(.zoom) keyed to the Join item.
/// Expectation to verify: this zooms the whole SCREEN out of the item (the
/// arrival-notes finding), it does not morph item-to-item; recorded either way.
private struct MatchDestination: ViewModifier {
    let active: Bool
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if active, #available(iOS 18.0, *) {
            content.navigationTransition(.zoom(sourceID: "join-item", in: namespace))
        } else {
            content
        }
    }
}
