// The Compose Canvas grid (DESIGN.md §10; ARCHITECTURE.md "Canvas grid"). A pure function of its
// render inputs (INV-10: the values are the store's rendered composite and nothing else; the
// renderer computes no gameplay). It honors the §10 module rules exactly:
//
//   * a 36-unit cell module scaled to fit, one unit factor from module units to pixels;
//   * background precedence block > current > check > cross-reference > active word > teammate >
//     default (CellFill; check and cross-reference are M6 and paint nothing yet);
//   * clue numbers top-left (+2,+10), circles as inset rings, shaded circles as a soft wash;
//   * the local cursor and its active word tinted in the player's roster color (color in motion,
//     ID-1); teammate presence anchored bottom-right, clear of the top-left number: a direction
//     arrow top-right, an avatar puck (initial, never image) bottom-right, a count badge in the
//     same bottom-right slot when several teammates share a cell.
//
// Motion is deliberately minimal here (Wave A4 bar): no flash animation, no camera. Those are a
// later track.

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import crossy.design.RGBColor

/**
 * Draw the board. `values` is the rendered composite per filled cell (empty cells absent);
 * `selection` is the local cursor, null for a spectator or before one exists; `activeWord` is the
 * set of cells the selection's word runs through; `presence` is teammate marks by cell; `cursorTint`
 * is the local player's roster color (or ink when ID-1 mutes color in motion, resolved by the
 * caller). `onCellTap` reports a tap in cell coordinates; the input layer maps it to a selection.
 */
@Composable
fun CrossyGrid(
    geometry: GridGeometry,
    values: Map<Int, String>,
    selection: GridSelection?,
    activeWord: Set<Int>,
    presence: Map<Int, List<PresenceMark>>,
    ground: GridGround,
    cursorTint: RGBColor,
    modifier: Modifier = Modifier,
    // The cells of the clues the active clue cross-references (ClueRefs.referencedCells), tinted
    // faintly relative to the selection. Empty on read-only surfaces that carry no active clue.
    crossReference: Set<Int> = emptySet(),
    onCellTap: (Int) -> Unit = {},
) {
    val tokens = ground.tokens
    val measurer = rememberTextMeasurer()
    val cols = geometry.cols
    val rows = geometry.rows
    val tint = cursorTint.toColor()

    Canvas(
        modifier = modifier
            .aspectRatio(cols.toFloat() / rows.toFloat())
            .pointerInput(geometry) {
                detectTapGestures { offset ->
                    val cellW = size.width.toFloat() / cols
                    val cellH = size.height.toFloat() / rows
                    val col = (offset.x / cellW).toInt()
                    val row = (offset.y / cellH).toInt()
                    if (col in 0 until cols && row in 0 until rows) onCellTap(row * cols + col)
                }
            },
    ) {
        // aspectRatio pins width/cols == height/rows, so one square module edge governs everything.
        val cell = size.width / cols
        val unitScale = cell / GridModule.UNIT

        // Pass 1: cell backgrounds by the §10 precedence. Blocks paint recessed; playable cells
        // paint paper, then a wash of the selection color (current, then active word) or a faint
        // teammate wash, never two washes on one cell.
        for (c in 0 until geometry.cellCount) {
            val x = (c % cols) * cell
            val y = (c / cols) * cell
            val origin = Offset(x, y)
            val cellSize = Size(cell, cell)
            if (c in geometry.blocks) {
                drawRect(tokens.block.toColor(), origin, cellSize)
                continue
            }
            drawRect(tokens.cell.toColor(), origin, cellSize)
            // The when arms encode the §10 background precedence (CellFill): current > check (M6) >
            // cross-reference > active word > teammate. A referenced cell outranks the active word,
            // so where a referenced word crosses the active one the crossing cell paints xref.
            when {
                c == selection?.cell -> drawRect(tint.copy(alpha = GridModule.CURRENT_ALPHA), origin, cellSize)
                c in crossReference -> drawRect(tint.copy(alpha = GridModule.CROSS_REFERENCE_ALPHA), origin, cellSize)
                c in activeWord -> drawRect(tint.copy(alpha = GridModule.ACTIVE_WORD_ALPHA), origin, cellSize)
                presence.containsKey(c) ->
                    drawRect(presence.getValue(c).first().color.toColor().copy(alpha = GridModule.TEAMMATE_ALPHA), origin, cellSize)
            }
        }

        // Pass 2: the grid rule. Interior hairlines plus the closing outer frame (§10 / GridModule).
        val hairline = maxOf(GridModule.HAIRLINE * unitScale, 1f)
        val lineColor = tokens.gridLine.toColor()
        for (i in 0..cols) drawLine(lineColor, Offset(i * cell, 0f), Offset(i * cell, rows * cell), hairline)
        for (j in 0..rows) drawLine(lineColor, Offset(0f, j * cell), Offset(cols * cell, j * cell), hairline)
        drawRect(lineColor, Offset(0f, 0f), Size(cols * cell, rows * cell), style = Stroke(GridModule.FRAME_STROKE * unitScale))

        // Pass 3: circles (inset rings) and shaded circles (a soft ink wash).
        for (c in geometry.shadedCircles) {
            if (c in geometry.blocks) continue
            val center = cellCenter(c, cols, cell)
            drawCircle(tokens.ink.toColor().copy(alpha = GridModule.SHADE_ALPHA), GridModule.CIRCLE_RADIUS * unitScale, center)
        }
        for (c in geometry.circles) {
            if (c in geometry.blocks) continue
            val center = cellCenter(c, cols, cell)
            drawCircle(tokens.number.toColor(), GridModule.CIRCLE_RADIUS * unitScale, center, style = Stroke(maxOf(GridModule.CIRCLE_STROKE * unitScale, 1f)))
        }

        // Pass 4: clue numbers, top-left (+2,+10).
        for ((c, number) in geometry.numbers) {
            if (c in geometry.blocks) continue
            val x = (c % cols) * cell
            val y = (c / cols) * cell
            val layout = measurer.measure(
                number.toString(),
                TextStyle(color = tokens.number.toColor(), fontSize = (GridModule.NUMBER_FONT_SIZE * unitScale).toSp()),
            )
            drawText(layout, topLeft = Offset(x + GridModule.NUMBER_LEADING * unitScale, y + 1f))
        }

        // Pass 5: entry glyphs, centered, ink, weight per ground. Rebus strings shrink to fit.
        val glyphWeight = FontWeight(ground.glyphWeight)
        for ((c, value) in values) {
            if (c in geometry.blocks || value.isEmpty()) continue
            val fontUnits = glyphUnits(value.length)
            val layout = measurer.measure(
                value,
                TextStyle(color = tokens.ink.toColor(), fontSize = (fontUnits * unitScale).toSp(), fontWeight = glyphWeight),
            )
            val center = cellCenter(c, cols, cell)
            drawText(layout, topLeft = Offset(center.x - layout.size.width / 2f, center.y - layout.size.height / 2f))
        }

        // Pass 6: teammate presence, the bottom-right stack (Wave 2.1d).
        for ((c, marks) in presence) {
            if (c in geometry.blocks) continue
            val x = (c % cols) * cell
            val y = (c / cols) * cell
            if (marks.size == 1) {
                val mark = marks.first()
                drawDirectionArrow(Offset(x, y), unitScale, mark)
                drawPuck(Offset(x, y), unitScale, mark.color.toColor(), mark.initial, measurer)
            } else {
                drawCountBadge(Offset(x, y), unitScale, marks.first().color.toColor(), marks.size, measurer)
            }
        }
    }
}

