// The reaction sticker layer as a VIEW overlay above the board Canvas (the owner's
// entry-shake finding, 2026-07-14). The first cut drew stickers inside the grid's
// per-frame Canvas pass, and the emoji visibly shivered through the entrance:
// Canvas re-renders its contents every TimelineView tick, so the glyph re-rasterized
// at every intermediate scale, and per-frame glyph rasterization re-snaps outline
// geometry sub-pixel (edge shimmer), where the web/CSS path rasterizes once and
// transforms the cached texture. This is the same lesson as the web's settle pop
// (#247), from the opposite direction: ANIMATE TRANSFORMS OF A RASTERIZED LAYER,
// NEVER RE-RENDER CONTENT PER FRAME. Here each sticker is one SwiftUI Text whose
// entrance, coalesce replay, and exit are scaleEffect/rotationEffect/opacity
// animations built from StickerEnvelope's constants: Core Animation transforms the
// glyph's one rasterized layer, the text itself never redraws mid-flight (its font
// size changes only with the camera's zoom, which re-renders the whole board
// anyway), and every keyframe track ends AT identity, so rest is exact by
// construction (the #245 guarantee). Moving off TimelineView also retires tick
// pacing as a shake contributor outright.
//
// Placement stays born-correct: position and tilt come from the sticker's seeded
// values and the camera alone, applied as un-animated layout, so nothing here can
// drift an incumbent. The layer is its own view over the grid: @Observable tracking
// keeps sticker mutations from re-evaluating CrossyGridView's body (only this body
// re-runs), and the layer never hit-tests, so every touch still belongs to the grid.

