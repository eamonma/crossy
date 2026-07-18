// The Meridian ring (apps/ios Wave 15.8, the check-vote taste wave; UX.md U4): a luminous
// rounded-rect halo just outside the PROJECTED grid — camera truth, so it tracks pan and
// zoom — in the warm gold accent, draining continuously with the vote's remaining time. It
// is the only clock, so there are no countdown digits anywhere. It ignites on open (handed
// the flame by the proposer-cursor pulse), drains clockwise from 12 o'clock, flashes the
// standing arc and dissolves on a pass, and fades quietly from the frozen arc otherwise.
//
// The gold is the AnalysisPalette ramp (the app's one warm note), never an identity color,
// so the ring can never be mistaken for a voter. It is decorative and hidden from the
// accessibility tree; the Bench carries the labels and announcements a screen reader reads.
//
// REFERENCE CONSTANTS (Android copies this look; every number is named below):
//   outset            6 pt   gap between the projected grid edge and the ring's stroke line
//   cornerRadius      6 pt   == outset: a true parallel offset of the grid's SQUARE drawn
//                            corner turns by an arc of exactly the offset distance
//   strokeWidth       2 pt   the gold core; luminosity comes from the bloom, never weight
//   bloom (standing)  two soft shadows: gold @ 0.55 radius 3, gold @ 0.30 radius 9
//   bloom (flash)     boosted: gold @ 0.9 radius 4, gold @ 0.6 radius 14
//   ignite            240 ms scale 1.012 flare easing out to 1.0 (SolveScreen advances the
//                            phase to .draining after 240 ms)
//   pass flash        120 ms ease-out bloom of the STANDING arc (trim untouched)
//   pass dissolve     500 ms ease-out to opacity 0, delayed 180 ms after the flash begins
//   fail/lapse fade   600 ms ease-out to opacity 0 from the FROZEN arc
//   drain smoothing   150 ms linear between the 30 Hz display-link ticks
//   reduce motion     no sweep, no pulse: the ring stands WHOLE and its opacity steps in
//                     QUARTERS (web parity) — 0.9 × {1, 0.75, 0.5, 0.25} as time drains;
//                     pass and fail cut with no animation

import CrossyDesign
import CrossyStore
import Foundation
import SwiftUI

/// The ring's life phase, driving ignition, drain, and dissolution independently of the drain
/// fraction. The caller advances it on the store's vote beats.
public enum CheckVoteRingPhase: Equatable, Sendable {
    /// Rising on vote open: a brief flare, then it settles into the drain.
    case igniting
    /// Steady state: the stroke drains with `progress`.
    case draining
    /// The vote passed: the standing arc flashes bright, then dissolves.
    case passing
    /// The vote failed, lapsed, or was cancelled: a quiet fade from the frozen arc.
    case fading
}

// MARK: - The shape

/// A rounded rect whose path STARTS AT TOP-CENTER and runs CLOCKWISE, so a trim from 0
/// reads as a clock hand: the drained arc retreats toward 12 o'clock as time runs out.
/// No rotationEffect, no transform tricks — the old −90° rotation transposed a non-square
/// rect into two full-width bars (the Wave 15.8 audit's finding); the seam lives in the
/// path itself now.
public struct MeridianRoundedRect: Shape {
    public var cornerRadius: CGFloat

    public init(cornerRadius: CGFloat) {
        self.cornerRadius = cornerRadius
    }

    public func path(in rect: CGRect) -> Path {
        let r = min(cornerRadius, min(rect.width, rect.height) / 2)
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        // Clockwise: top edge to the right, then each corner as a tangent arc.
        path.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.minY),
            tangent2End: CGPoint(x: rect.maxX, y: rect.maxY), radius: r)
        path.addArc(
            tangent1End: CGPoint(x: rect.maxX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.minX, y: rect.maxY), radius: r)
        path.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.maxY),
            tangent2End: CGPoint(x: rect.minX, y: rect.minY), radius: r)
        path.addArc(
            tangent1End: CGPoint(x: rect.minX, y: rect.minY),
            tangent2End: CGPoint(x: rect.midX, y: rect.minY), radius: r)
        path.closeSubpath()
        return path
    }
}

// MARK: - Camera-truth anchoring (pure, pinned in CheckVoteRingTests)

