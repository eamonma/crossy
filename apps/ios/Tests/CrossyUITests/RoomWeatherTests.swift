import Foundation
import XCTest

import CrossyStore

@testable import CrossyUI

// Honest weather (apps/ios/DESIGN.md §8; the three states are PROTOCOL.md §7's):
// live is a calm dot, resyncing is a breathing dot AND NOTHING ELSE (the board
// keeps its last truth until the snapshot lands), reconnecting dims the room with
// a quiet countdown. Connecting (client-local, pre-first-welcome) dims without a
// countdown. What changes on the board versus the chrome per state is exactly what
// these tests pin.

final class RoomWeatherTests: XCTestCase {
    func test_live_isACalmDotAndNothingChanges_design8() {
        let weather = RoomWeather.from(sync: .live)
        XCTAssertEqual(weather.dot, .calm)
        XCTAssertFalse(weather.boardDimmed)
        XCTAssertFalse(weather.showsCountdown)
        XCTAssertNil(weather.label)
    }

    func test_resyncing_breathesOnChromeOnly_theBoardHoldsItsTruth_protocol7() {
        let weather = RoomWeather.from(sync: .resyncing)
        XCTAssertEqual(weather.dot, .breathing)
        // The board does not dim: sequenced state stays rendered until the sync
        // snapshot replaces it wholesale.
        XCTAssertFalse(weather.boardDimmed)
        XCTAssertFalse(weather.showsCountdown)
        XCTAssertNil(weather.label)
    }

    func test_reconnecting_dimsTheRoomWithAQuietCountdown_design8() {
        let weather = RoomWeather.from(sync: .reconnecting)
        XCTAssertEqual(weather.dot, .dimmed)
        XCTAssertTrue(weather.boardDimmed)
        XCTAssertTrue(weather.showsCountdown)
        XCTAssertEqual(weather.label, "Reconnecting")
    }

    // The FIRST connect is the terse, quiet register (redesign 2026-07-11, DESIGN.md
    // §8: the room's law is a hush, never a spinner). A reconnect names itself and
    // counts down because a person LOST something mid-solve; a first join has lost
    // nothing, so the pill carries no word and no countdown, only the dimmed dot beside
    // the clock. The board still dims (honestly not live yet), but the pill stays quiet,
    // so its width never snaps narrow when the welcome lands.
    func test_connecting_isTheTerseQuietRegister_noWordNoCountdown_design8() {
        let weather = RoomWeather.from(sync: .connecting)
        XCTAssertEqual(weather.dot, .dimmed)
        XCTAssertTrue(weather.boardDimmed)
        XCTAssertFalse(weather.showsCountdown, "a first join has lost nothing to count toward")
        XCTAssertNil(weather.label, "the terse first-connect pill carries no status word")
    }

    // A first connect and a reconnect diverge honestly: only the reconnect names itself
    // and counts down (the pill's width change on reconnect is then a real event, not a
    // first-frame guess). The distinction is pinned so the two registers never re-merge.
    func test_firstConnectAndReconnectDivergeOnTheWordAndTheCountdown_design8() {
        let first = RoomWeather.from(sync: .connecting)
        let again = RoomWeather.from(sync: .reconnecting)
        XCTAssertNil(first.label)
        XCTAssertFalse(first.showsCountdown)
        XCTAssertEqual(again.label, "Reconnecting")
        XCTAssertTrue(again.showsCountdown)
        XCTAssertEqual(first.dot, again.dot, "both are the dimmed dot; the word is the difference")
    }

    func test_countdownSeconds_ceilsAndFloorsAtZero() {
        let now = Date(timeIntervalSinceReferenceDate: 1000)
        XCTAssertNil(RoomWeather.countdownSeconds(retryAt: nil, now: now))
        XCTAssertEqual(
            RoomWeather.countdownSeconds(retryAt: now.addingTimeInterval(2.4), now: now), 3)
        XCTAssertEqual(
            RoomWeather.countdownSeconds(retryAt: now.addingTimeInterval(-5), now: now), 0)
    }