import Foundation
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct ReactionStickerLayer: View {
    let reactions: ReactionModel
    let puzzle: GridPuzzle
    let camera: GridCamera
    let reduceMotion: Bool

    var body: some View {
        ZStack {
            ForEach(reactions.stickers) { sticker in
                StickerView(
                    sticker: sticker,
                    fontSize: GridModule.stickerFontSize * camera.scale,
                    // A sticker that predates this layer by more than a beat (a
                    // resync of the lab's pre-settled twin, a placement swap) is
                    // already at rest: it mounts settled instead of shouting its
                    // entrance again, exactly as the closed form reads its age.
                    entersAnimated: Date().timeIntervalSinceReferenceDate - sticker.bornAt
                        < 0.1,
                    reduceMotion: reduceMotion
                )
                .position(position(of: sticker))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        // The sweep (the FlashBook pattern, scheduled): every mutation re-keys the
        // task, which sleeps to the book's soonest end and retires it; the ForEach
        // diff then removes the view, already faded by its own exit animation.
        .task(id: reactions.revision) {
            while !reactions.isEmpty, !Task.isCancelled {
                guard let expiry = reactions.nextExpiry else { return }
                let delay = expiry - Date().timeIntervalSinceReferenceDate
                if delay > 0 {
                    try? await Task.sleep(for: .seconds(delay + 0.02))
                }
                if Task.isCancelled { return }
                reactions.sweep(at: Date().timeIntervalSinceReferenceDate)
            }
        }
    }

    /// The sticker's anchor in view points: its seeded module-unit placement through
    /// the camera's transform. Un-animated layout, recomputed only when the camera
    /// or the book changes; during entrance/replay/exit this never moves.
    private func position(of sticker: ReactionSticker) -> CGPoint {
        let origin = GridModule.cellOrigin(sticker.cell, cols: puzzle.cols)
        return CGPoint(
            x: (origin.x + CGFloat(sticker.offsetX)) * camera.scale + camera.offset.x,
            y: (origin.y + CGFloat(sticker.offsetY)) * camera.scale + camera.offset.y)
    }
}

/// The web's per-segment easings as compositor curves, lifted from the same envelope
/// control points the Linux-tested closed forms evaluate: styles.css's --ease-out
/// token for the balloon and the settle, the CSS ease-in-out keyword for the tremble
/// legs and the dip. Non-isolated on purpose, like StickerEnvelope itself, so the
/// keyframes builder can read them from any context.
@available(iOS 17.0, macOS 14.0, *)
private enum LoudCurve {
    static let easeOut = curve(StickerEnvelope.entranceEaseOut)
    static let easeInOut = curve(StickerEnvelope.trembleEaseInOut)

    private static func curve(_ source: StickerEnvelope.EasingCurve) -> UnitCurve {
        .bezier(
            startControlPoint: UnitPoint(x: source.x1, y: source.y1),
            endControlPoint: UnitPoint(x: source.x2, y: source.y2))
    }
}

/// One sticker: a single Text whose animations are transforms of its rasterized
/// layer. Phases drive presence (born, resting, exiting) and one keyframe timeline
/// plays the loud gesture — the entrance AND every coalesce replay, a repeat shout
/// (owner ruling 2026-07-14) — over scale, tremble rotation, and opacity; the curves
/// are StickerEnvelope's constants, so the tested closed forms and the shipped
/// render share one source of truth.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
private struct StickerView: View {
    let sticker: ReactionSticker
    let fontSize: CGFloat
    let entersAnimated: Bool
    let reduceMotion: Bool

    private enum Phase {
        case born
        case resting
        case exiting
    }

    /// The loud gesture's animated frame. Rest IS identity: the timeline's final
    /// keyframes land here exactly, so once a shout finishes the animator holds
    /// values indistinguishable from no modifier at all (nothing kept by a fill).
    private struct LoudFrame {
        var scale: Double = 1
        var trembleDegrees: Double = 0
        var opacity: Double = 1
    }

    @State private var phase: Phase
    /// Bumped once per shout: the entrance (from the task below, so a pre-settled
    /// mount that skips it never shouts) and every coalesce replay. The keyframe
    /// animator's trigger.
    @State private var shouts = 0

    init(sticker: ReactionSticker, fontSize: CGFloat, entersAnimated: Bool, reduceMotion: Bool) {
        self.sticker = sticker
        self.fontSize = fontSize
        self.entersAnimated = entersAnimated
        self.reduceMotion = reduceMotion
        // A settled arrival mounts at rest: no entrance replay (the lab's
        // settle-pair twin, or a sticker outliving a layer swap).
        _phase = State(initialValue: entersAnimated ? .born : .resting)
    }

    private var scale: Double {
        if reduceMotion { return 1 }
        switch phase {
        case .born, .resting: return 1
        case .exiting: return StickerEnvelope.exitFinalScale
        }
    }

    private var opacity: Double {
        switch phase {
        case .born: return 0
        case .resting: return 1
        case .exiting: return 0
        }
    }

    /// The animation for the CURRENT transition, evaluated when `phase` changes:
    /// into exiting it is the web's eased fade; under Reduce Motion the entrance
    /// (and a coalesce revival) is the plain fade. Otherwise nil ON PURPOSE — the
    /// loud keyframes own the whole entrance, so the born-to-resting hop must snap
    /// underneath them, never animate on its own.
    private var phaseAnimation: Animation? {
        if phase == .exiting {
            return .easeInOut(duration: StickerEnvelope.exitSeconds)
        }
        if reduceMotion {
            return .easeOut(duration: StickerEnvelope.reducedMotionFadeInSeconds)
        }
        return nil
    }

    var body: some View {
        Text(verbatim: sticker.emoji)
            .font(.system(size: fontSize))
            .rotationEffect(
                .degrees(StickerEnvelope.tiltDegrees(sticker, reduceMotion: reduceMotion)))
            // The loud gesture (owner ruling 2026-07-14, the web's sticker-in): fade
            // in small, balloon to 1.9x, tremble, settle — one keyframe timeline
            // replayed WHOLE on every shout. The tremble track rotates ON TOP of
            // the static tilt above (center rotations add, so the wobble swings
            // around the seeded lean, never replaces it), every track ends at
            // identity, and the opening MoveKeyframes jump each replay to the 0%
            // frame no matter where the last run ended.
            .keyframeAnimator(
                initialValue: LoudFrame(), trigger: shouts
            ) { [reduceMotion] content, frame in
                content
                    .scaleEffect(reduceMotion ? 1 : frame.scale)
                    .rotationEffect(.degrees(reduceMotion ? 0 : frame.trembleDegrees))
                    .opacity(reduceMotion ? 1 : frame.opacity)
            } keyframes: { _ in
                // Durations are spans between the envelope's absolute breakpoints
                // (the web rows at 16/26/38/50/60/68/100% of 1050 ms); tracks
                // shorter than the timeline hold their final value, which is the
                // resting one.
                KeyframeTrack(\LoudFrame.scale) {
                    MoveKeyframe(StickerEnvelope.entryFromScale)
                    LinearKeyframe(
                        StickerEnvelope.balloonScale,
                        duration: StickerEnvelope.balloonAt,
                        timingCurve: LoudCurve.easeOut)
                    LinearKeyframe(
                        StickerEnvelope.balloonScale,
                        duration: StickerEnvelope.settleDipStartAt - StickerEnvelope.balloonAt)
                    LinearKeyframe(
                        StickerEnvelope.settleDipScale,
                        duration: StickerEnvelope.settleDipAt - StickerEnvelope.settleDipStartAt,
                        timingCurve: LoudCurve.easeInOut)
                    LinearKeyframe(
                        1.0,
                        duration: StickerEnvelope.entranceSeconds - StickerEnvelope.settleDipAt,
                        timingCurve: LoudCurve.easeOut)
                }
                KeyframeTrack(\LoudFrame.trembleDegrees) {
                    MoveKeyframe(0)
                    LinearKeyframe(0, duration: StickerEnvelope.balloonAt)
                    LinearKeyframe(
                        StickerEnvelope.trembleBeats[0].degrees,
                        duration: StickerEnvelope.trembleBeats[0].at - StickerEnvelope.balloonAt,
                        timingCurve: LoudCurve.easeInOut)
                    LinearKeyframe(
                        StickerEnvelope.trembleBeats[1].degrees,
                        duration: StickerEnvelope.trembleBeats[1].at
                            - StickerEnvelope.trembleBeats[0].at,
                        timingCurve: LoudCurve.easeInOut)
                    LinearKeyframe(
                        StickerEnvelope.trembleBeats[2].degrees,
                        duration: StickerEnvelope.trembleBeats[2].at
                            - StickerEnvelope.trembleBeats[1].at,
                        timingCurve: LoudCurve.easeInOut)
                    LinearKeyframe(
                        StickerEnvelope.trembleBeats[3].degrees,
                        duration: StickerEnvelope.trembleBeats[3].at
                            - StickerEnvelope.trembleBeats[2].at,
                        timingCurve: LoudCurve.easeInOut)
                    LinearKeyframe(
                        StickerEnvelope.trembleBeats[4].degrees,
                        duration: StickerEnvelope.trembleBeats[4].at
                            - StickerEnvelope.trembleBeats[3].at,
                        timingCurve: LoudCurve.easeInOut)
                }
                KeyframeTrack(\LoudFrame.opacity) {
                    MoveKeyframe(0)
                    LinearKeyframe(
                        1.0,
                        duration: StickerEnvelope.balloonAt,
                        timingCurve: LoudCurve.easeOut)
                }
            }
            .scaleEffect(scale)
            .opacity(opacity)
            .animation(phaseAnimation, value: phase)
            // A coalesce replays the WHOLE loud gesture: a repeat shout, not a
            // softer echo. The trigger only fires on CHANGE, so birth itself bumps
            // `shouts` in the task below instead.
            .onChange(of: sticker.refreshedAt) { shouts += 1 }
            // The exit's clock: sleep to the sticker's final `exitSeconds`, then
            // fade out so removal (the model's sweep at endsAt) lands on an already
            // invisible view. Keyed on endsAt: a coalesce mid-life (or even
            // mid-exit) re-keys, revives the phase, and re-arms the exit against
            // the refreshed end. The born hop and the entrance shout land in one
            // transaction, so the first visible frame is already the 0% keyframe.
            .task(id: sticker.endsAt) {
                if phase == .born {
                    phase = .resting
                    shouts += 1
                }
                let exitStart = sticker.endsAt - StickerEnvelope.exitSeconds
                let delay = exitStart - Date().timeIntervalSinceReferenceDate
                if delay > 0 {
                    if phase == .exiting { phase = .resting }
                    try? await Task.sleep(for: .seconds(delay))
                }
                guard !Task.isCancelled else { return }
                phase = .exiting
            }
    }
}
