// The sticker's motion character, pinned by sampling the closed forms. The shipping
// renderer (ReactionStickerLayer) drives SwiftUI spring and keyframe animations built
// from these SAME constants (the entry-shake fix, owner finding 2026-07-14: transform
// a rasterized layer, never re-render content per frame), so these closed forms are
// the normative curve both evaluators share. The numbers are the web layer's
// (styles.css), so the two clients slap alike: entry 0.3 to 1 on a spring whose
// easing overshoot ~9.4% renders as a ~6.6% scale peak, exit to 0.7 over the final
// 380 ms, pulse to 1.16 at 45% of 300 ms. The settle-boundary continuity tests are
// the #245/#247 lesson: rest must be exact, with no step at the spring's end.

import CrossyUI
import XCTest

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class StickerEnvelopeTests: XCTestCase {
    private func sticker(bornAt: TimeInterval = 100) -> ReactionSticker {
        let model = ReactionModel()
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: bornAt)
        return model.stickers[0]
    }

    private func coalescedSticker(
        bornAt: TimeInterval = 100, refreshedAt: TimeInterval
    ) -> ReactionSticker {
        let model = ReactionModel()
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: bornAt)
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: refreshedAt)
        return model.stickers[0]
    }

    // MARK: - Entry (the web's slap, shared numbers)

    func test_entryStartsAtTheWebsFromScaleAndPeaksNearSixAndAHalfPercent() async {
        XCTAssertEqual(
            StickerEnvelope.entryScale(sinceBorn: 0), StickerEnvelope.entryFromScale)
        var peak = 0.0
        var step = 0.0
        while step <= StickerEnvelope.entrySettleSeconds {
            peak = max(peak, StickerEnvelope.entryScale(sinceBorn: step))
            step += 0.001
        }
        // The easing's ~9.4% overshoot renders over the 0.7 step: ~1.066, the same
        // peak the web's linear() spring paints.
        XCTAssertEqual(peak, 1.066, accuracy: 0.01)
    }

    func test_entryOpacityRidesTheSameSpringClamped() async {
        let born = sticker(bornAt: 100)
        XCTAssertEqual(StickerEnvelope.opacity(born, at: 100, reduceMotion: false), 0)
        // The spring overshoots past 1; opacity clamps exactly as CSS clamps it.
        var step = 0.0
        while step <= StickerEnvelope.entrySettleSeconds {
            XCTAssertLessThanOrEqual(
                StickerEnvelope.opacity(born, at: 100 + step, reduceMotion: false), 1)
            step += 0.01
        }
        XCTAssertEqual(
            StickerEnvelope.opacity(
                born, at: 100 + StickerEnvelope.entrySettleSeconds, reduceMotion: false),
            1)
    }

    func test_entrySettleBoundaryIsContinuous_web245() async {
        // #245/#247's lesson: no visible step at the spring-to-rest handoff. The
        // residual the clamp swallows is pinned below any visual epsilon, and past
        // the horizon the value is EXACTLY 1, not approximately.
        let horizon = StickerEnvelope.entrySettleSeconds
        let justBefore = StickerEnvelope.entryScale(sinceBorn: horizon - 1e-6)
        XCTAssertEqual(justBefore, 1, accuracy: 1e-4, "the clamp step must be invisible")
        XCTAssertEqual(StickerEnvelope.entryScale(sinceBorn: horizon), 1)
        XCTAssertEqual(StickerEnvelope.entryScale(sinceBorn: horizon + 3), 1)
    }

    func test_restingTransformIsIdenticalFromSettleThroughExitStart_web245() async {
        // The whole-scale seam: between entry settle and exit start the sticker
        // rests at EXACTLY 1 at every instant, so nothing can snap after the entry.
        let born = sticker(bornAt: 100)
        let settleEnd = 100 + StickerEnvelope.entrySettleSeconds
        let exitStart = born.endsAt - StickerEnvelope.exitSeconds
        var at = settleEnd
        while at <= exitStart {
            XCTAssertEqual(
                StickerEnvelope.scale(born, at: at, reduceMotion: false), 1,
                "resting scale must be exactly 1 at t=\(at)")
            at += 0.05
        }
        // The placement transform is static from birth by construction: it is a
        // `let` on the sticker, so there is nothing time-varying to drift.
        XCTAssertEqual(
            StickerEnvelope.tiltDegrees(born, reduceMotion: false), born.tiltDegrees)
    }

    // MARK: - Exit (the web's sticker-out: 380 ms to scale 0.7, faded)

    func test_exitShrinksAndFadesToNothingAtTheEnd() async {
        let born = sticker(bornAt: 100)
        let end = born.endsAt
        XCTAssertEqual(
            StickerEnvelope.scale(born, at: end - StickerEnvelope.exitSeconds, reduceMotion: false),
            1, "the exit begins from the resting transform, never early")
        let mid = StickerEnvelope.scale(
            born, at: end - StickerEnvelope.exitSeconds / 2, reduceMotion: false)
        XCTAssertLessThan(mid, 1)
        XCTAssertGreaterThan(mid, StickerEnvelope.exitFinalScale)
        XCTAssertEqual(
            StickerEnvelope.scale(born, at: end, reduceMotion: false),
            StickerEnvelope.exitFinalScale, accuracy: 1e-9)
        XCTAssertEqual(StickerEnvelope.opacity(born, at: end, reduceMotion: false), 0)
    }

    // MARK: - The coalesce pulse (the web's sticker-repulse: 1.16 at 45% of 300 ms)

    func test_pulseStartsAtOnePeaksAtThePinnedAmplitudeAndEndsAtExactlyOne() async {
        XCTAssertEqual(StickerEnvelope.pulseScale(sincePulse: 0), 1)
        XCTAssertEqual(
            StickerEnvelope.pulseScale(sincePulse: StickerEnvelope.pulsePeakAt),
            1 + StickerEnvelope.pulsePeak, accuracy: 1e-9)
        let justBefore = StickerEnvelope.pulseScale(
            sincePulse: StickerEnvelope.pulseSeconds - 1e-6)
        XCTAssertEqual(justBefore, 1, accuracy: 1e-3, "the pulse ends where it began")
        XCTAssertEqual(
            StickerEnvelope.pulseScale(sincePulse: StickerEnvelope.pulseSeconds), 1)
    }

    func test_pulseRidesTheRefreshInstantNotTheBirth() async {
        let refreshed = coalescedSticker(bornAt: 100, refreshedAt: 102)
        let atPeak = StickerEnvelope.scale(
            refreshed, at: 102 + StickerEnvelope.pulsePeakAt, reduceMotion: false)
        XCTAssertEqual(atPeak, 1 + StickerEnvelope.pulsePeak, accuracy: 1e-6,
            "the entry has settled by the refresh, so the peak is the pulse alone")
        // A never-coalesced sticker never pulses.
        let born = sticker(bornAt: 100)
        XCTAssertEqual(
            StickerEnvelope.scale(
                born, at: 100 + 2 + StickerEnvelope.pulsePeakAt, reduceMotion: false),
            1)
    }

    // MARK: - Reduce Motion (owner spec: upright, fade-only; the web's fade pair)

    func test_reduceMotionRendersUprightAtRestingScaleAlways() async {
        let refreshed = coalescedSticker(bornAt: 100, refreshedAt: 102)
        for at in stride(from: 100.0, through: refreshed.endsAt, by: 0.25) {
            XCTAssertEqual(StickerEnvelope.scale(refreshed, at: at, reduceMotion: true), 1)
        }
        XCTAssertEqual(StickerEnvelope.tiltDegrees(refreshed, reduceMotion: true), 0)
        // The plain 180 ms fade reaches presence later than the spring's ramp.
        XCTAssertLessThan(
            StickerEnvelope.opacity(refreshed, at: 100.1, reduceMotion: true),
            StickerEnvelope.opacity(refreshed, at: 100.1, reduceMotion: false))
    }
}
