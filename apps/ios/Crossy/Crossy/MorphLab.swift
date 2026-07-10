//
//  MorphLab.swift
//  Crossy
//
//  The gooey-morph recheck rig (owner ask 2026-07-10). Two candidate mechanisms
//  for Mail's button-into-menu taffy, cycling side by side forever (-morphLab,
//  optionally -morphLabDuration <s>):
//
//  A. The glassEffectID matched-geometry swap (SP-i1 recorded it snapping on
//     simulator; the owner's frames of Mail suggest this is NOT the mechanism).
//  B. Two coexisting shapes in one GlassEffectContainer with generous blend
//     spacing: the panel grows out from under the pill and the metaball bridge
//     between them is the goo (Mail's mid-flight frames show button and panel
//     coexisting, fused). SP-i1's key-fusing finding proves the blend renders
//     on simulator, so this variant is sim-testable.
//
//  Evidence only: nothing in the room composes through this screen.
//

import SwiftUI

struct MorphLab: View {
    @State private var open = false
    @Namespace private var glass

    private var duration: Double {
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-morphLabDuration"),
            arguments.indices.contains(index + 1),
            let seconds = Double(arguments[index + 1])
        {
            return seconds
        }
        return 2.4
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            // A paper-ish field with content behind the glass, so the material
            // has something honest to refract.
            Color(red: 0.96, green: 0.95, blue: 0.93).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 14) {
                ForEach(0..<18, id: \.self) { row in
                    Text(verbatim: "Across \(row + 1) — the quiet between clues")
                        .font(.system(size: 16))
                        .foregroundStyle(.black.opacity(0.72))
                }
            }
            .padding(24)

            VStack(alignment: .trailing, spacing: 24) {
                labeled("A — ID swap") { variantA }
                labeled("B — container blend") { variantB }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.trailing, 16)
            .padding(.top, 18)
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1.0))
                withAnimation(.easeInOut(duration: duration)) { open.toggle() }
                try? await Task.sleep(for: .seconds(duration))
            }
        }
    }

    private func labeled(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .trailing, spacing: 6) {
            Text(verbatim: label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            content()
        }
    }

    // MARK: - A: the matched-geometry ID swap

    @ViewBuilder
    private var variantA: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 24) {
                ZStack(alignment: .topTrailing) {
                    if open {
                        panelContent(rows: 4)
                            .frame(width: 240, height: 200)
                            .glassEffect(.regular, in: .rect(cornerRadius: 24))
                            .glassEffectID("a", in: glass)
                            .glassEffectTransition(.matchedGeometry)
                    } else {
                        pillContent
                            .glassEffect(.regular, in: .capsule)
                            .glassEffectID("a", in: glass)
                            .glassEffectTransition(.matchedGeometry)
                    }
                }
                .frame(width: 240, height: 200, alignment: .topTrailing)
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    // MARK: - B: coexisting shapes, the container's metaball bridge

    @ViewBuilder
    private var variantB: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 48) {
                ZStack(alignment: .topTrailing) {
                    // The panel: always present, growing out from under the
                    // pill's spot. While small and near, the container fuses
                    // the two shapes; the stretch apart is the goo.
                    panelContent(rows: 4)
                        .frame(width: open ? 240 : 72, height: open ? 200 : 36)
                        .glassEffect(.regular, in: .rect(cornerRadius: open ? 24 : 18))
                        .opacity(open ? 1 : 0.02)
                        .padding(.top, open ? 0 : 6)
                        .padding(.trailing, open ? 0 : 12)
                    // The pill: stands until the panel has clearly taken the
                    // spot, then hands off late, the Mail read of the frames.
                    pillContent
                        .glassEffect(.regular, in: .capsule)
                        .opacity(open ? 0 : 1)
                }
                .frame(width: 240, height: 200, alignment: .topTrailing)
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    // MARK: - Shared content

    /// A players-like pill: three pucks and an overflow count, 44 pt capsule.
    private var pillContent: some View {
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

    private func panelContent(rows: Int) -> some View {
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
        .padding(.vertical, 10)
        .clipped()
    }
}
