import XCTest

import CrossyDesign

@testable import CrossyUI

// The conflict flash (PROTOCOL.md §8, D02): ~300 ms in the writer's color, sharp
// attack and long decay, and muteable at the source by the ID-1 switch. The envelope
// is pure math over elapsed time, so every property pins headlessly.

final class GridFlashTests: XCTestCase {
    private let red = RGBColor(0xDE5722)

    // The envelope spans Motion.Flash's ~300 ms (PROTOCOL.md §8).
    func test_envelopeDurationMatchesMotionTokens() {
        XCTAssertEqual(FlashEnvelope.duration, 0.300, accuracy: 0.0001)
        XCTAssertEqual(
            Motion.Flash.attackDuration + Motion.Flash.decayDuration,
            Motion.Flash.duration, accuracy: 0.0001)
    }

    func test_envelope_sharpAttackReachesFullTint() {
        XCTAssertEqual(FlashEnvelope.opacity(elapsed: 0), 0)
        XCTAssertEqual(FlashEnvelope.opacity(elapsed: 0.025), 0.5, accuracy: 0.01)
        XCTAssertEqual(FlashEnvelope.opacity(elapsed: 0.050), 1.0, accuracy: 0.01)
    }

    func test_envelope_decayIsMonotonicAndEndsClear() {
        var previous = 1.0
        for step in 1...25 {
            let elapsed = 0.050 + 0.010 * Double(step)
            let opacity = FlashEnvelope.opacity(elapsed: elapsed)
            XCTAssertLessThanOrEqual(opacity, previous + 0.0001, "t=\(elapsed)")
            previous = opacity
        }
        XCTAssertEqual(FlashEnvelope.opacity(elapsed: 0.300), 0)
        XCTAssertEqual(FlashEnvelope.opacity(elapsed: 1.0), 0)
    }

    // Sharp attack, long decay (apps/ios/DESIGN.md §7): halfway through the decay
    // the tint must already be quiet, never a linear fade.
    func test_envelope_decayFrontLoadsTheFade() {
        let midDecay = FlashEnvelope.opacity(elapsed: 0.050 + 0.125)
        XCTAssertLessThan(midDecay, 0.25)
        XCTAssertGreaterThan(midDecay, 0)
    }

    func test_record_holdsTheWritersColor_ID1() {
        var book = FlashBook()
        book.record(cell: 7, color: red, at: 100, colorInMotionEnabled: true)
        XCTAssertEqual(book.flashes[7], GridFlash(color: red, startedAt: 100))
        XCTAssertEqual(book.opacity(cell: 7, at: 100.05)!, 1.0, accuracy: 0.01)
    }

    // ID-1: color in motion is behind a single switch; muted means no flash is even
    // recorded, so nothing can leak through a later draw.
    func test_record_mutedSwitchDropsTheTrigger_ID1() {
        var book = FlashBook()
        book.record(cell: 7, color: red, at: 100, colorInMotionEnabled: false)
        XCTAssertTrue(book.isEmpty)
        XCTAssertNil(book.opacity(cell: 7, at: 100.05))
    }

    func test_record_latestWriterReplacesTheFlashInFlight() {
        var book = FlashBook()
        let teal = RGBColor(0x17917F)
        book.record(cell: 7, color: red, at: 100, colorInMotionEnabled: true)
        book.record(cell: 7, color: teal, at: 100.1, colorInMotionEnabled: true)
        XCTAssertEqual(book.flashes[7], GridFlash(color: teal, startedAt: 100.1))
    }

    func test_sweep_dropsOnlyEndedEnvelopes() {
        var book = FlashBook()
        book.record(cell: 1, color: red, at: 100, colorInMotionEnabled: true)
        book.record(cell: 2, color: red, at: 100.2, colorInMotionEnabled: true)
        book.sweep(at: 100.35)
        XCTAssertNil(book.flashes[1])
        XCTAssertNotNil(book.flashes[2])
    }

    func test_opacity_nilWhenNothingInFlight() {
        XCTAssertNil(FlashBook().opacity(cell: 3, at: 0))
    }
}
