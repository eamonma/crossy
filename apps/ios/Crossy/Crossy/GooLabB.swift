//
//  GooLabB.swift
//  Crossy
//
//  Variant B, the traveling melt. The Join capsule does not just get replaced
//  in place; it TRAVELS the width of the screen, from its top-trailing spot to
//  the back button's top-leading spot, while the time pill materializes out of
//  it mid-flight. This is the honest room-open motion: the one control the eye
//  was on (Join) becomes the one control the room leads with (back), the second
//  pill precipitating beside it.
//
//  Two mechanisms are A/B'd on the same travel so the owner can feel which
//  reads as Mail-quality goo:
//
//    Persistent (P): ONE glass element carrying .glassEffect, whose frame and
//      corner radius interpolate from the Join capsule's rect to the back
//      button's rect on the chrome spring (the SP-i1 single-surface law,
//      extended to a tap: no finger scrubs it, so an animation may own it).
//      The time pill fades/materializes in as a SECOND child of the same
//      container once the traveler is most of the way home, so the field-blend
//      can precipitate it. This never snaps (SP-i1's whole point) but it is
//      one crisp rect tweened, which the Mail frame study says cannot make the
//      soft mid-flight edges.
//
//    Matched swap (M): a glassEffectID matched-geometry swap across the whole
//      travel. Join has id "traveler"; on open, Join is removed and the back
//      button (same id) is inserted at the far spot, plus the time pill (its
//      own id) materialized. SP-i1 banned this for DRAG-scrubbed morphs (it
//      snaps under a finger); a tap has no scrub, so it is allowed here, and
//      the question is whether across a full screen-width travel the system
//      blends the fields or just crossfades-and-jumps.
//
//  Evidence only.
//

import CrossyUI
import SwiftUI

private enum GooMechanism: String, CaseIterable, Identifiable {
    case persistent = "P"
    case matched = "M"
    var id: String { rawValue }
    var label: String {
        self == .persistent ? "persistent single surface" : "glassEffectID matched swap"
    }
}

struct TravelingMeltLab: View {
    @State private var inRoom = false
    @State private var mechanism: GooMechanism = .persistent
    @State private var spacing: CGFloat = 40
    @Namespace private var glass

    var body: some View {
        if #available(iOS 26.0, *) {
            GeometryReader { proxy in
                let rest = joinRect(in: proxy.size)
                let open = backRect()
                let morph = GlassMorph(
                    rest: rest, open: open,
                    restCornerRadius: GooLayout.joinCorner,
                    openCornerRadius: GooLayout.pillCorner)
                ZStack(alignment: .top) {
                    Group {
                        if inRoom { FakeRoomBoard() } else { FakeRoomsList() }
                    }
                    .transition(.opacity)

                    chromeLayer(morph: morph)

                    VStack {
                        Spacer()
                        ribbon
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture { toggle() }
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    // MARK: The chrome layer

    @available(iOS 26.0, *)
    @ViewBuilder
    private func chromeLayer(morph: GlassMorph) -> some View {
        switch mechanism {
        case .persistent: persistentLayer(morph: morph)
        case .matched: matchedLayer(morph: morph)
        }
    }

    // Mechanism P: one traveling glass rect + a materializing time pill.
    @available(iOS 26.0, *)
    private func persistentLayer(morph: GlassMorph) -> some View {
        let progress: CGFloat = inRoom ? 1 : 0
        let frame = morph.frame(at: progress)
        return GlassEffectContainer(spacing: spacing) {
            ZStack(alignment: .topLeading) {
                // The traveler: Join's content early, the back chevron late,
                // crossfading through the middle (content rides the morph, the
                // clue-bar rule; here both are crisp glyphs so the crossfade is
                // honest).
                travelerContent(progress: progress)
                    .frame(width: frame.width, height: frame.height)
                    .glassEffect(.regular.interactive(),
                        in: .rect(cornerRadius: morph.cornerRadius(at: progress)))
                    .glassEffectID("traveler", in: glass)
                    .position(x: frame.midX, y: frame.midY)

                // The time pill precipitates beside the arrived back button,
                // materializing out of the field once the traveler is home.
                if inRoom {
                    GooTimePill()
                        .glassEffect(.regular, in: .capsule)
                        .glassEffectID("time", in: glass)
                        .glassEffectTransition(.materialize)
                        .position(
                            x: morph.open.maxX + GooLayout.pillGap + timePillHalfWidth,
                            y: morph.open.midY)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder
    private func travelerContent(progress: CGFloat) -> some View {
        ZStack {
            GooJoinCapsule().opacity(Double(1 - min(progress * 2, 1)))
            Image(systemName: "chevron.backward")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.black.opacity(0.85))
                .opacity(Double(max(progress * 2 - 1, 0)))
        }
    }

    // Mechanism M: a glassEffectID matched swap across the travel.
    @available(iOS 26.0, *)
    private func matchedLayer(morph: GlassMorph) -> some View {
        GlassEffectContainer(spacing: spacing) {
            ZStack(alignment: .topLeading) {
                if !inRoom {
                    GooJoinCapsule()
                        .glassEffect(.regular.interactive(), in: .capsule)
                        .glassEffectID("traveler", in: glass)
                        .glassEffectTransition(.matchedGeometry)
                        .position(x: morph.rest.midX, y: morph.rest.midY)
                }
                if inRoom {
                    GooBackButton()
                        .glassEffect(.regular.interactive(), in: .circle)
                        .glassEffectID("traveler", in: glass)
                        .glassEffectTransition(.matchedGeometry)
                        .position(x: morph.open.midX, y: morph.open.midY)
                    GooTimePill()
                        .glassEffect(.regular, in: .capsule)
                        .glassEffectID("time", in: glass)
                        .glassEffectTransition(.materialize)
                        .position(
                            x: morph.open.maxX + GooLayout.pillGap + timePillHalfWidth,
                            y: morph.open.midY)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    // MARK: Geometry

    /// Join's resting rect, top-trailing (RoomsScreen's overlay corner). Width
    /// is the capsule's natural content width; the lab hard-sizes it so the
    /// traveler's endpoints are pinned facts, not layout guesses.
    private func joinRect(in size: CGSize) -> CGRect {
        let width: CGFloat = 92
        let x = size.width - GooLayout.sideInset - width
        return CGRect(x: x, y: safeTop, width: width, height: GooLayout.joinHeight)
    }

    /// The back button's resting rect, top-leading.
    private func backRect() -> CGRect {
        CGRect(x: GooLayout.sideInset, y: safeTop,
            width: GooLayout.pillHeight, height: GooLayout.pillHeight)
    }

    private var safeTop: CGFloat { 60 }
    private var timePillHalfWidth: CGFloat { 34 }

    private func toggle() {
        withAnimation(.smooth(duration: inRoom ? GooTiming.close : GooTiming.open)) {
            inRoom.toggle()
        }
    }

    private var ribbon: some View {
        GooRibbon(
            title: "B — traveling melt · \(mechanism.label) · spacing \(Int(spacing))",
            detail: "The capsule travels a screen-width, back button arrives, time pill precipitates. Tap paper to fire."
        ) {
            HStack(spacing: 10) {
                Button(mechanism == .persistent ? "persistent" : "matched-ID") {
                    mechanism = mechanism == .persistent ? .matched : .persistent
                }
                .buttonStyle(.bordered)
                Button("spacing \(Int(spacing))") {
                    spacing = spacing == 40 ? 80 : (spacing == 80 ? 6 : 40)
                }
                .buttonStyle(.bordered)
            }
            .font(.system(size: 13, weight: .medium))
        }
    }
}
