import XCTest

@testable import CrossyDesign
@testable import CrossyUI

// The completion confetti (owner ask 2026-07-11) is pure math riding the
// celebration's one instant (INV-3 gate): deterministic field, analytic poses,
// a hard end. Reduce Motion skips the drift whole; the ID-1-style mute switch
// governs it independently of the mosaic. All pinned headlessly here.

final class ConfettiFieldTests: XCTestCase {
    private let palette = [RGBColor(0xE5_484D), RGBColor(0x3E_63DD), RGBColor(0x97_8365)]

    func test_sameSeedBuildsTheSameDrift_deterministic() {
        let a = ConfettiField.make(colors: palette, seed: 7)
        let b = ConfettiField.make(colors: palette, seed: 7)
        XCTAssertEqual(a, b)
        XCTAssertEqual(a.flecks.count, ConfettiEnvelope.fleckCount)
    }

    func test_emptyPaletteYieldsNoDrift() {
        let field = ConfettiField.make(colors: [])
        XCTAssertTrue(field.flecks.isEmpty)
    }

    func test_everyFleckIndexesInsideThePalette() {
        let field = ConfettiField.make(colors: palette)
        for fleck in field.flecks {
            XCTAssertTrue((0..<palette.count).contains(fleck.colorIndex))
        }
    }

    func test_fleckEntersAboveTheStageAndExitsBelow() {
        let field = ConfettiField.make(colors: palette)
        for fleck in field.flecks {
            let entry = ConfettiEnvelope.pose(fleck, elapsed: fleck.delay)
            XCTAssertNotNil(entry)
            XCTAssertLessThan(entry!.unitY, 0, "a fleck spawns above the stage")
            let exit = ConfettiEnvelope.pose(fleck, elapsed: fleck.delay + fleck.fall)
            XCTAssertNotNil(exit)
            XCTAssertGreaterThan(exit!.unitY, 1, "a fleck leaves below the stage")
        }
    }

    func test_poseIsNilBeforeEntryAndAfterExit() {
        let field = ConfettiField.make(colors: palette)
        let fleck = field.flecks[0]
        XCTAssertNil(ConfettiEnvelope.pose(fleck, elapsed: fleck.delay - 0.01))
        XCTAssertNil(ConfettiEnvelope.pose(fleck, elapsed: fleck.delay + fleck.fall + 0.01))
    }

    func test_alphaStaysInRangeAndDiesAtTheEnd() {
        let field = ConfettiField.make(colors: palette)
        for fleck in field.flecks {
            for step in 0...20 {
                let t = fleck.delay + fleck.fall * Double(step) / 20
                guard let pose = ConfettiEnvelope.pose(fleck, elapsed: t) else { continue }
                XCTAssertGreaterThanOrEqual(pose.alpha, 0)
                XCTAssertLessThanOrEqual(pose.alpha, 1)
            }
            let last = ConfettiEnvelope.pose(fleck, elapsed: fleck.delay + fleck.fall)
            XCTAssertEqual(last!.alpha, 0, accuracy: 1e-9, "the drift ends invisible")
        }
    }

    func test_nothingOutlivesTheEnvelopeDuration() {
        let field = ConfettiField.make(colors: palette)
        for fleck in field.flecks {
            XCTAssertLessThanOrEqual(
                fleck.delay + fleck.fall, ConfettiEnvelope.duration,
                "the overlay's unmount clock covers every fleck")
        }
    }
}

// The model's confetti clock: a one-shot rider on the gate's firing (INV-3),
// muted whole by Reduce Motion, independent of the mosaic's ID-1 switch.
@MainActor
final class CompletionModelConfettiTests: XCTestCase {
    func test_confettiRidesTheCelebrationInstant_INV3() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, now: 100)
        model.observe(status: .completed, live: true, now: 200)
        XCTAssertEqual(model.confettiStartedAt, 200)
    }

    func test_reduceMotionSkipsTheConfettiWhole_whileTheCelebrationStillFires() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, reduceMotion: true, now: 100)
        model.observe(status: .completed, live: true, reduceMotion: true, now: 200)
        XCTAssertNil(model.confettiStartedAt)
        XCTAssertEqual(model.celebrationFiredAt, 200)
    }

    func test_confettiPlaysWithTheMosaicMuted_ID1IsAboutTint() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, now: 100)
        model.observe(status: .completed, live: true, now: 200)
        XCTAssertEqual(model.confettiStartedAt, 200)
        // The mosaic is deferred now (owner ruling 2026-07-13): observe never tints,
        // and a muted mosaic (ID-1) never tints even when armed.
        XCTAssertNil(model.mosaicStartedAt)
        model.startMosaic(summonOnSettle: true, mosaicEnabled: false, now: 200)
        XCTAssertNil(model.mosaicStartedAt, "a muted mosaic derives no tint")
    }

    func test_confettiMuteSwitchSilencesOnlyTheDrift() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, confettiEnabled: false, now: 100)
        model.observe(status: .completed, live: true, confettiEnabled: false, now: 200)
        XCTAssertNil(model.confettiStartedAt)
        XCTAssertEqual(model.celebrationFiredAt, 200)
        // The mosaic no longer rides observe; it plays once armed (the ready branch).
        XCTAssertNil(model.mosaicStartedAt)
        model.startMosaic(summonOnSettle: false, now: 200)
        XCTAssertEqual(model.mosaicStartedAt, 200)
    }

    func test_reconnectIntoCompletedGameNeverDrifts_INV3() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: false, now: 100)
        model.observe(status: .completed, live: true, now: 200)
        XCTAssertNil(model.confettiStartedAt)
    }
}
