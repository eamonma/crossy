// The sticker book's semantics (PROTOCOL.md §9; root DESIGN.md D24), pinned with injected time so
// no test owns a clock. Twin of apps/ios ReactionModelTests.swift: the five-second decay,
// receive-any versus the send-gated 5/s sliding window, coalescing (replay the shout in place,
// refresh the timer, never a new sprite), the four-per-cell pile cap, and the born-correct placement
// rules from the web review (seeded from the stable key alone, immutable for life, incumbents hold
// still when a newcomer lands). Here the book is pure transforms on an immutable list, so each rule
// reads as a value in / value out.

package crossy.ui

import kotlin.math.abs
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ReactionModelTests {
    @Test
    fun decayConstantIsFiveSeconds_PROTOCOL9() {
        assertEquals(5.0, ReactionPolicy.DECAY_SECONDS, 1e-9)
    }

    @Test
    fun defaultSendSetIsTheD25Graphemes_PROTOCOL9() {
        assertEquals(listOf("🔥", "🤔", "🐐", "💀", "😭"), ReactionPolicy.defaultSet)
    }

    // --- Receive-any, send-gated (PROTOCOL.md §9) ---

    @Test
    fun placeRendersAnEmojiOutsideTheSendSet_PROTOCOL9() {
        // 🎉 sits outside the D25 defaults now; receive-any renders it regardless.
        val out = ReactionBook.place(emptyList(), "bee", "🎉", 3, 100.0)
        assertEquals(listOf("🎉"), out.map { it.emoji })
    }

    @Test
    fun placesAreNeverRateCapped_PROTOCOL9() {
        // The book itself caps nothing (the server caps each SENDER); a lively room's combined
        // inbound stream renders in full, only the pile cap shapes it.
        var stickers = emptyList<ReactionSticker>()
        for (index in 0 until 8) {
            stickers = ReactionBook.place(stickers, "u$index", "🎉", index, 100.0)
        }
        assertEquals(8, stickers.size)
    }

    @Test
    fun sendCapIsAFiveSlidingWindow_PROTOCOL5() {
        var sentAt = emptyList<Double>()
        for (step in 0 until 5) {
            val now = 100.0 + step * 0.1
            assertTrue(ReactionSendCap.allows(sentAt, now))
            sentAt = ReactionSendCap.record(sentAt, now)
        }
        // The sixth inside the window: refused.
        assertFalse(ReactionSendCap.allows(sentAt, 100.5))
        // The window slides: once the first send ages past one second, room opens.
        assertTrue(ReactionSendCap.allows(sentAt, 101.05))
    }

    // --- Decay (PROTOCOL.md §9: ~5 seconds, then gone) ---

    @Test
    fun sweepRetiresAStickerAfterTheDecay_PROTOCOL9() {
        val born = ReactionBook.place(emptyList(), "bee", "🎉", 3, 100.0)
        assertEquals(1, ReactionBook.sweep(born, 104.9).size, "still inside its five seconds")
        assertTrue(ReactionBook.sweep(born, 105.0).isEmpty(), "gone at bornAt + decay")
    }

    @Test
    fun nextExpiryIsTheSoonestEnd() {
        assertNull(ReactionBook.nextExpiry(emptyList()))
        var stickers = ReactionBook.place(emptyList(), "bee", "🎉", 3, 100.0)
        stickers = ReactionBook.place(stickers, "ada", "👀", 4, 102.0)
        assertEquals(105.0, ReactionBook.nextExpiry(stickers)!!, 1e-9)
    }

    // --- Coalescing (PROTOCOL.md §9: repeats coalesce, never stack sprites) ---

    @Test
    fun repeatFromOneSenderCoalescesInPlace_PROTOCOL9() {
        val bornList = ReactionBook.place(emptyList(), "bee", "🎉", 3, 100.0)
        val born = bornList[0]

        val refreshedList = ReactionBook.place(bornList, "bee", "🎉", 3, 102.0)
        assertEquals(1, refreshedList.size, "never a new sprite")
        val refreshed = refreshedList[0]
        assertEquals(born.id, refreshed.id)
        assertEquals(born.bornAt, refreshed.bornAt, "a coalesce never rewrites the birth")
        assertEquals(102.0, refreshed.refreshedAt, 1e-9, "the loud replay rides the refresh instant")
        assertEquals(107.0, refreshed.endsAt, 1e-9, "the timer refreshes")
        // Born-correct: placement is untouched by the coalesce.
        assertEquals(born.offsetX, refreshed.offsetX)
        assertEquals(born.offsetY, refreshed.offsetY)
        assertEquals(born.tiltDegrees, refreshed.tiltDegrees)
    }

    @Test
    fun differentSendersNeverCoalesce_PROTOCOL9() {
        var stickers = ReactionBook.place(emptyList(), "bee", "🎉", 3, 100.0)
        stickers = ReactionBook.place(stickers, "ada", "🎉", 3, 100.5)
        assertEquals(2, stickers.size, "coalesce keys on sender+emoji+cell")
    }

    @Test
    fun repeatAfterExpiryIsAFreshSticker() {
        var stickers = ReactionBook.place(emptyList(), "bee", "🎉", 3, 100.0)
        stickers = ReactionBook.place(stickers, "bee", "🎉", 3, 106.0)
        stickers = ReactionBook.sweep(stickers, 106.0)
        assertEquals(1, stickers.size)
        assertEquals(106.0, stickers[0].bornAt, "past its life, a repeat is a new birth")
    }

    // --- The pile cap (owner spec: at most 4 visible, newest replaces oldest) ---

    @Test
    fun fifthStickerInACellStartsTheStalestOnesExit() {
        var stickers = emptyList<ReactionSticker>()
        listOf("a", "b", "c", "d").forEachIndexed { index, user ->
            stickers = ReactionBook.place(stickers, user, "🎉", 3, 100.0 + index)
        }
        stickers = ReactionBook.place(stickers, "e", "🎉", 3, 104.0)

        assertEquals(5, stickers.size, "the evictee leaves through the exit fade")
        val evicted = stickers.first { it.userId == "a" }
        assertEquals(104.0 + StickerEnvelope.EXIT_SECONDS, evicted.endsAt, 1e-9, "the oldest incumbent is clamped to an immediate exit")
        val standing = stickers.count { it.endsAt > 104.0 + StickerEnvelope.EXIT_SECONDS }
        assertEquals(4, standing, "at most four keep standing")
    }

    @Test
    fun incumbentsHoldStillWhenANewcomerLands() {
        var stickers = ReactionBook.place(emptyList(), "a", "🎉", 3, 100.0)
        stickers = ReactionBook.place(stickers, "b", "👀", 3, 101.0)
        val before = stickers.map { Triple(it.id, it.offsetX to it.offsetY, it.tiltDegrees) }

        stickers = ReactionBook.place(stickers, "c", "💀", 3, 102.0)

        for ((id, offset, tilt) in before) {
            val now = stickers.first { it.id == id }
            assertEquals(offset.first, now.offsetX)
            assertEquals(offset.second, now.offsetY)
            assertEquals(tilt, now.tiltDegrees)
        }
    }

    // --- Born-correct seeding ---

    @Test
    fun placementIsSeededFromTheKeyAloneNeverFromThePile() {
        // The same sticker key lands identically whether it arrives alone or fourth into a crowd.
        val lone = ReactionBook.place(emptyList(), "bee", "🎉", 3, 100.0)[0]

        var crowded = ReactionBook.place(emptyList(), "a", "👀", 3, 90.0)
        crowded = ReactionBook.place(crowded, "b", "💀", 3, 91.0)
        crowded = ReactionBook.place(crowded, "c", "🫡", 3, 92.0)
        crowded = ReactionBook.place(crowded, "bee", "🎉", 3, 100.0)
        val piled = crowded.first { it.userId == "bee" }

        assertEquals(lone.offsetX, piled.offsetX)
        assertEquals(lone.offsetY, piled.offsetY)
        assertEquals(lone.tiltDegrees, piled.tiltDegrees)
    }

    @Test
    fun placementStaysInsideTheWebParityBounds() {
        var stickers = emptyList<ReactionSticker>()
        for (index in 0 until 40) {
            stickers = ReactionBook.place(stickers, "u$index", "🎉", index, 100.0)
        }
        for (sticker in stickers) {
            assertTrue(abs(sticker.offsetX - ReactionSticker.ANCHOR_X_UNITS) <= ReactionSticker.SCATTER_UNITS + 1e-9)
            assertTrue(abs(sticker.offsetY - ReactionSticker.ANCHOR_Y_UNITS) <= ReactionSticker.SCATTER_UNITS + 1e-9)
            assertTrue(abs(sticker.tiltDegrees) >= ReactionSticker.MIN_TILT_DEGREES - 1e-9)
            assertTrue(abs(sticker.tiltDegrees) <= ReactionSticker.MAX_TILT_DEGREES + 1e-9)
        }
    }

    @Test
    fun oneIdentityNeverHoldsTwoStickers() {
        // The render layer keys on the sticker id, so an expired same-key sticker the sweep has not
        // yet retired must leave when its successor is born: one identity, one sticker, always.
        var stickers = ReactionBook.place(emptyList(), "bee", "🎉", 3, 100.0)
        stickers = ReactionBook.place(stickers, "bee", "🎉", 3, 106.0)
        assertEquals(1, stickers.size)
        assertEquals(106.0, stickers[0].bornAt)
    }
}
