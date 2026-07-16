// The fan's grammar, exhaustively (written before any gesture code). Twin of apps/ios
// ReactionFanModelTests.swift: hold-slide-release fires on release over an emoji and cancels
// anywhere else; releasing on the button is the tap fallback into a standing fan; a standing fan
// fires on tap, yields to a tap away, toggles closed from its own button, and folds after ~3 s idle.
// Firing always dismisses (owner ruling from the web review). The capsule layout's hit math is
// pinned beside it so render and hit test cannot drift. The Kotlin model is a pure value type, so
// each transition returns the next model (or a Step carrying the effect).

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ReactionFanModelTests {
    // --- Hold-slide-release ---

    @Test
    fun startsClosed() {
        val fan = ReactionFanModel()
        assertEquals(ReactionFanModel.Phase.CLOSED, fan.phase)
        assertFalse(fan.isOpen)
    }

    @Test
    fun holdOpensImmediately() {
        val fan = ReactionFanModel().holdBegan()
        assertEquals(ReactionFanModel.Phase.HELD_OPEN, fan.phase)
    }

    @Test
    fun holdMovedHighlightsTheSlotUnderTheFinger() {
        var fan = ReactionFanModel().holdBegan()
        fan = fan.holdMoved(over = 2)
        assertEquals(2, fan.highlighted)
        fan = fan.holdMoved(over = null)
        assertNull(fan.highlighted)
        fan = fan.holdMoved(over = 99)
        assertNull(fan.highlighted, "an out-of-range slot never highlights")
    }

    @Test
    fun holdMovedIsIgnoredWhileClosed() {
        val fan = ReactionFanModel().holdMoved(over = 1)
        assertNull(fan.highlighted)
        assertEquals(ReactionFanModel.Phase.CLOSED, fan.phase)
    }

    @Test
    fun releaseOverAnEmojiFiresAndDismisses() {
        var fan = ReactionFanModel().holdBegan()
        fan = fan.holdMoved(over = 0)
        val step = fan.holdEnded(over = 0, onButton = false, now = 10.0)
        assertEquals(ReactionFanModel.Effect.Fire("🔥"), step.effect, "slot 1 of the D25 defaults")
        assertEquals(ReactionFanModel.Phase.CLOSED, step.model.phase, "firing always dismisses the fan")
        assertNull(step.model.highlighted)
    }

    @Test
    fun releaseElsewhereCancels() {
        var fan = ReactionFanModel().holdBegan()
        fan = fan.holdMoved(over = 3)
        val step = fan.holdEnded(over = null, onButton = false, now = 10.0)
        assertEquals(ReactionFanModel.Effect.None, step.effect)
        assertEquals(ReactionFanModel.Phase.CLOSED, step.model.phase)
    }

    @Test
    fun releaseWithAnInvalidSlotCancels() {
        val fan = ReactionFanModel().holdBegan()
        val step = fan.holdEnded(over = 99, onButton = false, now = 10.0)
        assertEquals(ReactionFanModel.Effect.None, step.effect)
        assertEquals(ReactionFanModel.Phase.CLOSED, step.model.phase)
    }

    @Test
    fun holdEndedWhileClosedIsANoOp() {
        val fan = ReactionFanModel()
        val step = fan.holdEnded(over = 0, onButton = false, now = 10.0)
        assertEquals(ReactionFanModel.Effect.None, step.effect)
        assertEquals(ReactionFanModel.Phase.CLOSED, step.model.phase)
    }

    // --- The tap fallback (release on the button) ---

    @Test
    fun releaseOnTheButtonOpensTheStandingFan() {
        val fan = ReactionFanModel().holdBegan()
        val step = fan.holdEnded(over = null, onButton = true, now = 10.0)
        assertEquals(ReactionFanModel.Effect.None, step.effect)
        assertEquals(ReactionFanModel.Phase.TAP_OPEN, step.model.phase)
        assertEquals(10.0, step.model.openedAt)
    }

    @Test
    fun tapOnTheButtonTogglesAStandingFanClosed() {
        var fan = ReactionFanModel().holdBegan()
        fan = fan.holdEnded(over = null, onButton = true, now = 10.0).model
        // The second tap: hold begins on a standing fan, releases on the button.
        fan = fan.holdBegan()
        val step = fan.holdEnded(over = null, onButton = true, now = 11.0)
        assertEquals(ReactionFanModel.Effect.None, step.effect)
        assertEquals(ReactionFanModel.Phase.CLOSED, step.model.phase, "the button toggles, never re-opens")
    }

    @Test
    fun holdFromAStandingFanCanStillSlideAndFire() {
        var fan = ReactionFanModel().holdBegan()
        fan = fan.holdEnded(over = null, onButton = true, now = 10.0).model
        fan = fan.holdBegan()
        fan = fan.holdMoved(over = 4)
        val step = fan.holdEnded(over = 4, onButton = false, now = 12.0)
        assertEquals(ReactionFanModel.Effect.Fire("😭"), step.effect, "slot 5 of the D25 defaults")
        assertEquals(ReactionFanModel.Phase.CLOSED, step.model.phase)
    }

    // --- Configurable slots (D25: the fan wears the personal set) ---

    @Test
    fun defaultFanWearsTheD25DefaultFive_PROTOCOL9() {
        assertEquals(ReactionPolicy.defaultSet, ReactionFanModel().emojis)
        assertEquals(listOf("🔥", "🤔", "🐐", "💀", "😭"), ReactionFanModel().emojis)
    }

    @Test
    fun customSlotsFireTheCustomGrapheme_D25() {
        // A personal set in slot order: every fire path returns the slot's OWN grapheme, so the fan
        // is entirely set-agnostic (skin tones included: distinctness and identity are the exact
        // strings, PROTOCOL.md §12).
        val personal = listOf("🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶")
        var fan = ReactionFanModel(emojis = personal).holdBegan()
        fan = fan.holdMoved(over = 2)
        assertEquals(ReactionFanModel.Effect.Fire("❤️‍🔥"), fan.holdEnded(over = 2, onButton = false, now = 10.0).effect)

        fan = ReactionFanModel(emojis = personal).holdBegan()
        fan = fan.holdEnded(over = null, onButton = true, now = 12.0).model
        assertEquals(ReactionFanModel.Effect.Fire("🇨🇦"), fan.tapEmoji(at = 3).effect)
    }

    // --- The standing fan ---

    @Test
    fun tapOnAnEmojiFiresAndDismisses() {
        var fan = ReactionFanModel().holdBegan()
        fan = fan.holdEnded(over = null, onButton = true, now = 10.0).model
        val step = fan.tapEmoji(at = 1)
        assertEquals(ReactionFanModel.Effect.Fire("🤔"), step.effect, "slot 2 holds 🤔 in the defaults")
        assertEquals(ReactionFanModel.Phase.CLOSED, step.model.phase, "firing always dismisses the fan")
    }

    @Test
    fun tapEmojiWhileClosedIsANoOp() {
        val fan = ReactionFanModel()
        val step = fan.tapEmoji(at = 1)
        assertEquals(ReactionFanModel.Effect.None, step.effect)
        assertEquals(ReactionFanModel.Phase.CLOSED, step.model.phase)
    }

    @Test
    fun tapAwayClosesTheStandingFanOnly() {
        var fan = ReactionFanModel().tapAway()
        assertEquals(ReactionFanModel.Phase.CLOSED, fan.phase)
        fan = ReactionFanModel().holdBegan()
        fan = fan.holdEnded(over = null, onButton = true, now = 10.0).model
        fan = fan.tapAway()
        assertEquals(ReactionFanModel.Phase.CLOSED, fan.phase)
    }

    @Test
    fun idleTimeoutClosesAtThreeSeconds() {
        var fan = ReactionFanModel().holdBegan()
        fan = fan.holdEnded(over = null, onButton = true, now = 10.0).model
        fan = fan.idleExpired(now = 10.0 + ReactionFanModel.TAP_OPEN_IDLE_SECONDS - 0.1)
        assertEquals(ReactionFanModel.Phase.TAP_OPEN, fan.phase, "not idle yet")
        fan = fan.idleExpired(now = 10.0 + ReactionFanModel.TAP_OPEN_IDLE_SECONDS)
        assertEquals(ReactionFanModel.Phase.CLOSED, fan.phase)
    }

    @Test
    fun aStaleIdleTimerCannotCloseANewerOpening() {
        var fan = ReactionFanModel().holdBegan()
        fan = fan.holdEnded(over = null, onButton = true, now = 20.0).model
        // A timer scheduled against an earlier opening fires with an instant that precedes this
        // fan's deadline: validated against openedAt, it is a no-op.
        fan = fan.idleExpired(now = 21.0)
        assertEquals(ReactionFanModel.Phase.TAP_OPEN, fan.phase)
    }

    // --- The capsule layout (render and hit test share one geometry) ---

    @Test
    fun slotCentersFallInsideTheirOwnSlots() {
        val count = ReactionPolicy.defaultSet.size
        for (index in 0 until count) {
            val x = ReactionFanLayout.slotCenterX(index, count)
            assertEquals(index, ReactionFanLayout.slot(atX = x, y = ReactionFanLayout.height / 2, count = count))
        }
    }

    @Test
    fun slotHitsClampWithinTheSlackAndDieBeyondIt() {
        val count = 5
        val width = ReactionFanLayout.width(count)
        assertEquals(0, ReactionFanLayout.slot(atX = -5.0, y = 22.0, count = count))
        assertEquals(count - 1, ReactionFanLayout.slot(atX = width + 5, y = 22.0, count = count))
        assertNull(ReactionFanLayout.slot(atX = -ReactionFanLayout.HOLD_SLACK - 1, y = 22.0, count = count))
        assertNull(
            ReactionFanLayout.slot(
                atX = 22.0,
                y = ReactionFanLayout.height + ReactionFanLayout.HOLD_SLACK + 1,
                count = count,
            ),
        )
    }

    @Test
    fun slotSizeMeetsTheTouchFloor() {
        // 44 dp minimum tap target (the design-engineering floor); the hold-slide slack widens it.
        assertEquals(true, ReactionFanLayout.SLOT_SIZE >= 44.0)
    }
}
