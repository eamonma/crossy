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

// The observable over the gate: mosaic clock, clarity beat, stats presentation.
// The async settle (mosaic ends, stats arrive) rides real time and is exercised
// on the simulator; these pin the synchronous derivations.
@MainActor
final class CompletionModelTests: XCTestCase {
    func test_celebrationStartsTheMosaicClock_INV3() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, mosaicEnabled: true, now: 100)
        model.observe(status: .completed, live: true, mosaicEnabled: true, now: 200)
        XCTAssertEqual(model.mosaicStartedAt, 200)
        XCTAssertTrue(model.isClarityBeat)
        XCTAssertFalse(model.isStatsOpen)  // the stats arrive as the mosaic settles
    }

    func test_secondCompletedObservationNeverRestartsTheMosaic_INV3() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, mosaicEnabled: true, now: 100)
        model.observe(status: .completed, live: true, mosaicEnabled: true, now: 200)
        model.observe(status: .completed, live: true, mosaicEnabled: true, now: 300)
        XCTAssertEqual(model.mosaicStartedAt, 200)
    }

    // ID-1: the completion mosaic is muteable by a single constant; muted, the
    // celebration reduces to the stats card, no tint, no clarity beat.
    func test_mutedMosaicSwitchSkipsStraightToStats_ID1() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, mosaicEnabled: false, now: 100)
        model.observe(status: .completed, live: true, mosaicEnabled: false, now: 200)
        XCTAssertNil(model.mosaicStartedAt)
        XCTAssertFalse(model.isClarityBeat)
        XCTAssertTrue(model.isStatsOpen)
    }

    // Reduce Motion keeps the mosaic (a pure crossfade, the DESIGN.md §7
    // equivalent) and mutes the clarity beat's register swap.
    func test_reduceMotionKeepsTheMosaicAndMutesTheClarityBeat_section8() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: true, reduceMotion: true, mosaicEnabled: true, now: 100)
        model.observe(status: .completed, live: true, reduceMotion: true, mosaicEnabled: true, now: 200)
        XCTAssertEqual(model.mosaicStartedAt, 200)
        XCTAssertFalse(model.isClarityBeat)
    }

    func test_welcomeIntoCompletedGame_showsTerminalStateOnly_INV3() {
        let model = CompletionModel()
        model.observe(status: .ongoing, live: false, mosaicEnabled: true, now: 100)
        model.observe(status: .completed, live: true, mosaicEnabled: true, now: 200)
        XCTAssertNil(model.mosaicStartedAt)
        XCTAssertFalse(model.isClarityBeat)
        XCTAssertFalse(model.isStatsOpen)
    }
}
