package crossy.design

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// Mirrors apps/ios/Tests/CrossyDesignTests/IdentityRosterTests.swift. Pins the roster
// structure and values against the apps/ios/DESIGN.md §3 table (ID-8: twelve paired colors,
// hash-indexed; values tune on device, structure is fixed). Order is part of the proposed
// cross-client contract: reordering reassigns every user's color.
class IdentityRosterTests {
    private data class RosterRow(val name: String, val light: Int, val dark: Int)

    // The DESIGN.md §3 table, verbatim: name, light ground, dark ground.
    private val table = listOf(
        RosterRow("violet", 0x6F66D4, 0x9D95FF),
        RosterRow("poppy", 0xDE5722, 0xFF7A50),
        RosterRow("teal", 0x17917F, 0x3BC7B4),
        RosterRow("magenta", 0xC2497D, 0xE06B9E),
        RosterRow("ochre", 0xC98A1B, 0xE0A93E),
        RosterRow("cobalt", 0x3D6BD6, 0x6E93E8),
        RosterRow("moss", 0x6B8F3C, 0x90B45E),
        RosterRow("rust", 0xB0503C, 0xD97862),
        RosterRow("plum", 0x8A4E9E, 0xB278C6),
        RosterRow("cyan", 0x2596A8, 0x4FBCCE),
        RosterRow("coral", 0xE06A5A, 0xF4917F),
        RosterRow("slate", 0x5E6B8C, 0x8C99BA),
    )

    // ID-8: the structure is fixed at twelve.
    @Test
    fun rosterHasTwelveColors_ID8() {
        assertEquals(12, IdentityRoster.colors.size)
    }

    // Every entry matches the DESIGN.md §3 table exactly, in table order.
    @Test
    fun rosterMatchesDesignTable_namesOrderAndValues_ID8() {
        assertEquals(table.size, IdentityRoster.colors.size)
        for ((index, expected) in table.withIndex()) {
            val color = IdentityRoster.colors[index]
            assertEquals(expected.name, color.name, "slot $index name")
            assertEquals(expected.light, color.lightGround.rgb24, "${expected.name} light ground")
            assertEquals(expected.dark, color.darkGround.rgb24, "${expected.name} dark ground")
        }
    }

    // Paired per ground: every entry carries a distinct light and dark value, and no two
    // entries collide on either ground (distinctness is what makes the roster legible at 12
    // px).
    @Test
    fun rosterPairsAreDistinctPerGround_ID8() {
        for (color in IdentityRoster.colors) {
            assertNotEquals(color.lightGround, color.darkGround, "${color.name} pair collapsed")
        }
        assertEquals(12, IdentityRoster.colors.map { it.lightGround }.toSet().size)
        assertEquals(12, IdentityRoster.colors.map { it.darkGround }.toSet().size)
        assertEquals(12, IdentityRoster.colors.map { it.name }.toSet().size)
    }

    // Every hash lands in a valid slot (root DESIGN.md §8: total function of user_id, no
    // fallback color path).
    @Test
    fun slotIsAlwaysInRange_rootDESIGN8() {
        for (userId in listOf("", "a", "9f46807f-c1c5-4b8d-8302-2e1dfb51e30f", "z".repeat(64))) {
            val slot = IdentityRoster.slot(userId)
            assertTrue(slot in 0 until 12, "slot $slot out of range for $userId")
        }
    }

    // Hex round-trip sanity for the value type the roster is built from.
    @Test
    fun rgbColorHexFormatting() {
        assertEquals("#6F66D4", RGBColor(0x6F66D4).hexString)
        assertEquals("#000000", RGBColor(0x000000).hexString)
        assertEquals("#00000F", RGBColor(0x00000F).hexString)
        assertEquals("#FFFFFF", RGBColor(0xFFFFFF).hexString)
        assertEquals(0x9D95FF, RGBColor(red = 0x9D, green = 0x95, blue = 0xFF).rgb24)
    }

    // ARGB packing: the opaque 32-bit form :ui feeds Compose `Color(argb)`; alpha is 0xFF.
    @Test
    fun rgbColorArgbIsOpaque() {
        assertEquals(0xFF6F66D4.toInt(), RGBColor(0x6F66D4).argb)
        assertEquals(0xFF000000.toInt(), RGBColor(0x000000).argb)
        assertEquals(0xFFFFFFFF.toInt(), RGBColor(0xFFFFFF).argb)
    }

    // Wire-color slotting (PROTOCOL.md §4 participant `color`; the server's string is
    // authoritative, root DESIGN.md §8): the slot is the 24-bit value mod 12.
    @Test
    fun slotForWireColor_takesTheLow24BitResidue() {
        assertEquals(0, IdentityRoster.slotForWireColor("#000000"))
        assertEquals(11, IdentityRoster.slotForWireColor("#00000B"))
        assertEquals(0, IdentityRoster.slotForWireColor("#00000C"))
        // 0x7F77DD = 8353757 = 12 * 696146 + 5 (the PROTOCOL.md §4 example color).
        assertEquals(5, IdentityRoster.slotForWireColor("#7F77DD"))
        assertEquals(
            IdentityRoster.colors[5].name,
            IdentityRoster.colorForWireColor("#7F77DD")?.name,
        )
    }

    // Hex digits fold bytewise, case-insensitive (INV-1: ASCII-only, no locale).
    @Test
    fun slotForWireColor_acceptsBothHexCases_INV1() {
        assertEquals(
            IdentityRoster.slotForWireColor("#a1b2c3"),
            IdentityRoster.slotForWireColor("#A1B2C3"),
        )
    }

    // Anything but `#` plus six ASCII hex digits is rejected; callers fall back to the
    // user-id hash, so a malformed wire never crashes or forks a color.
    @Test
    fun slotForWireColor_rejectsMalformedStrings() {
        for (wire in listOf("", "#", "7F77DD", "#7F77D", "#7F77DDA", "#7G77DD", "#7F77Dé", "teal")) {
            assertNull(IdentityRoster.slotForWireColor(wire), "accepted $wire")
            assertNull(IdentityRoster.colorForWireColor(wire), "accepted $wire")
        }
    }
}
