//
//  GooLabA.swift
//  Crossy
//
//  Variant A, the in-place trailing split. REBUILT after the owner's device
//  report on the first cut ("literally no effect"): that build put the Join
//  capsule top-trailing and the arriving cluster top-leading, endpoints a
//  screen-width apart, so the two shapes' fields could never overlap and the
//  ID swap just popped (SP-i1's snap, reproduced by hand; the distance law's
//  field confirmation). It also contradicted the owner's clarified grammar:
//  Mail's Edit goos into Select + "..." SAME SIDE, IN PLACE, one shape
//  splitting into shapes where it stands.
//
//  This build is that grammar on the production metaball recipe, the one
//  already ratified on device for the facts card (PillInflation.swift,
//  MetaballPanelSurface, the working reference):
//
//    - ONE GlassEffectContainer at MetaballRecipe's fuse spacing (40).
//    - Unique glassEffectIDs in one namespace on each shape.
//    - Conditional children swapped inside withAnimation(.smooth) at Mail's
//      timing (0.35 open, 0.18 close). NO glassEffectTransition modifier on
//      the children: production uses none; a ribbon toggle adds .materialize
//      for the contrast, labeled so the owner knows which is shipping.
//    - Explicit frames and positions in a ZStack (the MetaballPanelSurface
//      structure), so the overlap is geometric fact, not alignment hand-waving.
//
//  The endpoints: the Join capsule top-trailing; the arriving TIME PILL +
//  CIRCULAR GLYPH (the Select + "..." analog) also top-trailing, their union
//  covering the capsule's footprint (the Mail-button rule: the new surface
//  grows over the spot it came from). The back button is NOT part of the goo:
//  it appears separately at leading, the room's way out, far outside any
//  field.
//
//  Scripting: -gooLabAutoFire toggles the swap ~2 s after launch (simctl
//  cannot tap); -gooLabSlow multiplies the durations x8 so a screenshot loop
//  can catch the blend frame. Both capture-only; the judged default is Mail's
//  timing under a finger.
//
//  Evidence only.
//

import CrossyUI
import SwiftUI

/// The two treatments the ribbon flips between. `production` is the shipping
/// facts-card recipe (no transition modifier; the container's field blend is
/// the whole effect). `materialize` adds glassEffectTransition(.materialize)
/// on the swapped children, recorded for contrast.
private enum GooRecipe: String {
    case production
    case materialize
}

struct NearSwapLab: View {
    /// The "route": false is the rooms list + Join capsule, true is the room +
    /// the trailing split. The tap flips it inside withAnimation, the
    /// production recipe's driving transaction.
    @State private var inRoom = false
    @State private var recipe: GooRecipe = .production
    @State private var wideSpacing = true
    @Namespace private var glass

