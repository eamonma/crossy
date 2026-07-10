//
//  MorphLab.swift
//  Crossy
//
//  The gooey-morph recheck rig, round three (owner rulings 2026-07-10; the
//  owner's Mail recording is the reference: the button dissolves into a soft
//  droplet that leaps toward the panel's center while swelling, resolving into
//  the panel late; open ~350 ms, close ~180 ms). Three candidates cycle:
//
//  A. The canonical glassEffectID idiom per Apple's "Applying Liquid Glass to
//     custom views": UNIQUE ids, one shape inserted/removed inside
//     withAnimation, container spacing 40 (round two used one id on both
//     sides of an if/else, which is not the documented pattern).
//  B. Same idiom, but the pill PERSISTS (the doc's pencil) and the panel
//     inserts next to it, morphing out of the pill's glass.
//  C. Hand-built droplet on our progress-driven math (the GlassMorph
//     discipline): position leaps ahead of growth, radius stays blobby until
//     late, content resolves through blur. Scrubbable by construction.
//
//  Evidence only: nothing in the room composes through this screen.
//

import SwiftUI

struct MorphLab: View {
    @State private var open = false
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

            VStack(alignment: .trailing, spacing: 10) {
                labeled("A — swap, unique ids") { variantSwap }
                labeled("B — pill persists, panel inserts") { variantInsert }
                labeled("C — hand-built droplet") { DropletStage() }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.trailing, 14)
            .padding(.top, 14)
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1.3))
                withAnimation(.easeInOut(duration: DropletStage.openSeconds)) {
                    open = true
                }
                try? await Task.sleep(for: .seconds(1.3 + DropletStage.openSeconds))
                withAnimation(.easeInOut(duration: DropletStage.closeSeconds)) {
                    open = false
                }
                try? await Task.sleep(for: .seconds(DropletStage.closeSeconds))
            }
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
                    if open {
                        LabPanel(rows: 3)
                            .frame(width: 220, height: 170)
                            .glassEffect(.regular, in: .rect(cornerRadius: 24))
                            .glassEffectID("swap-panel", in: glass)
                    } else {
                        LabPill()
                            .glassEffect(.regular, in: .capsule)
                            .glassEffectID("swap-pill", in: glass)
                    }
                }
                .frame(width: 220, height: 170, alignment: .topTrailing)
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    // MARK: - B: the doc's pencil-and-eraser (pill persists, panel inserts)

    @ViewBuilder
    private var variantInsert: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 40) {
                ZStack(alignment: .topTrailing) {
                    if open {
                        LabPanel(rows: 3)
                            .frame(width: 220, height: 170)
                            .glassEffect(.regular, in: .rect(cornerRadius: 24))
                            .glassEffectID("insert-panel", in: glass)
                    }
                    LabPill()
                        .opacity(open ? 0 : 1)
                        .glassEffect(.regular, in: .capsule)
                        .glassEffectID("insert-pill", in: glass)
                }
                .frame(width: 220, height: 170, alignment: .topTrailing)
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }
}

// MARK: - C: the droplet, by hand

/// The Mail choreography rebuilt on pure progress math, per the owner's
/// recording: the surface leaps toward the panel's center ahead of its growth,
/// stays a soft blob until late, and the content resolves through blur in the
/// back half. Driven per-frame by TimelineView, so it renders every
/// intermediate on any hardware and a finger could scrub it (the melt law's
/// shape, SP-i1).
struct DropletStage: View {
    static let openSeconds = 0.45
    static let closeSeconds = 0.25
    private static let hold = 1.3

    private let pill = CGRect(x: 124, y: 0, width: 96, height: 44)
    private let panel = CGRect(x: 0, y: 0, width: 220, height: 170)

    var body: some View {
        if #available(iOS 26.0, *) {
            TimelineView(.animation) { timeline in
                stage(progress: Self.progress(
                    at: timeline.date.timeIntervalSinceReferenceDate))
            }
            .frame(width: 220, height: 170)
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    /// The cycle: closed hold, open (0→1), open hold, close (1→0), aligned to
    /// the reference clock so every lab launch runs the same movie.
    static func progress(at t: TimeInterval) -> Double {
        let cycle = hold + openSeconds + hold + closeSeconds
        let phase = t.truncatingRemainder(dividingBy: cycle)
        if phase < hold { return 0 }
        if phase < hold + openSeconds { return (phase - hold) / openSeconds }
        if phase < hold + openSeconds + hold { return 1 }
        return 1 - (phase - hold - openSeconds - hold) / closeSeconds
    }

    @available(iOS 26.0, *)
    @ViewBuilder
    private func stage(progress p: Double) -> some View {
        // The leap runs ahead of the growth (the recording's signature): the
        // center moves on a hard ease-out while the size lags, so the surface
        // detaches as a droplet and swims to the panel's middle before it
        // swells to fill the rect.
        let leap = 1 - pow(1 - p, 3)
        let growth = easeInOut(clamped((p - 0.12) / 0.88))
        let w = lerp(pill.width, panel.width, growth)
        let h = lerp(pill.height, panel.height, growth)
        let cx = lerp(pill.midX, panel.midX, leap)
        let cy = lerp(pill.midY, panel.midY, leap)
        // Blobby until late: the radius holds at the capsule's half-height and
        // resolves to the panel's 24 pt in the back half.
        let r = lerp(min(w, h) / 2, 24, easeIn(clamped((p - 0.55) / 0.45)))
        // Content resolves through blur in the back half; the pill's content
        // dissolves first (the dots vanish by ~130 ms in the recording).
        let contentAlpha = clamped((p - 0.3) / 0.45)
        let blur = 18 * pow(1 - p, 2)
        let pillAlpha = 1 - clamped(p / 0.22)

        ZStack(alignment: .topLeading) {
            Color.clear
                .frame(width: w, height: h)
                .glassEffect(.regular, in: .rect(cornerRadius: r))
                .position(x: cx, y: cy)
            LabPanel(rows: 3)
                .frame(width: panel.width, height: panel.height)
                .position(x: panel.midX, y: panel.midY)
                .opacity(contentAlpha)
                .blur(radius: blur)
                .mask {
                    RoundedRectangle(cornerRadius: r, style: .continuous)
                        .frame(width: w, height: h)
                        .position(x: cx, y: cy)
                }
            LabPill()
                .position(x: pill.midX, y: pill.midY)
                .opacity(pillAlpha)
        }
        .frame(width: 220, height: 170)
    }

    private func lerp(_ a: CGFloat, _ b: CGFloat, _ t: Double) -> CGFloat {
        a + (b - a) * CGFloat(t)
    }
    private func clamped(_ t: Double) -> Double { min(1, max(0, t)) }
    private func easeIn(_ t: Double) -> Double { t * t }
    private func easeInOut(_ t: Double) -> Double {
        t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
    }
}

// MARK: - Shared lab content

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