    func test_reconnectLine_isPlainAndWarm_id5() {
        let now = Date(timeIntervalSinceReferenceDate: 1000)
        XCTAssertEqual(
            RoomWeather.reconnectLine(retryAt: now.addingTimeInterval(2.4), now: now),
            "Back in 3s")
        // No deadline, or one already passed, reads as the bare state word: the
        // room never promises a number it does not have.
        XCTAssertEqual(RoomWeather.reconnectLine(retryAt: nil, now: now), "Reconnecting")
        XCTAssertEqual(
            RoomWeather.reconnectLine(retryAt: now.addingTimeInterval(-1), now: now),
            "Reconnecting")
    }

    func test_boardDim_isAWashNotABlackout() {
        // The room never dims dead (DESIGN.md §4): the wash must leave the grid
        // clearly readable behind it.
        XCTAssertLessThan(RoomWeather.boardDimOpacity, 0.6)
        XCTAssertGreaterThan(RoomWeather.boardDimOpacity, 0.2)
    }
}

// The reconnect overlay grace (Track A-ios, PROTOCOL.md §7): the non-live pair
// (resyncing, reconnecting) surfaces its weather only after the connection has
// been continuously non-live for RoomWeather.reconnectOverlayGraceSeconds, and
// hides the instant it recovers. Railway's edge recycles a healthy socket on a
// schedule and reconnect-and-resync heals in ~200 ms, so a bare recycle must
// never flash the overlay. Pure and clock-injected, pinned headlessly here.
final class ReconnectOverlayGateTests: XCTestCase {
    private let epoch = Date(timeIntervalSinceReferenceDate: 1000)
    private var grace: Double { RoomWeather.reconnectOverlayGraceSeconds }

    func test_graceMatchesTheWebConstant_2000ms_protocol7() {
        // The iOS window is the twin of the web's RECONNECT_OVERLAY_GRACE_MS.
        XCTAssertEqual(RoomWeather.reconnectOverlayGraceSeconds, 2)
    }

    func test_nonLivePairIsWithheldUntilTheGraceElapses_protocol7() {
        var gate = ReconnectOverlayGate()
        gate.observe(.reconnecting, now: epoch)
        // Just short of the window: still presented as live (no overlay).
        XCTAssertFalse(gate.overlayPresented(now: epoch.addingTimeInterval(grace - 0.001)))
        XCTAssertEqual(
            gate.presentedSync(.reconnecting, now: epoch.addingTimeInterval(grace - 0.001)), .live)
        // At the window it surfaces its true register.
        XCTAssertTrue(gate.overlayPresented(now: epoch.addingTimeInterval(grace)))
        XCTAssertEqual(
            gate.presentedSync(.reconnecting, now: epoch.addingTimeInterval(grace)), .reconnecting)
    }

    func test_resyncingIsGatedByTheSameWindow_protocol7() {
        var gate = ReconnectOverlayGate()
        gate.observe(.resyncing, now: epoch)
        XCTAssertEqual(
            gate.presentedSync(.resyncing, now: epoch.addingTimeInterval(grace - 0.5)), .live)
        XCTAssertEqual(
            gate.presentedSync(.resyncing, now: epoch.addingTimeInterval(grace)), .resyncing)
    }

    func test_recoveryHidesTheOverlayImmediately_protocol7() {
        var gate = ReconnectOverlayGate()
        gate.observe(.reconnecting, now: epoch)
        // Recover well past the window: live clears the origin, so the overlay is
        // gone at once with no lingering grace.
        gate.observe(.live, now: epoch.addingTimeInterval(grace + 5))
        XCTAssertNil(gate.nonLiveSince)
        XCTAssertFalse(gate.overlayPresented(now: epoch.addingTimeInterval(grace + 5)))
        XCTAssertEqual(gate.presentedSync(.live, now: epoch.addingTimeInterval(grace + 5)), .live)
    }

    func test_bounceBetweenTheNonLivePairSharesOneOrigin_noFlicker_protocol7() {
        var gate = ReconnectOverlayGate()
        gate.observe(.resyncing, now: epoch)
        // A gap that becomes a drop mid-grace: the origin does NOT move, so the
        // window is measured from the first non-live instant, never restarted.
        gate.observe(.reconnecting, now: epoch.addingTimeInterval(1.5))
        XCTAssertEqual(gate.nonLiveSince, epoch)
        // Still withheld a hair before the ORIGINAL deadline.
        XCTAssertEqual(
            gate.presentedSync(.reconnecting, now: epoch.addingTimeInterval(grace - 0.001)), .live)
        // Surfaces at the original deadline, in its current register.
        XCTAssertEqual(
            gate.presentedSync(.reconnecting, now: epoch.addingTimeInterval(grace)), .reconnecting)
    }

