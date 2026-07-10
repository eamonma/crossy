//
//  MorphLab.swift
//  Crossy
//
//  The gooey-morph recheck rig, round four. Ground truth arrived: the owner's
//  Mail recording is a stock UIMenu opening from the "..." button (the frames
//  show a Categories/List View palette picker, standard menu furniture). The
//  goo is the SYSTEM's presentation under Liquid Glass, not hand math. Frame
//  study of the recording at 60 fps:
//
//    100 ms  capsule intact
//    133 ms  content gone; the glass is a small featureless egg dropping out
//            of the button's spot
//    167 ms  teardrop ~2x, drifting toward the panel's center, edges SOFT
//    250 ms  near-panel-size oval, content resolving through blur inside
//    300 ms  panel arrived with oversized soft corners, content near-crisp
//    ~380 ms rest; close runs ~180 ms
//
//  The soft mid-flight edges are the glass shader blending two shapes' fields.
//  One crisp glassEffect rect tweened by hand cannot produce them, so the
//  droplet-math variant is retired. Candidates now ride the real mechanism
//  (WWDC25 session 323: menus and popovers flow out of glass controls):
//
//  A. glassEffectID swap: unique ids, panel inserted / pill removed inside
//     withAnimation, container spacing 40, Mail's timing (0.35 open, 0.18
//     close).
//  B. A real system Menu — Mail's actual mechanism, the reference rendering.
//     Kept OUTSIDE any GlassEffectContainer (26.1 breaks Menu morphs inside).
//  C. A popover presentation from a glass pill, hosting custom panel content
//     via presentationCompactAdaptation(.popover) — the shape the roster
//     panel could actually take, since popovers host arbitrary views.
//
//  All three are TAP-driven: the pill panels open on tap, so the SP-i1 melt
//  law (finger writes raw progress; no animation on scrubbed morphs) does not
//  govern them. Verdicts come from the device only; the simulator renders the
//  glass blend linearly and lies about goo.
//
//  Evidence only: nothing in the room composes through this screen.
//

import SwiftUI

struct MorphLab: View {
    @State private var openSwap = false
    @State private var openPopover = false
    @Namespace private var glass

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color(red: 0.96, green: 0.95, blue: 0.93).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 12) {
                ForEach(0..<20, id: \.self) { row in
                    Text(verbatim: "Across \(row + 1) — the quiet between clues")
                        .font(.system(size: 15))
                        .foregroundStyle(.black.opacity(0.72))
                }
            }
            .padding(20)

            VStack(alignment: .trailing, spacing: 22) {
                labeled("A — glassEffectID swap (tap)") { variantSwap }
                labeled("B — system Menu, Mail's mechanism (tap)") { variantMenu }
                labeled("C — popover, custom content (tap)") { variantPopover }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.trailing, 14)
            .padding(.top, 14)
        }
    }

    private func labeled(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(verbatim: label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            content()
        }
    }

    // MARK: - A: the documented swap (unique ids, one removed, one inserted)

    @ViewBuilder
    private var variantSwap: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 40) {
                ZStack(alignment: .topTrailing) {
                    if openSwap {
                        LabPanel(rows: 3)
                            .frame(width: 220, height: 170)
                            .glassEffect(.regular, in: .rect(cornerRadius: 24))
                            .glassEffectID("swap-panel", in: glass)
                            .onTapGesture {
                                withAnimation(.smooth(duration: 0.18)) { openSwap = false }
                            }
                    } else {
                        LabPill()
                            .glassEffect(.regular.interactive(), in: .capsule)
                            .glassEffectID("swap-pill", in: glass)
                            .onTapGesture {
                                withAnimation(.smooth(duration: 0.35)) { openSwap = true }
                            }
                    }
                }
                .frame(width: 220, height: 170, alignment: .topTrailing)
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    // MARK: - B: the real thing (Mail's "..." is a UIMenu; this is the target)

    // Menu rows take real images, not just symbols: a non-template image passes
    // through in full color (Messages' pin menus show contact photos; Mail's
    // palette row is full color). The pucks render once through ImageRenderer.
    @ViewBuilder
    private var variantMenu: some View {
        if #available(iOS 26.0, *) {
            Menu {
                Section("Solving now") {
                    Button {} label: {
                        Label { Text(verbatim: "You") } icon: { LabPuckArt.puck(0) }
                    }
                    Button {} label: {
                        Label {
                            Text(verbatim: "Bee")
                            Text(verbatim: "23 letters this round")
                        } icon: {
                            LabPuckArt.puck(1)
                        }
                    }
                    Button {} label: {
                        Label { Text(verbatim: "Ada") } icon: { LabPuckArt.puck(2) }
                    }
                }
                Button {} label: {
                    Label {
                        Text(verbatim: "gus")
                        Text(verbatim: "resting")
                    } icon: {
                        LabPuckArt.puck(3)
                    }
                }
            } label: {
                LabPill()
            }
            .buttonStyle(.glass)
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    // MARK: - C: popover (the presentation that can host the real roster)

    @ViewBuilder
    private var variantPopover: some View {
        if #available(iOS 26.0, *) {
            Button {
                openPopover = true
            } label: {
                LabPill()
            }
            .buttonStyle(.glass)
            .popover(isPresented: $openPopover) {
                LabPanel(rows: 4)
                    .frame(width: 240)
                    .padding(.vertical, 6)
                    .presentationCompactAdaptation(.popover)
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }
}

// MARK: - Shared lab content

/// The roster pucks as menu-row images: an initial on a colored circle,
/// rasterized once at 3x through ImageRenderer so UIKit's menu treats them as
/// original (colored) images rather than template symbols.
@MainActor
private enum LabPuckArt {
    static let players: [(initial: String, color: Color)] = [
        ("E", Color(red: 0.44, green: 0.4, blue: 0.83)),
        ("B", Color(red: 0.09, green: 0.57, blue: 0.5)),
        ("A", Color(red: 0.87, green: 0.34, blue: 0.13)),
        ("G", Color(white: 0.55)),
    ]
    private static var cache: [Int: Image] = [:]

    static func puck(_ index: Int) -> Image {
        if let cached = cache[index] { return cached }
        let art = players[index]
        let renderer = ImageRenderer(
            content: ZStack {
                Circle().fill(art.color)
                Text(verbatim: art.initial)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
            }
            .frame(width: 28, height: 28))
        renderer.scale = 3
        guard let ui = renderer.uiImage else {
            return Image(systemName: "person.crop.circle.fill")
        }
        let image = Image(uiImage: ui)
        cache[index] = image
        return image
    }
}

/// A players-like pill: three pucks and an overflow count, 44 pt capsule.
private struct LabPill: View {
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(
                        [Color(red: 0.44, green: 0.4, blue: 0.83),
                         Color(red: 0.09, green: 0.57, blue: 0.5),
                         Color(red: 0.87, green: 0.34, blue: 0.13)][index]
                    )
                    .frame(width: 24, height: 24)
            }
            Text(verbatim: "+8")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .frame(height: 44)
    }
}

private struct LabPanel: View {
    let rows: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<rows, id: \.self) { row in
                HStack(spacing: 10) {
                    Circle().fill(.gray.opacity(0.5)).frame(width: 26, height: 26)
                    Text(verbatim: ["You", "Bee", "Ada", "gus"][row % 4])
                        .font(.system(size: 15, weight: .medium))
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .frame(height: 44)
            }
        }
        .padding(.vertical, 8)
        .clipped()
    }
}
