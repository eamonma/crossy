// A Material3 theme whose color scheme is built entirely from :design tokens, so every M3 control
// in the shell (buttons, text fields, cards) inherits real Crossy values and never the framework's
// default purple. The only color in the system is the roster (ID-8); accents borrow one roster
// color, everything else is paper (Grounds). This keeps the Wave A4 bar honest: no invented colors,
// no type the design system does not name. The display face and the full type ramp are a later
// track; body type stays the platform default here.

package crossy.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import crossy.design.IdentityRoster

/** Wrap shell and room content so M3 components read Crossy tokens. `ground` picks Studio or
 *  Observatory; the caller usually derives it from the system dark mode. */
@Composable
fun CrossyTheme(ground: GridGround, content: @Composable () -> Unit) {
    val t = ground.tokens
    val accent = ground.rosterColor(IdentityRoster.cobalt).toColor()
    val danger = ground.rosterColor(IdentityRoster.poppy).toColor()
    val scheme = if (ground.isDark) {
        darkColorScheme(
            primary = t.ink.toColor(),
            onPrimary = t.canvas.toColor(),
            secondary = accent,
            onSecondary = Color.White,
            background = t.canvas.toColor(),
            onBackground = t.ink.toColor(),
            surface = t.cell.toColor(),
            onSurface = t.ink.toColor(),
            surfaceVariant = t.cell.toColor(),
            onSurfaceVariant = t.number.toColor(),
            outline = t.gridLine.toColor(),
            error = danger,
            onError = Color.White,
        )
    } else {
        lightColorScheme(
            primary = t.ink.toColor(),
            onPrimary = t.canvas.toColor(),
            secondary = accent,
            onSecondary = Color.White,
            background = t.canvas.toColor(),
            onBackground = t.ink.toColor(),
            surface = t.cell.toColor(),
            onSurface = t.ink.toColor(),
            surfaceVariant = t.cell.toColor(),
            onSurfaceVariant = t.number.toColor(),
            outline = t.gridLine.toColor(),
            error = danger,
            onError = Color.White,
        )
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
