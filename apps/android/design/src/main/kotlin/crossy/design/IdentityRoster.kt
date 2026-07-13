// Mirrors apps/ios/Sources/CrossyDesign/IdentityRoster.swift. The twelve-color identity
// roster (apps/ios/DESIGN.md §3, ID-8): the only color in the system. Each color is a
// light-ground/dark-ground pair, tuned to hold on bone and on void, distinct at 12 px in
// the corner of a cell. Values are a starting set pending the on-device contrast pass; the
// structure (12, paired per ground, hash-indexed) does not move.
//
// Ratification status: the hash (IdentityHash.fnv1a32) is the ratified cross-client
// contract (root DESIGN.md §8; canonical code apps/session/src/color.ts). The roster and
// the mod-12 slot mapping below are PROPOSED by apps/ios/DESIGN.md §3 and await
// ratification with the web workstream: today the server derives the wire color directly as
// `hash & 0xffffff` formatted `#RRGGBB` (colorForUser in color.ts) and clients render that
// string; no palette exists on the web side yet. Once ratified, the roster moves to shared
// ground and both clients index it the same way.
package crossy.design

/// One roster entry: a name and its ground pair.
data class IdentityColor(
    val name: String,
    val lightGround: RGBColor,
    val darkGround: RGBColor,
)

object IdentityRoster {
    val violet = IdentityColor("violet", RGBColor(0x6F66D4), RGBColor(0x9D95FF))
    val poppy = IdentityColor("poppy", RGBColor(0xDE5722), RGBColor(0xFF7A50))
    val teal = IdentityColor("teal", RGBColor(0x17917F), RGBColor(0x3BC7B4))
    val magenta = IdentityColor("magenta", RGBColor(0xC2497D), RGBColor(0xE06B9E))
    val ochre = IdentityColor("ochre", RGBColor(0xC98A1B), RGBColor(0xE0A93E))
    val cobalt = IdentityColor("cobalt", RGBColor(0x3D6BD6), RGBColor(0x6E93E8))
    val moss = IdentityColor("moss", RGBColor(0x6B8F3C), RGBColor(0x90B45E))
    val rust = IdentityColor("rust", RGBColor(0xB0503C), RGBColor(0xD97862))
    val plum = IdentityColor("plum", RGBColor(0x8A4E9E), RGBColor(0xB278C6))
    val cyan = IdentityColor("cyan", RGBColor(0x2596A8), RGBColor(0x4FBCCE))
    val coral = IdentityColor("coral", RGBColor(0xE06A5A), RGBColor(0xF4917F))
    val slate = IdentityColor("slate", RGBColor(0x5E6B8C), RGBColor(0x8C99BA))

    /// The roster in slot order, exactly the apps/ios/DESIGN.md §3 table order. Slot order
    /// is part of the (proposed) cross-client contract: reordering reassigns everyone's
    /// color.
    val colors: List<IdentityColor> = listOf(
        violet, poppy, teal, magenta, ochre, cobalt,
        moss, rust, plum, cyan, coral, slate,
    )

    /// Roster slot for a user: `fnv1a32(user_id) mod 12`. Deterministic and
    /// device-independent, so the same user resolves to the same slot everywhere (root
    /// DESIGN.md §8). PROPOSED mapping, pending ratification (header note).
    fun slot(userId: String): Int =
        (IdentityHash.fnv1a32(userId) % colors.size.toUInt()).toInt()

    /// The roster color for a user, via `slot`.
    fun color(userId: String): IdentityColor = colors[slot(userId)]

    /// Roster slot from the wire color string (PROTOCOL.md §4 participant `color`). The
    /// server derives that string from the identity hash (`hash & 0xffffff` formatted
    /// `#RRGGBB`, apps/session/src/color.ts) and the server's string is authoritative:
    /// slotting from it keeps every client on the same slot given the same wire, even if a
    /// local hash port drifted. Note this and `slot` take different residues (low 24 bits vs
    /// the full hash, mod 12); wherever a wire string exists it wins, and `slot` is the
    /// offline fallback. Returns null unless the string is exactly `#` plus six ASCII hex
    /// digits (case-insensitive, folded bytewise per INV-1).
    fun slotForWireColor(color: String): Int? {
        val bytes = color.encodeToByteArray()
        if (bytes.size != 7 || bytes[0].toInt() != '#'.code) return null
        var value = 0u
        for (i in 1 until bytes.size) {
            val byte = bytes[i].toInt()
            val digit: Int = when (byte) {
                in '0'.code..'9'.code -> byte - '0'.code
                in 'A'.code..'F'.code -> byte - 'A'.code + 10
                in 'a'.code..'f'.code -> byte - 'a'.code + 10
                else -> return null
            }
            value = (value shl 4) or digit.toUInt()
        }
        return (value % colors.size.toUInt()).toInt()
    }

    /// The roster color for a wire color string, via `slotForWireColor`.
    fun colorForWireColor(color: String): IdentityColor? =
        slotForWireColor(color)?.let { colors[it] }
}
