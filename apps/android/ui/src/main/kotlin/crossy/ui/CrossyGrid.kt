// The Compose Canvas grid (DESIGN.md §10; ARCHITECTURE.md "Canvas grid"). A pure function of its
// render inputs (INV-10: the values are the store's rendered composite and nothing else; the
// renderer computes no gameplay). It honors the §10 module rules exactly:
//
//   * a 36-unit cell module scaled through the camera, one unit factor from module units to pixels;
//   * background precedence block > current > check > cross-reference > active word > teammate >
//     default (CellFill); the room check paints a flat check-token coat (PROTOCOL.md §10, D27);
//   * clue numbers top-left (+2,+10), circles as inset rings, shaded circles as a soft wash;
//   * the local cursor and its active word tinted in the player's roster color (color in motion,
//     ID-1); teammate presence anchored bottom-right, clear of the top-left number.
//
// Everything draws through the GridCamera (twin of iOS CrossyGridView): the Canvas translates by the
// board origin and scales by points-per-unit, so at rest the camera fits the board to width (nothing
// changes visually until the user zooms) and past that the grid pans and zooms. The camera lives in
// dp; the draw converts to px by display density. Gestures: a two-finger pinch anchored on the
// fingers (Photos/Maps), a one-finger pan when zoomed, a tap that resolves to a cell through the
// camera's inverse transform, and a drag the camera held inert classified into a swipe intent
// (SwipeClassifier). Selection jumps follow the camera to keep the active word clear (I2c), snapping
// under Reduce Motion. The 24dp horizontal edge gutters yield to the system back gesture (iOS
// popGutterWidth). The conflict flash (PROTOCOL.md §8, D02) still paints above every pass, its
// per-frame time sampled through withFrameNanos while flashes are live; Reduce Motion holds the step.

package crossy.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntSize
import crossy.design.Motion
import crossy.design.RGBColor
import kotlinx.coroutines.delay
import kotlin.math.exp