private fun cellCenter(cell: Int, cols: Int, cellPx: Float): Offset =
    Offset((cell % cols) * cellPx + cellPx / 2f, (cell / cols) * cellPx + cellPx / 2f)

/** The glyph size in module units for a value of `length` characters: 24 for a single glyph,
 *  longer (rebus) strings scaled to the ink width and floored (twin of the iOS glyphSize). */
private fun glyphUnits(length: Int): Float {
    if (length <= 1) return GridModule.GLYPH_FONT_SIZE
    val fitted = 32f / (0.62f * length)
    return minOf(GridModule.GLYPH_FONT_SIZE, maxOf(5f, fitted))
}

/** The direction arrow, top-right of the module (a small triangle pointing along the cursor axis). */
private fun DrawScope.drawDirectionArrow(cellOrigin: Offset, unitScale: Float, mark: PresenceMark) {
    val ox = cellOrigin.x + GridModule.ARROW_ORIGIN_X * unitScale
    val oy = cellOrigin.y + GridModule.ARROW_ORIGIN_Y * unitScale
    val s = GridModule.ARROW_SIZE * unitScale
    val path = Path().apply {
        if (mark.isAcross) {
            moveTo(ox, oy)
            lineTo(ox + s, oy + s / 2f)
            lineTo(ox, oy + s)
        } else {
            moveTo(ox, oy)
            lineTo(ox + s / 2f, oy + s)
            lineTo(ox + s, oy)
        }
        close()
    }
    drawPath(path, mark.color.toColor())
}

/** The avatar puck, bottom-right: a filled disc in the writer's color with the initial in it. The
 *  initial paints white for legibility on any roster color (a neutral, not a brand paint). */
private fun DrawScope.drawPuck(cellOrigin: Offset, unitScale: Float, color: Color, initial: String, measurer: TextMeasurer) {
    val center = Offset(cellOrigin.x + GridModule.AVATAR_CENTER_X * unitScale, cellOrigin.y + GridModule.AVATAR_CENTER_Y * unitScale)
    drawCircle(color, GridModule.AVATAR_RADIUS * unitScale, center)
    if (initial.isEmpty()) return
    val layout = measurer.measure(initial, TextStyle(color = Color.White, fontSize = (GridModule.AVATAR_INITIAL_FONT_SIZE * unitScale).toSp(), fontWeight = FontWeight.SemiBold))
    drawText(layout, topLeft = Offset(center.x - layout.size.width / 2f, center.y - layout.size.height / 2f))
}

/** The count badge, bottom-right: several teammates in one cell collapse here, never the top-right
 *  slot that collides with the clue number. */
private fun DrawScope.drawCountBadge(cellOrigin: Offset, unitScale: Float, color: Color, count: Int, measurer: TextMeasurer) {
    val center = Offset(cellOrigin.x + GridModule.BADGE_CENTER_X * unitScale, cellOrigin.y + GridModule.BADGE_CENTER_Y * unitScale)
    drawCircle(color, GridModule.BADGE_RADIUS * unitScale, center)
    val layout = measurer.measure(count.toString(), TextStyle(color = Color.White, fontSize = (GridModule.BADGE_COUNT_FONT_SIZE * unitScale).toSp(), fontWeight = FontWeight.SemiBold))
    drawText(layout, topLeft = Offset(center.x - layout.size.width / 2f, center.y - layout.size.height / 2f))
}
