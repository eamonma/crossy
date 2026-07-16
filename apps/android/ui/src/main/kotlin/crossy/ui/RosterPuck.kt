// The roster puck, the one participant mark the whole app shares (twin of iOS RosterPuck.swift): a
// colored circle in the person's roster color, their initial in the paper's cell tone, and, when it
// has resolved, their avatar image clipped to the circle over the top (PROTOCOL.md §4). The initial
// is always the floor: a null url, a url still loading, and a url that failed all render as the
// initial, and the image returns the moment it arrives.
//
// Pure composition, split along the seam that matters. This file takes the avatar as RESOLVED data
// (a Compose ImageBitmap, or null) and knows nothing about fetching, caching, or OkHttp, so it
// renders the same anywhere. The live bridge that reads a url-keyed cache and hands this the current
// image lives in :app (AvatarImageCache), the AAD-2 split iOS holds between RosterPuckBody and the
// cache. The color comes from the user id (the identity-hash fallback the roster already uses when
// no wire color is in hand, DESIGN.md §3); the Settings and onboarding pucks have no wire color, so
// the id is the whole story.

package crossy.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.design.IdentityRoster
import crossy.protocol.asciiUppercase

/**
 * The puck as pixels: a circle in the person's roster color, the initial in the paper's `cell`
 * tone, and the avatar clipped over the top when it has resolved. A pure function of the passed
 * data; `avatar` null is the colored initial, the first-class fallback a null, loading, or failed
 * url gets everywhere (PROTOCOL.md §4). The 1.5 dp ring wraps the whole stack so it frames the
 * image the same as the initial.
 *
 * @param userId  the roster-color source (the identity hash; DESIGN.md §3).
 * @param displayName  the initial source; empty renders the colored circle alone.
 * @param avatar  the resolved image, or null for the initial. The live surface passes the cache's
 *   current image (AvatarImageCache in :app); a preview passes null and shows the initial.
 * @param contentDescription  the reader's name for a standalone puck that conveys identity on its
 *   own; null (the default) hides it, the decorative case beside an already-labeled row or the bar
 *   cluster (iOS RosterPuck body is accessibilityHidden(true); the cluster carries the combined
 *   label instead). Every current call site shows the name adjacent, so all pass null.
 */
@Composable
fun RosterPuck(
    userId: String,
    displayName: String,
    ground: GridGround,
    diameter: Dp,
    modifier: Modifier = Modifier,
    avatar: ImageBitmap? = null,
    contentDescription: String? = null,
) {
    val fill = ground.rosterColor(IdentityRoster.color(userId)).toColor()
    val cell = ground.tokens.cell.toColor()
    Box(
        modifier = modifier
            .then(
                if (contentDescription == null) Modifier.clearAndSetSemantics {}
                else Modifier.semantics { this.contentDescription = contentDescription },
            )
            .size(diameter)
            .clip(CircleShape)
            .background(fill)
            .border(1.5.dp, cell, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        val initial = puckInitial(displayName)
        if (initial.isNotEmpty()) {
            Text(
                text = initial,
                color = cell,
                fontWeight = FontWeight.Bold,
                // The iOS ratio (diameter * 0.42); a dp-to-sp read is close enough and holds the
                // circle at the puck's fixed size.
                fontSize = (diameter.value * 0.42f).sp,
            )
        }
        if (avatar != null) {
            Image(
                bitmap = avatar,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(diameter).clip(CircleShape),
            )
        }
    }
}

/** The puck's initial: the display name's first character, ASCII-uppercased via :protocol (INV-1;
 *  a non-ASCII initial passes through verbatim), empty when the name is empty (the colored circle
 *  stands alone). The same rule Presence.initialOf pins for the on-board cursor puck, restated here
 *  as the puck's own contract so the fallback is greppable and unit-tested against this surface. */
internal fun puckInitial(displayName: String): String {
    if (displayName.isEmpty()) return ""
    return asciiUppercase(displayName.substring(0, 1))
}
