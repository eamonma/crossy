// The 36-unit cell module (root DESIGN.md §10, Wave 2.1d), the cross-client module contract:
// clue number top-left (+2,+10), teammate presence anchored bottom-right, direction arrow
// top-right (+27,+3), avatar puck bottom-right (center +30,+30, radius 5), count badge in the
// same bottom-right slot (center +29,+29, radius 7). Twin of the iOS GridModule; every value is
// in module units and the grid scales one module to pixels by a single unit factor. These are
// render constants (not wire types), so restating them here is the module contract, not a
// redefinition. Values in Float for Compose draw math.

package crossy.ui

object GridModule {
    /** The cell module edge, in module units (DESIGN.md §10: "a 36-unit cell module scaled to fit"). */
    const val UNIT: Float = 36f

    // Clue number, top-left (Wave 2.1d: +2,+10 baseline, 10-unit type).
    const val NUMBER_LEADING: Float = 2f
    const val NUMBER_BASELINE: Float = 10f
    const val NUMBER_FONT_SIZE: Float = 10f

    // Entry glyph, centered (web baseline parity: 24-unit type).
    const val GLYPH_FONT_SIZE: Float = 24f

    // Circles (DESIGN.md §10: inset rings). Shaded circles are a soft achromatic wash.
    const val CIRCLE_RADIUS: Float = UNIT / 2.1f
    const val CIRCLE_STROKE: Float = 0.8f
    const val SHADE_ALPHA: Float = 0.18f

    // Presence, bottom-right stack (Wave 2.1d).
    const val ARROW_ORIGIN_X: Float = 27f
    const val ARROW_ORIGIN_Y: Float = 3f
    const val ARROW_SIZE: Float = 7f
    const val AVATAR_CENTER_X: Float = 30f
    const val AVATAR_CENTER_Y: Float = 30f
    const val AVATAR_RADIUS: Float = 5f
    const val AVATAR_INITIAL_FONT_SIZE: Float = 8f
    const val BADGE_CENTER_X: Float = 29f
    const val BADGE_CENTER_Y: Float = 29f
    const val BADGE_RADIUS: Float = 7f
    const val BADGE_COUNT_FONT_SIZE: Float = 9f

    // Lines: cell hairline (web parity: 0.6 stroke) and the closing outer frame (2 units).
    const val HAIRLINE: Float = 0.6f
    const val FRAME_STROKE: Float = 2f

    // Background overlay alphas, derived from real tokens (the cursor's roster color), never
    // invented paints: the current cell and its active word are washes of cursorTint so the
    // selection reads at a glance. Tuning is a design-pass concern.
    const val CURRENT_ALPHA: Float = 0.30f
    const val ACTIVE_WORD_ALPHA: Float = 0.13f
    const val TEAMMATE_ALPHA: Float = 0.10f
}
