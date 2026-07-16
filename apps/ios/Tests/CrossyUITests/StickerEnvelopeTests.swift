// The sticker's motion character, pinned by sampling the closed forms. The shipping
// renderer (ReactionStickerLayer) drives SwiftUI keyframe animations built from these
// SAME constants (the entry-shake fix, owner finding 2026-07-14: transform a
// rasterized layer, never re-render content per frame), so these closed forms are the
// normative curve both evaluators share. The numbers are the web layer's loud
// entrance (styles.css, owner ruling "loud entry is good" 2026-07-14, retiring the
// spring slap and the 1.16 coalesce pulse), so the two clients shout alike: one
// 1050 ms timeline — fade in small to 0.35, balloon to 1.9 by 16%, tremble
// +5/-5/+4/-2 degrees at 26/38/50/60% composing OVER the seeded tilt, home at 1.88
// and 0 degrees at 68%, settle to exactly 1 — then the unchanged exit to 0.7 over the
// final 380 ms. A coalesce replays the whole gesture from the refresh instant. The
// end-at-identity tests are the #245/#247 lesson: rest must be exact, with no step at
// the entrance's end and nothing held by a fill.

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

    // MARK: - The timeline (the web's sticker-in rows, percentages of 1050 ms)

    func test_breakpointsAreTheWebPercentagesOfTheEntrance() async {
        let total = StickerEnvelope.entranceSeconds
        XCTAssertEqual(total, 1.05, accuracy: 1e-12, "the web's --sticker-in-dur")
        XCTAssertEqual(StickerEnvelope.balloonAt, 0.16 * total, accuracy: 1e-12)
        let beats = StickerEnvelope.trembleBeats
        let percentages: [Double] = [0.26, 0.38, 0.50, 0.60, 0.68]
        XCTAssertEqual(beats.count, percentages.count)
        for (beat, percentage) in zip(beats, percentages) {
            XCTAssertEqual(beat.at, percentage * total, accuracy: 1e-12)
        }
        XCTAssertEqual(beats.map(\.degrees), [5, -5, 4, -2, 0])
        // The scale dip rides the tremble's homecoming leg (60% to 68%), one shared
        // pair of breakpoints, exactly as the web couples them in one keyframe block.
        XCTAssertEqual(StickerEnvelope.settleDipStartAt, beats[3].at)
        XCTAssertEqual(StickerEnvelope.settleDipAt, beats[4].at)
    }

    func test_segmentEasingsAreTheWebsCubicBeziers() async {
        // The ease-out legs run the web's --ease-out token (0.16, 1, 0.3, 1):
        // strongly front-loaded, monotone (no overshoot past a keyframe's value).
        let easeOut = StickerEnvelope.entranceEaseOut
        XCTAssertEqual(easeOut.value(at: 0), 0)
        XCTAssertEqual(easeOut.value(at: 1), 1)
        XCTAssertEqual(easeOut.value(at: 0.5), 0.972, accuracy: 0.002)
        // The tremble legs run the CSS ease-in-out keyword (0.42, 0, 0.58, 1),
        // symmetric about the midpoint.
        let easeInOut = StickerEnvelope.trembleEaseInOut
        XCTAssertEqual(easeInOut.value(at: 0.5), 0.5, accuracy: 1e-9)
        var previous = 0.0
        for step in 1...100 {
            let value = easeInOut.value(at: Double(step) / 100)
            XCTAssertGreaterThanOrEqual(value, previous, "easings must be monotone")
            previous = value
        }
    }

    // MARK: - The loud entrance (fade in small, balloon, tremble, settle)

    func test_entranceFadesInSmallAndBalloonsToThePinnedPeak() async {
        XCTAssertEqual(
            StickerEnvelope.entranceScale(sinceShout: 0), StickerEnvelope.entryFromScale)
        XCTAssertEqual(StickerEnvelope.entryFromScale, 0.35)
        XCTAssertEqual(StickerEnvelope.entranceOpacity(sinceShout: 0), 0)
        // The balloon leg front-loads on the web's ease-out: half the leg's time
        // buys ~97% of the rise.
        XCTAssertEqual(
            StickerEnvelope.entranceScale(sinceShout: StickerEnvelope.balloonAt / 2),
            1.856, accuracy: 0.005)
        // 16%: full presence, exactly.
        XCTAssertEqual(
            StickerEnvelope.entranceScale(sinceShout: StickerEnvelope.balloonAt),
            StickerEnvelope.balloonScale)
        XCTAssertEqual(
            StickerEnvelope.entranceOpacity(sinceShout: StickerEnvelope.balloonAt), 1)
        // The balloon IS the peak: nothing ever exceeds 1.9 (the easing is
        // monotone, unlike the retired spring's overshoot).
        var step = 0.0
        while step <= StickerEnvelope.entranceSeconds {
            XCTAssertLessThanOrEqual(
                StickerEnvelope.entranceScale(sinceShout: step),
                StickerEnvelope.balloonScale + 1e-9)
            step += 0.001
        }
    }

    func test_balloonHoldsWhileTheTrembleSwings() async {
        // From 16% to 60% the scale is EXACTLY 1.9: the tremble happens on
        // rotation alone, the glyph's size holds still.
        var at = StickerEnvelope.balloonAt
        while at <= StickerEnvelope.settleDipStartAt {
            XCTAssertEqual(
                StickerEnvelope.entranceScale(sinceShout: at), StickerEnvelope.balloonScale,
                "the balloon must hold at t=\(at)")
            at += 0.01
        }
    }

    func test_trembleHitsTheBeatsAndComposesOverTheSeededTilt() async {
        // Zero through the balloon, the pinned degrees at each beat, zero from the
        // homecoming on.
        XCTAssertEqual(StickerEnvelope.entranceTrembleDegrees(sinceShout: 0.1), 0)
        for beat in StickerEnvelope.trembleBeats {
            XCTAssertEqual(
                StickerEnvelope.entranceTrembleDegrees(sinceShout: beat.at), beat.degrees,
                accuracy: 1e-9)
        }
        // Mid-leg, ease-in-out's symmetric midpoint: halfway between 0 and +5.
        let midFirstLeg = (StickerEnvelope.balloonAt + StickerEnvelope.trembleBeats[0].at) / 2
        XCTAssertEqual(
            StickerEnvelope.entranceTrembleDegrees(sinceShout: midFirstLeg), 2.5,
            accuracy: 1e-6)
        // The whole rendered rotation is tilt PLUS tremble: the wobble swings
        // around the seeded lean, never replaces it (owner ruling 2026-07-14).
        let born = sticker(bornAt: 100)
        for beat in StickerEnvelope.trembleBeats {
            XCTAssertEqual(
                StickerEnvelope.rotationDegrees(born, at: 100 + beat.at, reduceMotion: false),
                born.tiltDegrees + beat.degrees, accuracy: 1e-9)
        }
        // And the tremble never exceeds its widest swing, so the composed angle
        // stays within 5 degrees of the tilt at every instant.
        var step = 0.0
        while step <= StickerEnvelope.entranceSeconds {
            let composed = StickerEnvelope.rotationDegrees(
                born, at: 100 + step, reduceMotion: false)
            XCTAssertLessThanOrEqual(abs(composed - born.tiltDegrees), 5 + 1e-9)
            step += 0.001
        }
    }

    func test_everyTrackEndsAtIdentity_web245() async {
        // #245/#247's lesson: no visible step at the entrance-to-rest handoff, and
        // nothing held by a fill. Just before the end the settle is within visual
        // epsilon of 1; at and past the end every value IS its resting identity.
        let horizon = StickerEnvelope.entranceSeconds
        XCTAssertEqual(
            StickerEnvelope.entranceScale(sinceShout: horizon - 1e-6), 1, accuracy: 1e-4,
            "the settle must arrive, not jump")
        XCTAssertEqual(StickerEnvelope.entranceScale(sinceShout: horizon), 1)
        XCTAssertEqual(StickerEnvelope.entranceScale(sinceShout: horizon + 3), 1)
        XCTAssertEqual(StickerEnvelope.entranceTrembleDegrees(sinceShout: horizon), 0)
        XCTAssertEqual(StickerEnvelope.entranceOpacity(sinceShout: horizon), 1)
    }

    func test_restingTransformIsIdenticalFromSettleThroughExitStart_web245() async {
        // The whole-value seam: between the entrance's end and the exit's start the
        // sticker rests at EXACTLY scale 1 and EXACTLY its seeded tilt at every
        // instant, so nothing can snap after the shout.
        let born = sticker(bornAt: 100)
        let settleEnd = 100 + StickerEnvelope.entranceSeconds
        let exitStart = born.endsAt - StickerEnvelope.exitSeconds
        var at = settleEnd
        while at <= exitStart {
            XCTAssertEqual(
                StickerEnvelope.scale(born, at: at, reduceMotion: false), 1,
                "resting scale must be exactly 1 at t=\(at)")
            XCTAssertEqual(
                StickerEnvelope.rotationDegrees(born, at: at, reduceMotion: false),
                born.tiltDegrees,
                "resting rotation must be exactly the seeded tilt at t=\(at)")
            at += 0.05
        }
    }

    // MARK: - Exit (unchanged: the web's sticker-out, 380 ms to scale 0.7, faded)

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

    // MARK: - The coalesce replay (a repeat shout, not a softer echo)

    func test_coalesceReplaysTheWholeLoudGestureFromTheRefresh() async {
        let refreshed = coalescedSticker(bornAt: 100, refreshedAt: 102)
        // Before the refresh the first gesture has settled: rest, exactly.
        XCTAssertEqual(StickerEnvelope.scale(refreshed, at: 101.9, reduceMotion: false), 1)
        // The refresh restarts the WHOLE gesture: opacity back to 0, scale to the
        // small start, then the full balloon — not the retired 1.16 echo.
        XCTAssertEqual(StickerEnvelope.opacity(refreshed, at: 102, reduceMotion: false), 0)
        XCTAssertEqual(
            StickerEnvelope.scale(refreshed, at: 102, reduceMotion: false),
            StickerEnvelope.entryFromScale)
        XCTAssertEqual(
            StickerEnvelope.scale(
                refreshed, at: 102 + StickerEnvelope.balloonAt, reduceMotion: false),
            StickerEnvelope.balloonScale,
            "a replay balloons to the full 1.9: a repeat shout, not a softer echo")
        // The replayed tremble still composes over the tilt.
        let beat = StickerEnvelope.trembleBeats[0]
        XCTAssertEqual(
            StickerEnvelope.rotationDegrees(
                refreshed, at: 102 + beat.at, reduceMotion: false),
            refreshed.tiltDegrees + beat.degrees, accuracy: 1e-9)
        // A never-coalesced sticker rests once settled: no gesture without a shout.
        let born = sticker(bornAt: 100)
        XCTAssertEqual(
            StickerEnvelope.scale(
                born, at: 100 + 2 + StickerEnvelope.balloonAt, reduceMotion: false),
            1)
    }

    // MARK: - Reduce Motion (owner spec: upright, fade-only; the web's fade pair)

    func test_reduceMotionRendersUprightAtRestingScaleAlways() async {
        let refreshed = coalescedSticker(bornAt: 100, refreshedAt: 102)
        for at in stride(from: 100.0, through: refreshed.endsAt, by: 0.25) {
            XCTAssertEqual(StickerEnvelope.scale(refreshed, at: at, reduceMotion: true), 1)
            XCTAssertEqual(
                StickerEnvelope.rotationDegrees(refreshed, at: at, reduceMotion: true), 0)
        }
        XCTAssertEqual(StickerEnvelope.tiltDegrees(refreshed, reduceMotion: true), 0)
        // The plain 180 ms fade reaches presence later than the loud ramp.
        XCTAssertLessThan(
            StickerEnvelope.opacity(refreshed, at: 100.1, reduceMotion: true),
            StickerEnvelope.opacity(refreshed, at: 100.1, reduceMotion: false))
    }
}
