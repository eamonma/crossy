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

    func test_connecting_dimsWithoutACountdown_preWelcomeIsNotAReconnect() {
        let weather = RoomWeather.from(sync: .connecting)
        XCTAssertEqual(weather.dot, .dimmed)
        XCTAssertTrue(weather.boardDimmed)
        XCTAssertFalse(weather.showsCountdown)
        XCTAssertEqual(weather.label, "Connecting")
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
