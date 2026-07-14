// The fan's grammar, exhaustively (written before any gesture code, per the wave
// plan): hold-slide-release fires on release over an emoji and cancels anywhere else;
// releasing on the button is the tap fallback into a standing fan; a standing fan
// fires on tap, yields to a tap away, toggles closed from its own button, and folds
// after ~3 s idle. Firing always dismisses (owner ruling from the web review). The
// capsule layout's hit math is pinned beside it so render and hit test cannot drift.

import CrossyUI
import XCTest

final class ReactionFanModelTests: XCTestCase {
    // MARK: - Hold-slide-release

    func test_startsClosed() {
        let fan = ReactionFanModel()
        XCTAssertEqual(fan.phase, .closed)
        XCTAssertFalse(fan.isOpen)
    }

    func test_holdOpensImmediately() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        XCTAssertEqual(fan.phase, .heldOpen)
    }

    func test_holdMovedHighlightsTheSlotUnderTheFinger() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        fan.holdMoved(over: 2)
        XCTAssertEqual(fan.highlighted, 2)
        fan.holdMoved(over: nil)
        XCTAssertNil(fan.highlighted)
        fan.holdMoved(over: 99)
        XCTAssertNil(fan.highlighted, "an out-of-range slot never highlights")
    }

    func test_holdMovedIsIgnoredWhileClosed() {
        var fan = ReactionFanModel()
        fan.holdMoved(over: 1)
        XCTAssertNil(fan.highlighted)
        XCTAssertEqual(fan.phase, .closed)
    }

    func test_releaseOverAnEmojiFiresAndDismisses() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        fan.holdMoved(over: 0)
        let effect = fan.holdEnded(over: 0, onButton: false, at: 10)
        XCTAssertEqual(effect, .fire("🔥"), "slot 1 of the D25 defaults")
        XCTAssertEqual(fan.phase, .closed, "firing always dismisses the fan")
        XCTAssertNil(fan.highlighted)
    }

    func test_releaseElsewhereCancels() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        fan.holdMoved(over: 3)
        let effect = fan.holdEnded(over: nil, onButton: false, at: 10)
        XCTAssertEqual(effect, .none)
        XCTAssertEqual(fan.phase, .closed)
    }

    func test_releaseWithAnInvalidSlotCancels() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        let effect = fan.holdEnded(over: 99, onButton: false, at: 10)
        XCTAssertEqual(effect, .none)
        XCTAssertEqual(fan.phase, .closed)
    }

    func test_holdEndedWhileClosedIsANoOp() {
        var fan = ReactionFanModel()
        XCTAssertEqual(fan.holdEnded(over: 0, onButton: false, at: 10), .none)
        XCTAssertEqual(fan.phase, .closed)
    }

    // MARK: - The tap fallback (release on the button)

    func test_releaseOnTheButtonOpensTheStandingFan() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        let effect = fan.holdEnded(over: nil, onButton: true, at: 10)
        XCTAssertEqual(effect, .none)
        XCTAssertEqual(fan.phase, .tapOpen)
        XCTAssertEqual(fan.openedAt, 10)
    }

    func test_tapOnTheButtonTogglesAStandingFanClosed() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        _ = fan.holdEnded(over: nil, onButton: true, at: 10)
        // The second tap: hold begins on a standing fan, releases on the button.
        fan.holdBegan()
        let effect = fan.holdEnded(over: nil, onButton: true, at: 11)
        XCTAssertEqual(effect, .none)
        XCTAssertEqual(fan.phase, .closed, "the button toggles, never re-opens")
    }

    func test_holdFromAStandingFanCanStillSlideAndFire() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        _ = fan.holdEnded(over: nil, onButton: true, at: 10)
        fan.holdBegan()
        fan.holdMoved(over: 4)
        let effect = fan.holdEnded(over: 4, onButton: false, at: 12)
        XCTAssertEqual(effect, .fire("😭"), "slot 5 of the D25 defaults")
        XCTAssertEqual(fan.phase, .closed)
    }

    // MARK: - Configurable slots (D25: the fan wears the personal set)

    func test_defaultFanWearsTheD25DefaultFive_PROTOCOL9() {
        XCTAssertEqual(ReactionFanModel().emojis, ReactionPolicy.defaultSet)
        XCTAssertEqual(ReactionFanModel().emojis, ["🔥", "🤔", "🐐", "💀", "😭"])
    }

    func test_customSlotsFireTheCustomGrapheme_D25() {
        // A personal set in slot order: every fire path returns the slot's OWN
        // grapheme, so the fan is entirely set-agnostic (skin tones included:
        // distinctness and identity are the exact strings, PROTOCOL.md §12).
        let personal = ["🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶"]
        var fan = ReactionFanModel(emojis: personal)
        fan.holdBegan()
        fan.holdMoved(over: 2)
        XCTAssertEqual(fan.holdEnded(over: 2, onButton: false, at: 10), .fire("❤️‍🔥"))

        fan.holdBegan()
        _ = fan.holdEnded(over: nil, onButton: true, at: 12)
        XCTAssertEqual(fan.tapEmoji(at: 3), .fire("🇨🇦"))
    }

    // MARK: - The standing fan

    func test_tapOnAnEmojiFiresAndDismisses() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        _ = fan.holdEnded(over: nil, onButton: true, at: 10)
        let effect = fan.tapEmoji(at: 1)
        XCTAssertEqual(effect, .fire("🤔"), "slot 2 holds 🤔 in the defaults, old and new")
        XCTAssertEqual(fan.phase, .closed, "firing always dismisses the fan")
    }

    func test_tapEmojiWhileClosedIsANoOp() {
        var fan = ReactionFanModel()
        XCTAssertEqual(fan.tapEmoji(at: 1), .none)
        XCTAssertEqual(fan.phase, .closed)
    }

    func test_tapAwayClosesTheStandingFanOnly() {
        var fan = ReactionFanModel()
        fan.tapAway()
        XCTAssertEqual(fan.phase, .closed)
        fan.holdBegan()
        _ = fan.holdEnded(over: nil, onButton: true, at: 10)
        fan.tapAway()
        XCTAssertEqual(fan.phase, .closed)
    }

    func test_idleTimeoutClosesAtThreeSeconds() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        _ = fan.holdEnded(over: nil, onButton: true, at: 10)
        fan.idleExpired(at: 10 + ReactionFanModel.tapOpenIdleSeconds - 0.1)
        XCTAssertEqual(fan.phase, .tapOpen, "not idle yet")
        fan.idleExpired(at: 10 + ReactionFanModel.tapOpenIdleSeconds)
        XCTAssertEqual(fan.phase, .closed)
    }

    func test_aStaleIdleTimerCannotCloseANewerOpening() {
        var fan = ReactionFanModel()
        fan.holdBegan()
        _ = fan.holdEnded(over: nil, onButton: true, at: 20)
        // A timer scheduled against an earlier opening fires with an instant that
        // precedes this fan's deadline: validated against openedAt, it is a no-op.
        fan.idleExpired(at: 21)
        XCTAssertEqual(fan.phase, .tapOpen)
    }

    // MARK: - The capsule layout (render and hit test share one geometry)

    func test_slotCentersFallInsideTheirOwnSlots() {
        let count = ReactionPolicy.defaultSet.count
        for index in 0..<count {
            let x = ReactionFanLayout.slotCenterX(index: index, count: count)
            XCTAssertEqual(
                ReactionFanLayout.slot(atX: x, y: ReactionFanLayout.height / 2, count: count),
                index)
        }
    }

    func test_slotHitsClampWithinTheSlackAndDieBeyondIt() {
        let count = 5
        let width = ReactionFanLayout.width(count: count)
        // Just past the leading edge, inside the slack: the first slot.
        XCTAssertEqual(ReactionFanLayout.slot(atX: -5, y: 22, count: count), 0)
        // Just past the trailing edge, inside the slack: the last slot.
        XCTAssertEqual(ReactionFanLayout.slot(atX: width + 5, y: 22, count: count), count - 1)
        // Beyond the slack in x or y: off the row.
        XCTAssertNil(
            ReactionFanLayout.slot(
                atX: -ReactionFanLayout.holdSlack - 1, y: 22, count: count))
        XCTAssertNil(
            ReactionFanLayout.slot(
                atX: 22, y: ReactionFanLayout.height + ReactionFanLayout.holdSlack + 1,
                count: count))
    }

    func test_slotSizeMeetsTheTouchFloor() {
        // 44 pt minimum tap target (the design-engineering floor); the hold-slide
        // slack widens it further for the occluding thumb.
        XCTAssertGreaterThanOrEqual(ReactionFanLayout.slotSize, 44)
    }
}
