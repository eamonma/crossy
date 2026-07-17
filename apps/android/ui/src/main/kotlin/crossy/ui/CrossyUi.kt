// The :ui edge maps :design's plain values to Compose types (ARCHITECTURE.md: ":design stays
// JVM-pure by holding values; :ui maps values to Compose types at the edge"). This file owns the
// two mappings every surface here shares: an RGBColor to a Compose Color, and the ground selection
// (Studio / Observatory) that pairs a token set with the roster-color side it reads. Twin of the
// iOS GridGround; the tokens themselves live in :design and are never restated.

package crossy.ui

import androidx.compose.ui.graphics.Color
import crossy.design.Ground
import crossy.design.GroundTokens
import crossy.design.IdentityColor
import crossy.design.RGBColor
import crossy.design.TypeScale

/** The one color conversion: an opaque sRGB token to a Compose Color via the packed ARGB int
 *  :design already computes (RGBColor.argb, alpha fixed at 0xFF). Defined once so no surface
 *  hand-rolls a channel split. */
fun RGBColor.toColor(): Color = Color(argb)

/**
 * The board ground (DESIGN.md §5, ID-6): Studio is the light chassis, Observatory the night. Two
 * renders of one drawing, driven by tokens, never two code paths. Carries the token set plus the
 * one bit the tokens do not: which side of the identity-color pairs this ground reads (ID-8).
 * Twin of the iOS GridGround.
 */
enum class GridGround {
    STUDIO,
    OBSERVATORY,
    ;

    /** The paper tokens for this ground (:design Grounds). */
    val tokens: GroundTokens
        get() = when (this) {
            STUDIO -> Ground.studio
            OBSERVATORY -> Ground.observatory
        }

    val isDark: Boolean get() = this == OBSERVATORY

    /** The roster pair side for this ground (DESIGN.md §3: twelve colors, paired per ground). */
    fun rosterColor(identity: IdentityColor): RGBColor =
        if (isDark) identity.darkGround else identity.lightGround

    /** Grid glyph weight, CSS-axis numeric from TypeScale (600 on Studio, 500 on Observatory:
     *  dark grounds fatten type, DESIGN.md §6). Mapped to a Compose FontWeight at the draw site. */
    val glyphWeight: Int
        get() = if (isDark) TypeScale.gridGlyphWeightDarkGround else TypeScale.gridGlyphWeightLightGround
}
