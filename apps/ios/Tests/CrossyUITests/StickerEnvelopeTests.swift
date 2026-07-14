// The sticker's motion character, pinned by sampling the closed forms (the
// FlashEnvelope discipline): the entry slap's single ~9% overshoot and snappy settle,
// the exit shrink+fade, the coalesce pulse that starts and ends at exactly 1, and the
// Reduce Motion collapse to upright fade-only. The settle-boundary continuity tests
// are the iOS mirror of the web's #245 settle-pop fix: the resting transform must be
// bit-identical from entry-spring settle through exit-fade start, so the clamp steps
// are pinned far below visual epsilon.

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

    // MARK: - Entry (the web's slap: snappy settle, ~9% overshoot)

    func test_entryStartsFromZeroAndOvershootsAboutNinePercent() async {
        XCTAssertEqual(StickerEnvelope.entryScale(sinceBorn: 0), 0)
        var peak = 0.0
        var step = 0.0
        while step <= StickerEnvelope.entrySettleSeconds {
            peak = max(peak, StickerEnvelope.entryScale(sinceBorn: step))
            step += 0.001
        }
        XCTAssertEqual(peak, 1.09, accuracy: 0.01, "the slap's single overshoot is ~9%")
    }

    func test_entrySettleBoundaryIsContinuous_web245() async {
        // #245's lesson: no visible step at the spring-to-rest handoff. The residual
        // the clamp swallows is pinned below any visual epsilon, and past the
        // horizon the value is EXACTLY 1, not approximately.
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

    // MARK: - Exit (shrink+fade inside the last quarter second)

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

    func test_entryFadeReachesFullPresenceQuickly() async {
        let born = sticker(bornAt: 100)
        XCTAssertEqual(StickerEnvelope.opacity(born, at: 100, reduceMotion: false), 0)
        XCTAssertEqual(
            StickerEnvelope.opacity(
                born, at: 100 + StickerEnvelope.entryFadeSeconds, reduceMotion: false),
            1, accuracy: 1e-9)
    }

    // MARK: - The coalesce pulse (in place, spent back to exactly 1)

    func test_pulseStartsAtOnePeaksAtThePinnedAmplitudeAndSpendsToExactlyOne() async {
        XCTAssertEqual(StickerEnvelope.pulseScale(sincePulse: 0), 1)
        XCTAssertEqual(
            StickerEnvelope.pulseScale(sincePulse: StickerEnvelope.pulsePeakAt),
            1 + StickerEnvelope.pulsePeak, accuracy: 1e-9)
        let justBefore = StickerEnvelope.pulseScale(
            sincePulse: StickerEnvelope.pulseSettleSeconds - 1e-6)
        XCTAssertEqual(justBefore, 1, accuracy: 1e-3, "the pulse clamp step must be invisible")
        XCTAssertEqual(
            StickerEnvelope.pulseScale(sincePulse: StickerEnvelope.pulseSettleSeconds), 1)
    }

    func test_pulseRidesTheRefreshInstantNotTheBirth() async {
        let refreshed = coalescedSticker(bornAt: 100, refreshedAt: 102)
        let atPeak = StickerEnvelope.scale(
            refreshed, at: 102 + StickerEnvelope.pulsePeakAt, reduceMotion: false)
        XCTAssertEqual(atPeak, 1 + StickerEnvelope.pulsePeak, accuracy: 1e-6,
            "the entry has settled by the refresh, so the peak is the pulse alone")
        // A never-coalesced sticker never pulses.
        let born = sticker(bornAt: 100)
        XCTAssertEqual(StickerEnvelope.scale(born, at: 102.09, reduceMotion: false), 1)
    }

    // MARK: - Reduce Motion (owner spec: upright, fade-only)

    func test_reduceMotionRendersUprightAtRestingScaleAlways() async {
        let refreshed = coalescedSticker(bornAt: 100, refreshedAt: 102)
        for at in stride(from: 100.0, through: refreshed.endsAt, by: 0.25) {
            XCTAssertEqual(StickerEnvelope.scale(refreshed, at: at, reduceMotion: true), 1)
        }
        XCTAssertEqual(StickerEnvelope.tiltDegrees(refreshed, reduceMotion: true), 0)
        // The fade-in stretches to read as presence, not motion.
        XCTAssertLessThan(
            StickerEnvelope.opacity(refreshed, at: 100.1, reduceMotion: true),
            StickerEnvelope.opacity(refreshed, at: 100.1, reduceMotion: false))
    }
}