    var body: some View {
        if #available(iOS 26.0, *) {
            GeometryReader { proxy in
                let join = joinRect(in: proxy.size)
                let time = timeRect(in: proxy.size)
                let glyph = glyphRect(in: proxy.size)
                ZStack(alignment: .top) {
                    // The paper below: it swaps hard (a push is a hard cut);
                    // only the chrome layer above owns the continuity.
                    Group {
                        if inRoom { FakeRoomBoard() } else { FakeRoomsList() }
                    }
                    .transition(.opacity)

                    chromeLayer(join: join, time: time, glyph: glyph)

                    VStack {
                        Spacer()
                        ribbon
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { toggle() }
                .onAppear {
                    guard ProcessInfo.processInfo.arguments.contains("-gooLabAutoFire")
                    else { return }
                    Task {
                        try? await Task.sleep(for: .seconds(2))
                        toggle()
                    }
                }
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    // MARK: The chrome layer (the production recipe's structure)

    @available(iOS 26.0, *)
    private func chromeLayer(join: CGRect, time: CGRect, glyph: CGRect) -> some View {
        GlassEffectContainer(spacing: wideSpacing ? 40 : GooLayout.clusterBlend) {
            ZStack(alignment: .topLeading) {
                if !inRoom {
                    // The departing shape: Join, top-trailing, the arrival
                    // grammar's capsule.
                    GooJoinCapsule()
                        .frame(width: join.width, height: join.height)
                        .glassEffect(
                            .regular.interactive(),
                            in: .rect(cornerRadius: GooLayout.joinCorner))
                        .glassEffectID("join", in: glass)
                        .modifier(OptionalMaterialize(active: recipe == .materialize))
                        .position(x: join.midX, y: join.midY)
                }
                if inRoom {
                    // The arriving split: time pill + circular glyph, their
                    // union covering the capsule's footprint (the Mail-button
                    // rule). These are the goo.
                    GooTimePill()
                        .frame(width: time.width, height: time.height)
                        .glassEffect(.regular, in: .capsule)
                        .glassEffectID("time", in: glass)
                        .modifier(OptionalMaterialize(active: recipe == .materialize))
                        .position(x: time.midX, y: time.midY)
                    Image(systemName: "ellipsis")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.black.opacity(0.85))
                        .frame(width: glyph.width, height: glyph.height)
                        .glassEffect(.regular.interactive(), in: .circle)
                        .glassEffectID("glyph", in: glass)
                        .modifier(OptionalMaterialize(active: recipe == .materialize))
                        .position(x: glyph.midX, y: glyph.midY)
                    // The back button, leading: the room's way out, NOT part
                    // of the goo (far outside any field; its own id).
                    GooBackButton()
                        .glassEffect(.regular.interactive(), in: .circle)
                        .glassEffectID("back", in: glass)
                        .position(
                            x: GooLayout.sideInset + GooLayout.pillHeight / 2,
                            y: glyph.midY)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    // MARK: Geometry (explicit rects so the overlap is a pinned fact)

    /// Join's resting rect, top-trailing (RoomsScreen's overlay corner).
    private func joinRect(in size: CGSize) -> CGRect {
        CGRect(
            x: size.width - GooLayout.sideInset - 92,
            y: 60, width: 92, height: GooLayout.joinHeight)
    }

    /// The glyph circle, far trailing: its trailing edge is Join's trailing
    /// edge, centers vertically aligned with the capsule's.
    private func glyphRect(in size: CGSize) -> CGRect {
        CGRect(
            x: size.width - GooLayout.sideInset - GooLayout.pillHeight,
            y: 60 + GooLayout.joinHeight / 2 - GooLayout.pillHeight / 2,
            width: GooLayout.pillHeight, height: GooLayout.pillHeight)
    }

    /// The time pill, just leading of the glyph at the cluster gap. The pair's
    /// union spans wider than Join's 92 and covers its whole footprint.
    private func timeRect(in size: CGSize) -> CGRect {
        let glyph = glyphRect(in: size)
        return CGRect(
            x: glyph.minX - GooLayout.pillGap - 72,
            y: glyph.minY, width: 72, height: GooLayout.pillHeight)
    }

    // MARK: The drive

    /// The production recipe's transaction: the swap rides withAnimation at
    /// Mail's timing (MetaballRecipe). -gooLabSlow stretches it x8 for
    /// mid-frame capture only.
    private func toggle() {
        let slow: Double =
            ProcessInfo.processInfo.arguments.contains("-gooLabSlow") ? 8 : 1
        withAnimation(
            .smooth(duration: (inRoom ? GooTiming.close : GooTiming.open) * slow)
        ) {
            inRoom.toggle()
        }
    }

    private var ribbon: some View {
        GooRibbon(
            title: "A — in-place trailing split · \(recipe == .production ? "production recipe" : "+ materialize") · spacing \(wideSpacing ? 40 : Int(GooLayout.clusterBlend))",
            detail: inRoom
                ? "Split standing where Join stood. Tap paper to pour back."
                : "Rooms: Join top-trailing. Tap paper: the capsule splits into time pill + glyph IN PLACE (Mail's grammar)."
        ) {
            HStack(spacing: 10) {
                Button(recipe == .production ? "production (shipping)" : "materialize") {
                    recipe = recipe == .production ? .materialize : .production
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

/// The contrast treatment: glassEffectTransition(.materialize) on the swapped
/// children. Production (the facts card's ratified recipe) applies NOTHING and
/// lets the container's field blend carry the swap.
@available(iOS 26.0, *)
private struct OptionalMaterialize: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.glassEffectTransition(.materialize)
        } else {
            content
        }
    }
}
