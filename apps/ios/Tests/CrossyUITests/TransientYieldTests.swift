import XCTest

@testable import CrossyUI

// Transient panels yield to intent (apps/ios/DESIGN.md §4, owner ruling
// 2026-07-10). The room's own moments count as intent: the one observed
// transition into a terminal status pours back the melt and the roster. The
// trigger is a pure fold (the CelebrationGate pattern) and the melt half
// respects a live finger (SP-i1: the finger owns progress), both pinned
// headlessly here; the touch routing itself lives at the gesture sites.

final class TerminalPourBackGateTests: XCTestCase {
    func test_firesExactlyOnceOnTheTransitionToCompleted_section4() {
        var gate = TerminalPourBackGate()
        XCTAssertFalse(gate.observe(.ongoing))
        XCTAssertFalse(gate.observe(.ongoing))
        XCTAssertTrue(gate.observe(.completed))
        XCTAssertFalse(gate.observe(.completed))
    }

    func test_abandonedPoursBackTheSameWay_section4() {
        var gate = TerminalPourBackGate()
        XCTAssertFalse(gate.observe(.ongoing))
        XCTAssertTrue(gate.observe(.abandoned))
        XCTAssertFalse(gate.observe(.abandoned))
    }

    // A reconnect whose first observation is already terminal had no open
    // room on screen, so there is nothing to pour back: the gate stays shut.
    func test_welcomeIntoTerminalRoomNeverFires_section4() {
        var gate = TerminalPourBackGate()
        XCTAssertFalse(gate.observe(.completed))
        XCTAssertFalse(gate.observe(.completed))
    }

    // Two onChange observers read one store (status and sync), so a terminal
    // status arrives repeatedly; the pour-back is a transition fact, never a
    // render fact.
    func test_repeatedTerminalObservationsNeverRefire_section4() {
        var gate = TerminalPourBackGate()
        _ = gate.observe(.ongoing)
        XCTAssertTrue(gate.observe(.completed))
        for _ in 0..<5 {
            XCTAssertFalse(gate.observe(.completed))
        }
    }
}

@MainActor
final class MeltPourBackTests: XCTestCase {
    // SP-i1's law: nothing but the finger writes progress while a drag owns
    // the melt, so a forced pour-back (another panel opening, a terminal
    // status landing mid-drag) leaves a dragged melt exactly where it is.
    func test_pourBack_neverForceClosesADraggedMelt_SPi1() {
        let chrome = RoomChromeModel()
        chrome.meltProgress = 0.6
        chrome.isMeltDragging = true
        chrome.pourBackMeltUnlessDragging(animated: false)
        XCTAssertEqual(chrome.meltProgress, 0.6)
    }

    func test_pourBack_poursAStillMelt_section4() {
        let chrome = RoomChromeModel()
        chrome.meltProgress = 0.6
        // animated: false is the cut (Reduce Motion, tests): no walk to await.
        chrome.pourBackMeltUnlessDragging(animated: false)
        XCTAssertEqual(chrome.meltProgress, 0)
    }

    // The release path stays the melt's own: once the finger lifts (the view
    // clears isMeltDragging before settling), a pour-back applies again.
    func test_pourBack_appliesAgainAfterTheFingerLifts_SPi1() {
        let chrome = RoomChromeModel()
        chrome.meltProgress = 0.6
        chrome.isMeltDragging = true
        chrome.pourBackMeltUnlessDragging(animated: false)
        XCTAssertEqual(chrome.meltProgress, 0.6)
        chrome.isMeltDragging = false
        chrome.pourBackMeltUnlessDragging(animated: false)
        XCTAssertEqual(chrome.meltProgress, 0)
    }
}