/**
 * Draw the board. `values` is the rendered composite per filled cell (empty cells absent);
 * `selection` is the local cursor, null for a spectator or before one exists; `activeWord` is the
 * set of cells the selection's word runs through (also the camera-follow frame); `presence` is
 * teammate marks by cell; `cursorTint` is the local player's roster color. `onCellTap` reports a tap
 * in cell coordinates through the camera's inverse transform; `onSwipe` reports a drag the camera
 * held inert, classified into a next/prev-word or toggle intent (SwipeClassifier).
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
    // The standing room-check marks (PROTOCOL.md §10, D27), ALREADY through the overlay-suppression
    // rule: a cell with a pending optimistic overlay renders the overlay, not the mark, so the caller
    // passes `checkedWrong - overlayCells` (RoomScreen's visibleCheckMarks). Each member draws a flat
    // full-cell check-token coat, identical for all (a room act, never a personal color), above the
    // cross-reference wash and below the current-cell fill. No animation, no timeout: pure state.
    checkedWrong: Set<Int> = emptySet(),
    // Conflict flashes in flight (GameStore.onConflictFlash routed through RoomScreen). Empty on the
    // happy path; a non-empty book drives a per-frame redraw until it sweeps.
    flashes: FlashBook = FlashBook(),
    // The completion mosaic (apps/ios/DESIGN.md §8; CompletionMoment): the palette and trigger
    // instant the room hands down on gated completion (INV-3). Null on the happy path; a non-null
    // wash blooms every filled cell to its writer's color and drives the per-frame redraw the way a
    // live flash does. On the settle the GLYPH returns to ink (`intensity` -> 0) while the WASH STANDS
    // (`washIntensity` holds 1, `mosaic.settled`): the completed board keeps the room's fingerprint,
    // never reverting to plain ink (the flash-then-disappear fix; web parity: the reveal arc ends at
    // WASH). A settled wash is a constant, so the frame loop pauses and the draw skips the clock. The
    // `mosaic.isolation` filter recesses every non-isolated hand toward paper. Drawn OVER the ink pass.
    mosaic: MosaicWash? = null,
    // The completed Analysis board's directional loupe (WordLoupeLayer, mounted by the room above this
    // Canvas and below the sticker layer). This grid draws NO glass; the flag only tells the draw pass to
    // drop the plain selection tint, because on the settled board the loupe IS the selection made visible
    // (iOS CrossyGridView passes `selection: showsWordLoupe ? nil : selection` to its frame). Default
    // false, so previews, the demo, and every mid-solve grid keep the established fill precedence.
    showsWordLoupe: Boolean = false,
    // Reduce Motion holds the flash as a step and skips the frame loop, and snaps the camera follow
    // instead of gliding it (RoomScreen's rememberReduceMotion; iOS gates the follow on the same
    // accessibilityReduceMotion signal).
    reduceMotion: Boolean = false,
    // The board's TalkBack semantics (iOS CrossyGridView.accessibilityLabel; the largest a11y gap the
    // wave closes). `gridContentDescription` names the board's shape once; `activeCellDescription` is
    // the live line for the cursor's cell (position, entered letter, axis), announced politely as the
    // cursor travels so a screen reader can drive the solve. Null on read-only surfaces and previews,
    // where the grid carries no cursor to describe.
    gridContentDescription: String? = null,
    activeCellDescription: String? = null,
    // The standing chrome's cover over the board (GridCamera clamp window) and the live cover the
    // selected cell must escape (follow only). Android's grid lays out in its own row rather than
    // full-bleed, so the room passes NONE; the seam a full-bleed board would grow through.
    occlusion: GridOcclusion = GridOcclusion.NONE,
    keepClear: GridOcclusion? = null,
    onCellTap: (Int) -> Unit = {},
    onSwipe: (SwipeIntent) -> Unit = {},
    // The live camera reported up to the room so a sibling overlay (ReactionStickerLayer) can ride the
    // same transform when zoomed or panned (iOS threads the resolved camera into its sticker layer).
    // Null while nothing has moved the board, so at rest the overlay keeps its own fit-to-width math
    // and nothing changes; a gesture or a follow glide reports the stored (already clamped) camera.
    onCamera: (GridCamera?) -> Unit = {},
) {
    val tokens = ground.tokens
    val measurer = rememberTextMeasurer()
    val cols = geometry.cols
    val rows = geometry.rows
    val tint = cursorTint.toColor()
    val density = LocalDensity.current.density

    // The camera state: null until the user zooms, so the board draws at the fit-to-width rest exactly
    // as it did before the camera landed. A pinch or pan stores a live camera; the follow glides it.
    var camera by remember(geometry) { mutableStateOf<GridCamera?>(null) }
    // The measured viewport in px, for the follow solver (the draw and the gestures read their own
    // measured size). Zero until the first layout pass.
    var viewportPx by remember(geometry) { mutableStateOf(IntSize.Zero) }
    // True while a pinch or drag owns the camera, so the follow glide stands down and never fights the
    // fingers (iOS cancels followTask on gesture start).
    var interacting by remember(geometry) { mutableStateOf(false) }
    // The latest solving axis, read fresh inside the long-lived gesture recognizer (which is not keyed
    // on selection, so it must not close over a stale one).
    val isAcrossState = rememberUpdatedState(selection?.isAcross ?: true)

    // The per-frame sample of the monotonic seconds clock (the flash book's and the mosaic's shared
    // origin), read inside withFrameNanos so it rides the compositor's cadence without re-rendering
    // anything but the flash rects and the mosaic bloom. Only armed while a flash is live, the mosaic
    // BLOOMS (a settled wash is a constant and costs no frames), or an isolation toggle crossfades.
    // Under Reduce Motion the flash and the bloom are held as a single step (sampled once), but an
    // isolation crossfade is a pure opacity fade, the §7 reduced-motion form itself, so it still runs.
    var now by remember { mutableStateOf(reactionNow()) }
    // The mosaic BLOOMS only until it settles; past that the standing wash is a constant.
    val mosaicBlooming = mosaic != null && !mosaic.settled
    // True while an isolation toggle's crossfade runs: the settled frame loop unpauses for just the
    // fade's window, then rests again (a settled mosaic must keep costing no frames). Re-armed on every
    // toggle by its changedAt, the flash sweep's retire pattern; the small margin past the fade lets the
    // resting frame draw the exact target. Runs under Reduce Motion too (an opacity crossfade is allowed).
    var isolationFading by remember { mutableStateOf(false) }
    LaunchedEffect(mosaic?.isolation?.changedAt) {
        if (mosaic?.isolation?.changedAt == null) return@LaunchedEffect
        isolationFading = true
        withFrameNanos { now = reactionNow() }
        delay((GridMosaic.ISOLATION_FADE_SECONDS * 1000).toLong() + 50)
        now = reactionNow()
        isolationFading = false
    }
    LaunchedEffect(flashes, mosaicBlooming, isolationFading, reduceMotion) {
        if (flashes.isEmpty && !mosaicBlooming && !isolationFading) return@LaunchedEffect
        now = reactionNow()
        // Reduce Motion holds the flash and the bloom as a single step (no eased motion); only an
        // isolation crossfade, a pure opacity fade, keeps sampling frames.
        if (reduceMotion && !isolationFading) return@LaunchedEffect
        while (true) withFrameNanos { now = reactionNow() }
    }

    // Report the live camera up to the room so a sibling overlay can ride the same transform (iOS
    // hands its resolved camera to the sticker layer). Null at rest, so the overlay keeps its own
    // fit math and nothing changes; once a gesture or follow glide stores one, the report clamps
    // against the measured viewport exactly as the draw does, so the overlay and the draw can never
    // disagree on where a cell sits. rememberUpdatedState keeps the latest callback without re-keying.
    val onCameraUpdated = rememberUpdatedState(onCamera)
    LaunchedEffect(camera, viewportPx) {
        onCameraUpdated.value(
            camera?.let {
                if (viewportPx.width == 0 || viewportPx.height == 0) it
                else it.clamped(viewportPx.width / density, viewportPx.height / density, rows, cols, occlusion)
            },
        )
    }

    // Camera follow (I2c): a selection jump (a typing advance across words, a clue chevron, a resync)
    // pans the minimal distance that frames the whole active WORD, keeping the cursor clear; a word
    // already framed returns null and nothing moves, so typing across it never spasms. Only real
    // jumps move anything, and never while a gesture owns the camera. Reduce Motion snaps to the
    // target; otherwise the glide is the chrome settle curve, hand-stepped once per display frame
    // (Canvas transforms cannot ride a Compose animation, iOS followCamera).
    LaunchedEffect(selection, viewportPx, geometry) {
        val sel = selection ?: return@LaunchedEffect
        if (viewportPx.width == 0 || viewportPx.height == 0 || interacting) return@LaunchedEffect
        val vw = viewportPx.width / density
        val vh = viewportPx.height / density
        val start = (camera ?: GridCamera.initial(vw, vh, rows, cols, occlusion))
            .clamped(vw, vh, rows, cols, occlusion)
        val target = start.following(
            activeWord, sel.cell, vw, vh, rows, cols,
            occlusion = occlusion, keepClear = keepClear,
        ) ?: return@LaunchedEffect
        if (reduceMotion) {
            camera = target
            return@LaunchedEffect
        }
        val began = withFrameNanos { it }
        while (true) {
            if (interacting) break // a pinch or drag took the camera mid-flight
            val nowNanos = withFrameNanos { it }
            val fraction = chromeSettleFraction((nowNanos - began) / 1_000_000_000.0).toFloat()
            camera = start.interpolated(target, fraction)
            if (fraction >= 1f) break
        }
    }

    Canvas(
        modifier = modifier
            .aspectRatio(cols.toFloat() / rows.toFloat())
            // The board's one accessible element (a Canvas has no per-cell nodes; iOS labels the whole
            // grid too). It names the shape, carries the cursor cell as a live state line, and announces
            // politely as the cursor travels so TalkBack can drive the solve.
            .then(
                if (gridContentDescription == null) Modifier
                else Modifier.semantics {
                    contentDescription = gridContentDescription
                    if (activeCellDescription != null) {
                        stateDescription = activeCellDescription
                        liveRegion = LiveRegionMode.Polite
                    }
                },
            )
            .onSizeChanged { viewportPx = it }
            // Pinch and pan, then the drag-end swipe (one recognizer, iOS's simultaneous magnify+drag).
            .pointerInput(geometry, occlusion) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val vw = size.width / density
                    val vh = size.height / density
                    // The edge-pop gutter (iOS popGutterWidth = 24): a drag that starts in the 24dp
                    // horizontal edge bands belongs to the system back gesture, so this recognizer
                    // yields it (a tap there still places the cursor: the tap recognizer is not
                    // gated). Both edges, because Android gesture navigation lives on both.
                    val popPx = POP_GUTTER_DP * density
                    if (down.position.x < popPx || down.position.x > size.width - popPx) {
                        return@awaitEachGesture
                    }
                    var maxPointers = 1
                    var cameraMoved = false
                    var panAccumX = 0f
                    var panAccumY = 0f
                    try {
                        while (true) {
                            val event = awaitPointerEvent()
                            val pressed = event.changes.count { it.pressed }
                            if (pressed == 0) break
                            maxPointers = maxOf(maxPointers, pressed)
                            val zoom = event.calculateZoom()
                            val pan = event.calculatePan()
                            val centroid = event.calculateCentroid()
                            panAccumX += pan.x
                            panAccumY += pan.y
                            if (centroid != Offset.Unspecified && (zoom != 1f || pan != Offset.Zero)) {
                                // Real movement: this is a drag or pinch, not a tap, so claim the
                                // camera from any in-flight follow glide (a tap never flips this, so
                                // a jump-to-cell tap's own follow is never blocked).
                                interacting = true
                                // Solve one incremental step off the current camera through the same
                                // anchor law as iOS: the board point under the fingers' previous
                                // position (centroid - pan) lands under their live position at the new
                                // scale, so a drifting centroid pans and the zoom anchors on the
                                // fingers.
                                val before = camera
                                    ?: GridCamera.initial(vw, vh, rows, cols, occlusion)
                                val after = before.pinched(
                                    magnification = zoom,
                                    startCentroidX = (centroid.x - pan.x) / density,
                                    startCentroidY = (centroid.y - pan.y) / density,
                                    centroidX = centroid.x / density,
                                    centroidY = centroid.y / density,
                                    viewportWidth = vw, viewportHeight = vh, rows = rows, cols = cols,
                                    occlusion = occlusion,
                                )
                                if (after != before) {
                                    camera = after
                                    cameraMoved = true
                                }
                            }
                            // Consume real movement so the tap recognizer stands down and no ancestor
                            // claims the drag; an untouched (no-movement) event stays a tap.
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } finally {
                        interacting = false
                    }
                    // Only a one-finger drag the camera held inert (the board fits, pan re-centered to
                    // no change) reads as a swipe; a pinch (two fingers) or a drag that panned never
                    // does, so pan and swipe cannot double-fire. Translation is measured in dp for the
                    // classifier's 24dp travel floor.
                    if (maxPointers < 2 && !cameraMoved) {
                        SwipeClassifier.classify(
                            panAccumX / density, panAccumY / density, isAcrossState.value,
                        )?.let(onSwipe)
                    }
                }
            }
            // The tap: resolve the cell through the camera's inverse transform; blocks are ignored.
            .pointerInput(geometry, occlusion) {
                detectTapGestures { offset ->
                    val vw = size.width / density
                    val vh = size.height / density
                    val cam = (camera ?: GridCamera.initial(vw, vh, rows, cols, occlusion))
                        .clamped(vw, vh, rows, cols, occlusion)
                    val cell = cam.cell(offset.x / density, offset.y / density, rows, cols) ?: return@detectTapGestures
                    if (cell !in geometry.blocks) onCellTap(cell)
                }
            },
    ) {
        val vw = size.width / density
        val vh = size.height / density
        // Resolve the camera against the true measured size every frame (iOS re-clamps in body): null
        // opens at the fit-to-width rest, centered, so nothing moves until a gesture stores a camera.
        val cam = (camera ?: GridCamera.initial(vw, vh, rows, cols, occlusion))
            .clamped(vw, vh, rows, cols, occlusion)
        // px per module unit and the board origin in px: every draw position is offset + unit * s.
        val s = cam.scale * density
        val cellPx = GridModule.UNIT * s
        val offX = cam.offsetX * density
        val offY = cam.offsetY * density
        val visible = cam.visibleCells(vw, vh, rows, cols)

        fun onScreen(c: Int): Boolean {
            val col = c % cols
            val row = c / cols
            return row >= visible.rowStart && row < visible.rowEnd &&
                col >= visible.colStart && col < visible.colEnd
        }

        // Pass 1: cell backgrounds by the §10 precedence, over the visible window only (a zoomed 25x25
        // costs what is on screen, not 625 cells). Blocks paint recessed; playable cells paint paper,
        // then a wash of the selection color (current, then active word) or a faint teammate wash.
        for (row in visible.rowStart until visible.rowEnd) {
            for (col in visible.colStart until visible.colEnd) {
                val c = row * cols + col
                val origin = Offset(offX + col * cellPx, offY + row * cellPx)
                val cellSize = Size(cellPx, cellPx)
                if (c in geometry.blocks) {
                    drawRect(tokens.block.toColor(), origin, cellSize)
                    continue
                }
                drawRect(tokens.cell.toColor(), origin, cellSize)
                when {
                    // The settled Analysis loupe drops the plain selection tint (current cell + active
                    // word): the glass is the selection now (iOS nils the frame's selection). The check,
                    // cross-reference, and teammate washes still stand, exactly as the iOS frame keeps them.
                    !showsWordLoupe && c == selection?.cell -> drawRect(tint.copy(alpha = GridModule.CURRENT_ALPHA), origin, cellSize)
                    // The room check coat (PROTOCOL.md §10, D27): a flat opaque token fill replacing the
                    // paper outright, above the cross-reference wash and below the current-cell fill,
                    // identical for every member (CellFill.CHECK). The caller already suppressed any
                    // cell under a pending overlay.
                    c in checkedWrong -> drawRect(tokens.check.toColor(), origin, cellSize)
                    c in crossReference -> drawRect(tint.copy(alpha = GridModule.CROSS_REFERENCE_ALPHA), origin, cellSize)
                    !showsWordLoupe && c in activeWord -> drawRect(tint.copy(alpha = GridModule.ACTIVE_WORD_ALPHA), origin, cellSize)
                    presence.containsKey(c) ->
                        drawRect(presence.getValue(c).first().color.toColor().copy(alpha = GridModule.TEAMMATE_ALPHA), origin, cellSize)
                }
            }
        }

        // Pass 2: the grid rule. Interior hairlines plus the closing outer frame (§10 / GridModule),
        // drawn across the whole board through the transform (a few dozen lines, clipped to the view).
        val hairline = maxOf(GridModule.HAIRLINE * s, 1f)
        val lineColor = tokens.gridLine.toColor()
        for (i in 0..cols) drawLine(lineColor, Offset(offX + i * cellPx, offY), Offset(offX + i * cellPx, offY + rows * cellPx), hairline)
        for (j in 0..rows) drawLine(lineColor, Offset(offX, offY + j * cellPx), Offset(offX + cols * cellPx, offY + j * cellPx), hairline)
        drawRect(lineColor, Offset(offX, offY), Size(cols * cellPx, rows * cellPx), style = Stroke(GridModule.FRAME_STROKE * s))

        // Pass 3: circles (inset rings) and shaded circles (a soft ink wash).
        for (c in geometry.shadedCircles) {
            if (c in geometry.blocks || !onScreen(c)) continue
            drawCircle(tokens.ink.toColor().copy(alpha = GridModule.SHADE_ALPHA), GridModule.CIRCLE_RADIUS * s, cellCenter(c, cols, cellPx, offX, offY))
        }
        for (c in geometry.circles) {
            if (c in geometry.blocks || !onScreen(c)) continue
            drawCircle(tokens.number.toColor(), GridModule.CIRCLE_RADIUS * s, cellCenter(c, cols, cellPx, offX, offY), style = Stroke(maxOf(GridModule.CIRCLE_STROKE * s, 1f)))
        }

        // Pass 4: clue numbers, top-left (+2,+10).
        for ((c, number) in geometry.numbers) {
            if (c in geometry.blocks || !onScreen(c)) continue
            val x = offX + (c % cols) * cellPx
            val y = offY + (c / cols) * cellPx
            val layout = measurer.measure(
                number.toString(),
                TextStyle(color = tokens.number.toColor(), fontSize = (GridModule.NUMBER_FONT_SIZE * s).toSp()),
            )
            drawText(layout, topLeft = Offset(x + GridModule.NUMBER_LEADING * s, y + 1f))
        }

        // Pass 5: entry glyphs, centered, ink, weight per ground. Rebus strings shrink to fit.
        val glyphWeight = FontWeight(ground.glyphWeight)
        for ((c, value) in values) {
            if (c in geometry.blocks || value.isEmpty() || !onScreen(c)) continue
            val fontUnits = glyphUnits(value.length)
            val layout = measurer.measure(
                value,
                TextStyle(color = tokens.ink.toColor(), fontSize = (fontUnits * s).toSp(), fontWeight = glyphWeight),
            )
            val center = cellCenter(c, cols, cellPx, offX, offY)
            drawText(layout, topLeft = Offset(center.x - layout.size.width / 2f, center.y - layout.size.height / 2f))
        }

        // Pass 6: teammate presence, the bottom-right stack (Wave 2.1d).
        for ((c, marks) in presence) {
            if (c in geometry.blocks || !onScreen(c)) continue
            val origin = Offset(offX + (c % cols) * cellPx, offY + (c / cols) * cellPx)
            if (marks.size == 1) {
                val mark = marks.first()
                drawDirectionArrow(origin, s, mark)
                drawPuck(origin, s, mark.color.toColor(), mark.initial, measurer)
            } else {
                drawCountBadge(origin, s, marks.first().color.toColor(), marks.size, measurer)
            }
        }

        // Pass 6b: the completion mosaic (apps/ios/DESIGN.md §8), painted OVER the ink pass and under
        // the flashes exactly as iOS orders it (drawMosaic before drawFlashes). Two clocks share one
        // rise: the paper WASH rides `washIntensity` and STANDS at 1 once settled (the completed board's
        // record, never plain ink again, the flash-then-disappear fix), while the glyph rides
        // `intensity` and settles back to ink. A settled mosaic reads wash 1 / glyph 0 with no clock, so
        // the paused frame loop's frozen `now` cannot misdraw it. The isolation filter recesses every
        // non-isolated hand toward paper by a per-cell wash multiplier (keyed on the OWNER, crossfading
        // ease-in-out over 0.25s). A cell without a mosaic color (empty, or cleared) never tints. Under
        // Reduce Motion the rise and settle are held steps; the isolation crossfade is a pure fade.
        if (mosaic != null) {
            val elapsed = now - mosaic.startedAt
            val wash = if (mosaic.settled) 1.0 else MosaicEnvelope.washIntensity(elapsed, reduceMotion)
            val glyph = if (mosaic.settled) 0.0 else MosaicEnvelope.intensity(elapsed, reduceMotion)
            if (wash > 0.0) {
                val glyphWeightMosaic = FontWeight(ground.glyphWeight)
                for ((c, color) in mosaic.colors) {
                    if (c in geometry.blocks || !onScreen(c)) continue
                    val origin = Offset(offX + (c % cols) * cellPx, offY + (c / cols) * cellPx)
                    val tinted = color.toColor()
                    // The isolation filter (a legend-row tap over the settled wash): the isolated
                    // solver's cells hold the full wash, every other hand recesses toward paper (a lower
                    // alpha over the ground IS the recessive step, on both grounds by construction).
                    var alpha = GridMosaic.WASH_ALPHA * wash.toFloat()
                    val owner = mosaic.writers[c]
                    if (mosaic.isolation != null && owner != null) {
                        val mult = GridMosaic.isolationMultiplier(owner, mosaic.isolation, now - mosaic.isolation.changedAt)
                        alpha *= mult.toFloat()
                    }
                    drawRect(tinted.copy(alpha = alpha), origin, Size(cellPx, cellPx))
                    if (glyph <= 0.0) continue
                    val value = values[c]
                    if (value.isNullOrEmpty()) continue
                    val fontUnits = glyphUnits(value.length)
                    val layout = measurer.measure(
                        value,
                        TextStyle(color = tinted.copy(alpha = glyph.toFloat()), fontSize = (fontUnits * s).toSp(), fontWeight = glyphWeightMosaic),
                    )
                    val center = cellCenter(c, cols, cellPx, offX, offY)
                    drawText(layout, topLeft = Offset(center.x - layout.size.width / 2f, center.y - layout.size.height / 2f))
                }
            }
        }

        // Pass 7: conflict flashes paint above everything (PROTOCOL.md §8, D02): the writer's color
        // over the cell at the envelope's opacity, decaying to leave the new letter. `now` recomposes
        // this pass each frame while a flash is live; a swept cell drops out on the next book change.
        for ((c, flash) in flashes.flashes) {
            if (c in geometry.blocks || !onScreen(c)) continue
            val opacity = flashes.opacity(c, now, reduceMotion) ?: continue
            val origin = Offset(offX + (c % cols) * cellPx, offY + (c / cols) * cellPx)
            drawRect(flash.color.toColor().copy(alpha = opacity.toFloat()), origin, Size(cellPx, cellPx))
        }
    }
}

/** The leading/trailing strip width the camera drag never claims, so the system's back gesture can
 *  (the edge-pop gutter; iOS popGutterWidth). Sized to the system's own edge-gesture band. */
