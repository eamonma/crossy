// The reaction sticker layer as a VIEW overlay above the board Canvas (the owner's
// entry-shake finding, 2026-07-14). The first cut drew stickers inside the grid's
// per-frame Canvas pass, and the emoji visibly shivered through the entry spring:
// Canvas re-renders its contents every TimelineView tick, so the glyph re-rasterized
// at every intermediate scale, and per-frame glyph rasterization re-snaps outline
// geometry sub-pixel (edge shimmer), where the web/CSS path rasterizes once and
// transforms the cached texture. This is the same lesson as the web's settle pop
// (#247), from the opposite direction: ANIMATE TRANSFORMS OF A RASTERIZED LAYER,
// NEVER RE-RENDER CONTENT PER FRAME. Here each sticker is one SwiftUI Text whose
// entry, pulse, and exit are scaleEffect/opacity animations built from
// StickerEnvelope's constants: Core Animation transforms the glyph's one rasterized
// layer, the text itself never redraws mid-flight (its font size changes only with
// the camera's zoom, which re-renders the whole board anyway), and the spring ends
// AT the model value, so rest is exact by construction (the #245 guarantee). Moving
// off TimelineView also retires tick pacing as a shake contributor outright.
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
                    // already at rest: it mounts settled instead of replaying its
                    // entry, exactly as the closed form reads its age.
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
    /// or the book changes; during entry/pulse/exit this never moves.
    private func position(of sticker: ReactionSticker) -> CGPoint {
        let origin = GridModule.cellOrigin(sticker.cell, cols: puzzle.cols)
        return CGPoint(
            x: (origin.x + CGFloat(sticker.offsetX)) * camera.scale + camera.offset.x,
            y: (origin.y + CGFloat(sticker.offsetY)) * camera.scale + camera.offset.y)
    }
}

/// One sticker: a single Text whose animations are transforms of its rasterized
/// layer. Three phases drive it (born, resting, exiting) plus the coalesce pulse on
/// a keyframe track; the curves are StickerEnvelope's constants, so the tested
/// closed forms and the shipped render share one source of truth.
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

    @State private var phase: Phase

    init(sticker: ReactionSticker, fontSize: CGFloat, entersAnimated: Bool, reduceMotion: Bool) {
        self.sticker = sticker
        self.fontSize = fontSize
        self.entersAnimated = entersAnimated
        self.reduceMotion = reduceMotion
        // A settled arrival mounts at rest: no entry replay (the lab's settle-pair
        // twin, or a sticker outliving a layer swap).
        _phase = State(initialValue: entersAnimated ? .born : .resting)
    }

    private var scale: Double {
        if reduceMotion { return 1 }
        switch phase {
        case .born: return StickerEnvelope.entryFromScale
        case .resting: return 1
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
    /// into exiting it is the web's eased fade; otherwise the entry (or a coalesce
    /// revival) rides the slap spring. Reduce Motion swaps both for plain fades.
    private var phaseAnimation: Animation {
        if phase == .exiting {
            return .easeInOut(duration: StickerEnvelope.exitSeconds)
        }
        if reduceMotion {
            return .easeOut(duration: StickerEnvelope.reducedMotionFadeInSeconds)
        }
        return .spring(
            response: StickerEnvelope.entryResponse,
            dampingFraction: StickerEnvelope.entryDampingRatio)
    }

    var body: some View {
        Text(verbatim: sticker.emoji)
            .font(.system(size: fontSize))
            .rotationEffect(
                .degrees(StickerEnvelope.tiltDegrees(sticker, reduceMotion: reduceMotion)))
            // The coalesce pulse: a keyframe transform on top of the phase scale,
            // triggered by the refresh instant, never by birth (the trigger only
            // fires on CHANGE). The track ends at exactly 1, so a pulse can never
            // leave the sticker off its resting transform.
            .keyframeAnimator(
                initialValue: 1.0, trigger: sticker.refreshedAt
            ) { [reduceMotion] content, pulse in
                content.scaleEffect(reduceMotion ? 1 : pulse)
            } keyframes: { _ in
                KeyframeTrack {
                    CubicKeyframe(
                        1 + StickerEnvelope.pulsePeak, duration: StickerEnvelope.pulsePeakAt)
                    CubicKeyframe(
                        1.0,
                        duration: StickerEnvelope.pulseSeconds - StickerEnvelope.pulsePeakAt)
                }
            }
            .scaleEffect(scale)
            .opacity(opacity)
            .animation(phaseAnimation, value: phase)
            // The exit's clock: sleep to the sticker's final `exitSeconds`, then
            // fade out so removal (the model's sweep at endsAt) lands on an already
            // invisible view. Keyed on endsAt: a coalesce mid-life (or even
            // mid-exit) re-keys, revives the phase, and re-arms the exit against
            // the refreshed end.
            .task(id: sticker.endsAt) {
                if phase == .born { phase = .resting }
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