public enum CheckVoteRingGeometry {
    /// The gap between the projected grid's edge and the ring's stroke centerline.
    public static let outset: CGFloat = 6
    /// The ring's corner radius EQUALS the outset: the grid draws a square corner, and a
    /// true parallel offset of a square corner at distance d is an arc of radius d. (The
    /// old radius-22 halo was misregistered against the grid's own corner.)
    public static var cornerRadius: CGFloat { outset }

    /// The grid's projected rect in the board view's own coordinates: origin from the
    /// camera offset, size = board units × scale. The grid view reports this upward so the
    /// ring can anchor to the drawn grid, not the full-bleed container.
    public static func projected(camera: GridCamera, rows: Int, cols: Int) -> CGRect {
        let board = GridCamera.boardSize(rows: rows, cols: cols)
        return CGRect(
            x: camera.offset.x, y: camera.offset.y,
            width: board.width * camera.scale, height: board.height * camera.scale)
    }

    /// The ring's rect: the projected grid clamped to the viewport (a zoomed board runs
    /// past the edges; the ring hugs what is visible), then outset by the gap. Degenerate
    /// overlap yields a zero rect (the caller skips the draw).
    public static func ringRect(projected: CGRect, viewport: CGRect) -> CGRect {
        let clamped = projected.intersection(viewport)
        guard !clamped.isNull, clamped.width > 0, clamped.height > 0 else { return .zero }
        return clamped.insetBy(dx: -outset, dy: -outset)
    }
}

// MARK: - Reduce Motion stepping (quarters, web parity)

public enum CheckVoteRingModel {
    /// The standing stroke opacity while motion plays.
    public static let standingOpacity: Double = 0.9

    /// Under Reduce Motion the ring stands whole and its OPACITY steps in quarters as the
    /// time drains — 0.9 × {1, 0.75, 0.5, 0.25} — the only cue that time is running when
    /// no sweep may animate. Quarters match the web's stepped ramp (was fifths here).
    public static func steppedOpacity(progress: Double) -> Double {
        let p = min(1, max(0, progress))
        return max(0.25, (p * 4).rounded(.up) / 4) * standingOpacity
    }
}

// MARK: - Freeze at close

/// The last drained fraction, computed at the close beat from the mirrored vote's
/// `expiresAt` (the store nils `checkVote` before the close callback fires, so the live
/// drain has nothing to read). Mirrors `GameStore.checkVoteRemaining`'s clamp exactly:
/// remaining / TTL, held to [0, 1]; nil when the timestamp does not parse.
public enum CheckVoteRingFreeze {
    public static func progress(expiresAt: String, asOf now: Date) -> Double? {
        guard let expires = parseISO8601(expiresAt) else { return nil }
        let ttl = GameStore.checkVoteTTLSeconds
        let remaining = min(ttl, max(0, expires.timeIntervalSince(now)))
        return remaining / ttl
    }

    private static func parseISO8601(_ text: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: text)
    }
}

// MARK: - The view

@available(iOS 17.0, macOS 14.0, *)
public struct CheckVoteRing: View {
    /// Remaining fraction, 1 at open draining to 0 at the timebox. While the vote is open
    /// this is the live clamp; across a close the caller passes the FROZEN fraction, so the
    /// standing arc holds through the breath instead of vanishing (the Wave 15.8 fix).
    private let progress: Double
    private let phase: CheckVoteRingPhase
    private let ground: GridGround
    private let reduceMotion: Bool

    /// The pass choreography's two internal beats: the bloom, then the dissolve.
    @State private var passFlash = false
    @State private var passDissolved = false

    /// Named motion constants (the Android copy transcribes these).
    public static let strokeWidth: CGFloat = 2
    public static let flashInDuration: Double = 0.12
    public static let dissolveDuration: Double = 0.5
    public static let dissolveDelay: Double = 0.18
    public static let fadeDuration: Double = 0.6
    public static let drainSmoothing: Double = 0.15

    public init(
        progress: Double, phase: CheckVoteRingPhase, ground: GridGround, reduceMotion: Bool
    ) {
        self.progress = min(1, max(0, progress))
        self.phase = phase
        self.ground = ground
        self.reduceMotion = reduceMotion
    }

    /// The warm gold, the solo-gold ramp hue (AnalysisPalette), never an identity color.
    private var gold: Color { Color(rgb: AnalysisPalette.gold(ground)) }