    func test_connectingIsNeverGated_theFirstConnectKeepsItsQuietRegister_protocol7() {
        var gate = ReconnectOverlayGate()
        // A first connect passes through untouched (a first join has lost nothing,
        // DESIGN.md §8); it never stamps a non-live origin.
        gate.observe(.connecting, now: epoch)
        XCTAssertNil(gate.nonLiveSince)
        XCTAssertEqual(gate.presentedSync(.connecting, now: epoch.addingTimeInterval(grace)), .connecting)
    }

    func test_secondsUntilPresented_isTheRemainingWindowThenNil() throws {
        var gate = ReconnectOverlayGate()
        XCTAssertNil(gate.secondsUntilPresented(now: epoch), "live has nothing to wake for")
        gate.observe(.reconnecting, now: epoch)
        XCTAssertEqual(
            try XCTUnwrap(gate.secondsUntilPresented(now: epoch)), grace, accuracy: 0.0001)
        XCTAssertEqual(
            try XCTUnwrap(gate.secondsUntilPresented(now: epoch.addingTimeInterval(1.5))),
            grace - 1.5, accuracy: 0.0001)
        // Once the window has elapsed the overlay already shows, so there is
        // nothing left to schedule.
        XCTAssertNil(gate.secondsUntilPresented(now: epoch.addingTimeInterval(grace)))
    }
}

// The chrome model owns the grace-gated presentation the room feeds into
// RoomWeather.from (Track A-ios). Clock-injected so the flip is pinned without a
// real sleep; the one-shot wake it arms merely re-runs this same recompute at the
// deadline. Presentation only: the store's SyncState is never touched.
@MainActor
final class ReconnectGraceModelTests: XCTestCase {
    private let epoch = Date(timeIntervalSinceReferenceDate: 1000)
    private var grace: Double { RoomWeather.reconnectOverlayGraceSeconds }

    func test_presentedSyncWithholdsThePairUntilTheGraceElapses_protocol7() {
        let chrome = RoomChromeModel()
        chrome.observeReconnectGrace(.live, now: epoch)
        XCTAssertEqual(chrome.presentedSync, .live)
        // Drop: within the window the room still reads live (no overlay, input on).
        chrome.observeReconnectGrace(.reconnecting, now: epoch)
        XCTAssertEqual(chrome.presentedSync, .live)
        chrome.observeReconnectGrace(.reconnecting, now: epoch.addingTimeInterval(grace - 0.5))
        XCTAssertEqual(chrome.presentedSync, .live)
        // At the window the true register surfaces.
        chrome.observeReconnectGrace(.reconnecting, now: epoch.addingTimeInterval(grace))
        XCTAssertEqual(chrome.presentedSync, .reconnecting)
    }

    func test_recoveryRevertsPresentedSyncImmediately_protocol7() {
        let chrome = RoomChromeModel()
        chrome.observeReconnectGrace(.reconnecting, now: epoch)
        chrome.observeReconnectGrace(.reconnecting, now: epoch.addingTimeInterval(grace))
        XCTAssertEqual(chrome.presentedSync, .reconnecting)
        // Welcome lands: back to live at once, and the pending wake is cancelled.
        chrome.observeReconnectGrace(.live, now: epoch.addingTimeInterval(grace + 0.2))
        XCTAssertEqual(chrome.presentedSync, .live)
    }

    func test_bounceKeepsOneSharedTimer_noFlicker_protocol7() {
        let chrome = RoomChromeModel()
        chrome.observeReconnectGrace(.resyncing, now: epoch)
        // A resyncing-to-reconnecting bounce mid-grace stays withheld against the
        // ORIGINAL origin, never restarting the window.
        chrome.observeReconnectGrace(.reconnecting, now: epoch.addingTimeInterval(1.5))
        XCTAssertEqual(chrome.presentedSync, .live)
        chrome.observeReconnectGrace(.reconnecting, now: epoch.addingTimeInterval(grace))
        XCTAssertEqual(chrome.presentedSync, .reconnecting)
    }
}
