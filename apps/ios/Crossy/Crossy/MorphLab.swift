//
//  MorphLab.swift
//  Crossy
//
//  The glassEffectID recheck rig (owner ask 2026-07-10). SP-i1 recorded the
//  ID-swap morph snapping and the device recheck was deferred, then mooted when
//  the drag-scrubbed melt won with GlassMorph (correctly: a finger scrubs
//  progress, a transition cannot). But Mail's button-into-menu goo is the
//  system's matched-geometry glass morph, and the pill panels are TAP-driven,
//  so the question re-opens for them. This rig swaps a players-like pill into a
//  roster-like panel and back on a slowed animation, forever, so simctl can
//  catch mid-flight frames (-morphLab, optionally -morphLabDuration <s>).
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
        ZStack(alignment: .topTrailing) {
            // A paper-ish field with content behind the glass, so the material
            // has something honest to refract.
            Color(red: 0.96, green: 0.95, blue: 0.93).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 14) {
                ForEach(0..<14, id: \.self) { row in
                    Text(verbatim: "Across \(row + 1) — the quiet between clues")
                        .font(.system(size: 16))
                        .foregroundStyle(.black.opacity(0.72))
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)

            morphPair
                .padding(.top, 18)
                .padding(.trailing, 16)
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1.0))
                withAnimation(.easeInOut(duration: duration)) { open.toggle() }
                try? await Task.sleep(for: .seconds(duration))
            }
        }
    }

    @ViewBuilder
    private var morphPair: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 24) {
                ZStack(alignment: .topTrailing) {
                    if open {
                        panel
                            .glassEffect(
                                .regular, in: .rect(cornerRadius: 24)
                            )
                            .glassEffectID("pill", in: glass)
                            .glassEffectTransition(.matchedGeometry)
                    } else {
                        pill
                            .glassEffect(.regular, in: .capsule)
                            .glassEffectID("pill", in: glass)
                            .glassEffectTransition(.matchedGeometry)
                    }
                }
            }
        } else {
            Text(verbatim: "MorphLab needs iOS 26 glass")
        }
    }

    /// A players-like pill: three pucks and an overflow count, 44 pt capsule.
    private var pill: some View {
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

    /// A roster-like panel: rows fade as the transition's content, the Mail
    /// posture (content crossfades; the glass is what travels).
    private var panel: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<6, id: \.self) { row in
                HStack(spacing: 10) {
                    Circle().fill(.gray.opacity(0.5)).frame(width: 26, height: 26)
                    Text(verbatim: ["You", "Bee", "Ada", "gus", "Kit", "mo"][row])
                        .font(.system(size: 15, weight: .medium))
                    Spacer()
                }
                .padding(.horizontal, 16)
                .frame(height: 44)
            }
        }
        .padding(.vertical, 10)
        .frame(width: 300)
    }
}