private const val POP_GUTTER_DP: Float = 24f

/** The follow glide's step function: the chrome spring's own critically damped curve
 *  x(t) = 1 - e^(-wt)(1 + wt), w = 2pi/response, reporting 1 once within a thousandth so the walk
 *  terminates (twin of iOS ChromeSettleCurve, off Motion.Springs.chromeResponse). */
private fun chromeSettleFraction(elapsedSeconds: Double): Double {
    if (elapsedSeconds <= 0.0) return 0.0
    val response = Motion.Springs.chromeResponseMs / 1000.0
    val t = 2.0 * Math.PI / response * elapsedSeconds
    val fraction = 1.0 - exp(-t) * (1.0 + t)
    return if (fraction >= 0.999) 1.0 else fraction
}

private fun cellCenter(cell: Int, cols: Int, cellPx: Float, offX: Float, offY: Float): Offset =
    Offset(offX + (cell % cols) * cellPx + cellPx / 2f, offY + (cell / cols) * cellPx + cellPx / 2f)

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
    val sz = GridModule.ARROW_SIZE * unitScale
    val path = Path().apply {
        if (mark.isAcross) {
            moveTo(ox, oy)
            lineTo(ox + sz, oy + sz / 2f)
            lineTo(ox, oy + sz)
        } else {
            moveTo(ox, oy)
            lineTo(ox + sz / 2f, oy + sz)
            lineTo(ox + sz, oy)
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
