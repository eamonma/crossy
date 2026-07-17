// The post-game analysis surface's one warm note (twin of apps/ios AnalysisPalette.swift). Chrome
// emphasis is achromatic everywhere else (DESIGN.md §3: the only color the room carries is presence, a
// person passing beneath the glass), but the completion panel earns a gold exactly as the web panel
// does (owner ruling 2026-07-13, the approved mock): the "Solved together" eyebrow, the momentum
// curve, the break marker, the door on the finished clue bar. Paired per ground like the roster colors
// (ID-8), tuned to hold on bone and on void so neither ground washes the accent out. Plain RGBColor
// values, so the palette pins the same on any surface; :ui maps to Compose Color at the draw site.

package crossy.ui

import crossy.design.RGBColor

/** The analysis surface's gold, paired per ground (ID-8). The one warm note the completion panel
 *  earns; every other chrome emphasis stays achromatic (DESIGN.md §3). Twin of the iOS AnalysisPalette. */
object AnalysisPalette {
    /** The gold for lines and marks: the momentum curve, the break dot and its halo, the stat frame's
     *  quiet accents. Brighter on the dark ground, where a muted gold would sink into the void. */
    fun gold(ground: GridGround): RGBColor =
        if (ground.isDark) RGBColor(0xC6A24E) else RGBColor(0xA6812F)

    /** The gold for text: eyebrows and caps labels, a touch quieter than the line gold so a run of
     *  small caps reads as a label, not an alarm. */
    fun goldText(ground: GridGround): RGBColor =
        if (ground.isDark) RGBColor(0xC9B27E) else RGBColor(0x7C6738)

    /** The sand wash the ribbon lays under the room's longest pause (the stall span), quiet enough to
     *  read as shading rather than a second mark. */
    fun stallWash(ground: GridGround): RGBColor =
        if (ground.isDark) RGBColor(0x3A3320) else RGBColor(0xE9E0CD)

    /** The faint gold ground behind the finished clue bar's Analysis door: presence, not a fill. */
    fun doorWash(ground: GridGround): RGBColor =
        if (ground.isDark) RGBColor(0x2A2416) else RGBColor(0xF2ECDB)
}
