import XCTest

@testable import CrossyUI

// The celebration fires on the store's status TRANSITION, exactly once (INV-3):
// never on render, never again on a reconnect into an already-completed game. The
// gate is a pure fold over observed (status, live) pairs, so every scripted store
// transition pins headlessly; CompletionModel is the thin observable over it.

final class CelebrationGateTests: XCTestCase {
    func test_liveTransitionToCompleted_firesExactlyOnce_INV3() {
        var gate = CelebrationGate()
        XCTAssertFalse(gate.observe(status: .ongoing, live: false))  // connecting
        XCTAssertFalse(gate.observe(status: .ongoing, live: true))  // welcome
        XCTAssertTrue(gate.observe(status: .completed, live: true))  // gameCompleted
        XCTAssertFalse(gate.observe(status: .completed, live: true))
        XCTAssertFalse(gate.observe(status: .completed, live: true))
    }

    // A welcome snapshot of an already-completed game shows the terminal state
    // without replaying the celebration: the store was never live over an ongoing
    // board, so the gate never opens.
    func test_reconnectIntoCompletedGame_neverCelebrates_INV3() {
        var gate = CelebrationGate()
        XCTAssertFalse(gate.observe(status: .ongoing, live: false))  // connecting
        XCTAssertFalse(gate.observe(status: .completed, live: true))  // welcome, terminal
        XCTAssertFalse(gate.observe(status: .completed, live: true))
    }

    // Completion inside a resync gap arrives by snapshot, not event; the solver
    // was in the live room, so the celebration still fires, once.
    func test_completionLearnedFromResyncSnapshot_firesOnce_INV3() {
        var gate = CelebrationGate()
        XCTAssertFalse(gate.observe(status: .ongoing, live: true))
        XCTAssertFalse(gate.observe(status: .ongoing, live: false))  // resyncing
        XCTAssertTrue(gate.observe(status: .completed, live: true))  // sync snapshot
        XCTAssertFalse(gate.observe(status: .completed, live: true))
    }

    // After the celebration, a drop and reconnect welcome re-expose the completed
    // board; the gate stays shut forever.
    func test_reconnectAfterCelebration_neverReplays_INV3() {
        var gate = CelebrationGate()
        _ = gate.observe(status: .ongoing, live: true)
        XCTAssertTrue(gate.observe(status: .completed, live: true))
        XCTAssertFalse(gate.observe(status: .completed, live: false))  // reconnecting
        XCTAssertFalse(gate.observe(status: .completed, live: true))  // welcome again
    }

    func test_abandonedIsTerminalWithoutCelebration_INV3() {
        var gate = CelebrationGate()
        XCTAssertFalse(gate.observe(status: .ongoing, live: true))
        XCTAssertFalse(gate.observe(status: .abandoned, live: true))
        XCTAssertFalse(gate.observe(status: .abandoned, live: true))
    }

    // The gate is a fold over observations, so re-feeding the same state (two
    // onChange observers read one store) can never double-fire: firing is a
    // transition fact, not a render fact.
    func test_repeatedIdenticalObservationsAreIdempotent_INV3() {
        var gate = CelebrationGate()
        for _ in 0..<3 {
            XCTAssertFalse(gate.observe(status: .ongoing, live: true))
        }
        XCTAssertTrue(gate.observe(status: .completed, live: true))
        for _ in 0..<5 {
            XCTAssertFalse(gate.observe(status: .completed, live: true))
        }
    }
}

// The observable over the gate: the celebration's instant (the one-shot riders'
// key: the §7 completion haptic and the confetti), and the DEFERRED mosaic clock.
// The bloom no longer starts on observe (owner ruling 2026-07-13): it paints
// first-correct colors from GET /analysis, so the solve screen calls startMosaic
// once the bundle lands, and the settle arms the analysis panel's summon. The
// async settle rides real time and is exercised on the simulator; these pin the
// synchronous derivations.
@MainActor
final class CompletionModelTests: XCTestCase {
    // observe() fires the gate's instant (the haptic and confetti key on it) but
    // NOT the mosaic: the bloom waits for startMosaic and the first-correct colors.
    func test_celebrationFiresTheGateInstant_butDefersTheMosaic_INV3() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, now: 100)
        model.observe(status: .completed, live: true, now: 200)
        XCTAssertEqual(model.celebrationFiredAt, 200)
        XCTAssertNil(model.mosaicStartedAt, "the bloom waits for startMosaic")
        XCTAssertEqual(model.summonToken, 0, "no summon before the bloom settles")
    }

    // startMosaic paints the deferred bloom and opens the clarity beat (inert below
    // iOS 26). It is the solve screen's ready-branch call.
    func test_startMosaicPaintsTheBloom() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, now: 100)
        model.observe(status: .completed, live: true, now: 200)
        model.startMosaic(summonOnSettle: true, now: 200)
        XCTAssertEqual(model.mosaicStartedAt, 200)
        XCTAssertTrue(model.isClarityBeat)
    }

    // startMosaic arms exactly once: the ready and absent branches may both reach
    // it, but only the first bloom stands, so a second call never restarts it.
    func test_startMosaicArmsOnce_neverRestarts() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, now: 100)
        model.observe(status: .completed, live: true, now: 200)
        model.startMosaic(summonOnSettle: true, now: 200)
        model.startMosaic(summonOnSettle: false, now: 300)
        XCTAssertEqual(model.mosaicStartedAt, 200)
    }

    // ID-1: a muted mosaic derives no tint and no clarity beat, but a muted switch
    // must not swallow the panel: an armed summon still lands at once.
    func test_mutedMosaicDerivesNoTintButStillSummons_ID1() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, now: 100)
        model.observe(status: .completed, live: true, now: 200)
        model.startMosaic(summonOnSettle: true, mosaicEnabled: false, now: 200)
        XCTAssertNil(model.mosaicStartedAt)
        XCTAssertFalse(model.isClarityBeat)
        XCTAssertEqual(model.summonToken, 1)
    }

    // Reduce Motion keeps the mosaic (a pure crossfade, the DESIGN.md §7
    // equivalent) and mutes the clarity beat's register swap.
    func test_reduceMotionKeepsTheMosaicAndMutesTheClarityBeat_section8() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, reduceMotion: true, now: 100)
        model.observe(status: .completed, live: true, reduceMotion: true, now: 200)
        model.startMosaic(summonOnSettle: true, reduceMotion: true, now: 200)
        XCTAssertEqual(model.mosaicStartedAt, 200)
        XCTAssertFalse(model.isClarityBeat)
    }

    // A welcome into an already-completed game shows the terminal state only: the
    // gate never fires, so there is no celebration instant and the solve screen
    // never calls startMosaic (it gates on celebrationFiredAt).
    func test_welcomeIntoCompletedGame_showsTerminalStateOnly_INV3() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: false, now: 100)
        model.observe(status: .completed, live: true, now: 200)
        XCTAssertNil(model.mosaicStartedAt)
        XCTAssertFalse(model.isClarityBeat)
        XCTAssertNil(model.celebrationFiredAt)
    }
}