    private var opacity: Double {
        switch phase {
        case .igniting, .draining:
            return reduceMotion
                ? CheckVoteRingModel.steppedOpacity(progress: progress)
                : CheckVoteRingModel.standingOpacity
        case .passing:
            // Motion: the flash holds full brightness until the dissolve takes it to zero.
            // Reduce Motion: the marks applied instantly, so the ring simply leaves.
            if reduceMotion { return 0 }
            return passDissolved ? 0 : 1
        case .fading:
            return 0  // animated from the frozen arc below; cut under Reduce Motion
        }
    }

    public var body: some View {
        let shape = MeridianRoundedRect(cornerRadius: CheckVoteRingGeometry.cornerRadius)
        let flashing = passFlash && !passDissolved
        shape
            // The drain: trim from the top-center seam, clockwise (the shape owns the
            // clock; no rotation). The pass flashes the STANDING arc, so the trim is
            // never forced to full. Reduce Motion holds the ring whole.
            .trim(from: 0, to: reduceMotion ? 1 : CGFloat(progress))
            .stroke(
                gold,
                style: StrokeStyle(
                    lineWidth: Self.strokeWidth, lineCap: .round, lineJoin: .round))
            // Luminosity is BLOOM, not stroke weight: a tight inner glow and a wide soft
            // halo. The flash boosts both; Reduce Motion drops them (no glow pulse).
            .shadow(
                color: gold.opacity(reduceMotion ? 0 : (flashing ? 0.9 : 0.55)),
                radius: flashing ? 4 : 3)
            .shadow(
                color: gold.opacity(reduceMotion ? 0 : (flashing ? 0.6 : 0.30)),
                radius: flashing ? 14 : 9)
            .opacity(opacity)
            // The ignition flare and the pass bloom breathe the whole halo by a hair.
            .scaleEffect(
                reduceMotion ? 1 : (flashing || phase == .igniting ? 1.012 : 1))
            .animation(
                reduceMotion ? nil : .easeOut(duration: 0.3), value: phase == .igniting)
            .animation(
                reduceMotion ? nil : .easeOut(duration: Self.fadeDuration),
                value: phase == .fading)
            .animation(
                reduceMotion ? nil : .linear(duration: Self.drainSmoothing), value: progress)
            .onChange(of: phase) { _, next in
                switch next {
                case .igniting, .draining:
                    // A fresh vote can open while the ring is still mounted from the last
                    // recess: reset the pass beats so the new arc draws.
                    passFlash = false
                    passDissolved = false
                case .passing:
                    guard !reduceMotion else { return }
                    // The pass: flash the standing arc, then dissolve. Two overlapping
                    // animations on the internal beats; the trim never moves.
                    withAnimation(.easeOut(duration: Self.flashInDuration)) {
                        passFlash = true
                    }
                    withAnimation(
                        .easeOut(duration: Self.dissolveDuration).delay(Self.dissolveDelay)
                    ) {
                        passDissolved = true
                    }
                case .fading:
                    break
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)  // decorative; the Bench carries the semantics
    }
}

// MARK: - The ignition pulse (U4, "Ember's soul")

/// The vote's spatial attribution: at the open beat a brief gold pulse blooms at the
/// PROPOSER's cursor cell and hands the flame to the ring igniting, so the room reads WHERE
/// the question came from before it reads who. Mounted once per open by the solve screen
/// (never under Reduce Motion: U4 says no pulse), positioned through the same camera
/// projection the ring rides.
///
/// Constants (Android copies): 450 ms ease-out; scale 0.6 → 2.6 of the projected cell;
/// opacity 0.9 → 0; a 1.5 pt gold ring over a soft radial core. The ring's own ignition
/// flare (240 ms) overlaps the pulse's tail — that overlap IS the handoff.
@available(iOS 17.0, macOS 14.0, *)
struct CheckVoteIgnitionPulse: View {
    let ground: GridGround
    /// The projected cell's edge length (module unit × camera scale).
    let cellSize: CGFloat

    @State private var bloom = false

    static let duration: Double = 0.45
    static let startScale: CGFloat = 0.6
    static let endScale: CGFloat = 2.6

    private var gold: Color { Color(rgb: AnalysisPalette.gold(ground)) }

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [gold.opacity(0.45), gold.opacity(0)],
                        center: .center, startRadius: 0, endRadius: cellSize / 2))
            Circle()
                .stroke(gold, lineWidth: 1.5)
        }
        .frame(width: cellSize, height: cellSize)
        .scaleEffect(bloom ? Self.endScale : Self.startScale)
        .opacity(bloom ? 0 : 0.9)
        .onAppear {
            withAnimation(.easeOut(duration: Self.duration)) { bloom = true }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
