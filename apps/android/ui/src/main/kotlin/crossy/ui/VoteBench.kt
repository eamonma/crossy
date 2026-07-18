// The Bench (PROTOCOL.md §10, D32; Wave 15.6 UX): the vote's venue, a NON-MODAL bottom sheet in the
// app's own visual language, not a stock M3 modal. It rises to partial height on open with the
// proposer's line, the elector chips (existing identity colors, unvoted dimmed), and the two verbs
// full-width ("Check it" primary). The grid above stays fully interactive: there is no scrim, so the
// Bench never eats input. It is collapsible by a downward swipe to a slim docked strip and re-rises
// on resolution. It installs NO BackHandler, so predictive back keeps navigating the room while the
// Bench stays docked and the vote stays visible. All copy and timing are CheckVoteBenchModel's; the
// composable only lays out and announces. The web UI is not the spec (CLAUDE.md): this is the app's
// idiom, not a dialog or a snackbar.

package crossy.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import crossy.store.VoteView

/**
 * The Bench. Renders the risen sheet for an open [vote], or the resolution line for a closed
 * [resolution] animating out; hidden when both are null. `nameFor` and `colorFor` resolve an elector
 * to its display name and identity color (the existing roster color, never a fresh one). `nowMillis`
 * is the frame clock the resolution timing reads. The caller gates solo out (VoteView.isSolo /
 * RenderModel.showVoteBench): the Bench must never render for a solo electorate.
 */
@Composable
fun VoteBench(
    vote: VoteView?,
    resolution: VoteResolution?,
    selfUserId: String?,
    ground: GridGround,
    nowMillis: Long,
    reduceMotion: Boolean,
    // A departed/unknown elector resolves to null; the model supplies the collective fallback copy so
    // no raw userId ever reaches the surface (Wave 15.9a).
    nameFor: (String) -> String?,
    colorFor: (String) -> Color,
    // A ballot is in flight (the store's pendingVoteCommandId is set): the verbs settle disabled so a
    // double-tap cannot send a second doomed ballot (Wave 15.9a; fix 7).
    ballotPending: Boolean,
    onApprove: () -> Unit,
    onKeepSolving: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (vote == null && resolution == null) return

    // Collapse state: a downward swipe docks the Bench to a slim strip; a resolution forces it risen
    // again (it re-rises on resolution). Predictive back is untouched: no BackHandler here.
    var collapsed by remember { mutableStateOf(false) }
    val risen = resolution != null || !collapsed
    val heightFraction by animateFloatAsState(if (risen) 1f else 0f, label = "benchHeight")

    // The drag recognizer keys on Unit so it is never rebuilt mid-gesture (a per-ballot `vote` copy
    // used to restart it); it reads the latest resolution through an updated state instead of a key.
    val currentResolution by rememberUpdatedState(resolution)

    val gold = AnalysisPalette.goldText(ground).toColor()

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 8.dp, bottom = 18.dp)
                .pointerInput(Unit) {
                    detectVerticalDragGestures { _, dragAmount ->
                        // Down docks, up re-rises. A resolution ignores it (it always shows risen).
                        if (currentResolution == null) {
                            if (dragAmount > 6f) collapsed = true
                            if (dragAmount < -6f) collapsed = false
                        }
                    }
                },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // The drag handle: the app's own affordance, not an M3 drag bar.
            Box(
                modifier = Modifier
                    .padding(bottom = 10.dp)
                    .width(38.dp)
                    .height(4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f)),
            )

            when {
                resolution != null -> ResolutionContent(resolution, nowMillis, reduceMotion, gold)
                vote != null -> {
                    Text(
                        // The proposer reads the room's pending answer, others read the question, a
                        // departed proposer stays collective (Wave 15.9a). Capped so a long name can
                        // never overflow the sheet's layout.
                        text = CheckVoteBenchModel.proposalLine(vote, selfUserId, nameFor(vote.by)),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier
                            .fillMaxWidth()
                            .semantics { liveRegion = LiveRegionMode.Polite },
                    )
                    Spacer(Modifier.height(14.dp))
                    if (heightFraction > 0.05f) {
                        ChipsRow(
                            chips = CheckVoteBenchModel.chips(vote, selfUserId, nameFor),
                            colorFor = colorFor,
                        )
                        if (CheckVoteBenchModel.showVerbs(vote, selfUserId)) {
                            Spacer(Modifier.height(18.dp))
                            Verbs(
                                enabled = !ballotPending,
                                onApprove = onApprove,
                                onKeepSolving = onKeepSolving,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The elector chips: one settled dot per ballot, identity-colored, unvoted dimmed. The chips are the
 *  whole tally the room reads; no number is shown. */
@Composable
private fun ChipsRow(chips: List<ElectorChip>, colorFor: (String) -> Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            // The chips are the room's ONLY tally (U5), so the row speaks one merged summary that
            // updates per ballot; the individual dots stay decorative (no per-glyph reading).
            .clearAndSetSemantics { contentDescription = CheckVoteBenchModel.chipsSummary(chips) },
        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (chip in chips) {
            val voted = chip.vote != ChipVote.UNVOTED
            val base = colorFor(chip.userId)
            Box(
                modifier = Modifier
                    .size(if (voted) 28.dp else 24.dp)
                    .clip(RoundedCornerShape(50))
                    .background(base.copy(alpha = if (voted) 1f else 0.28f)),
                contentAlignment = Alignment.Center,
            ) {
                val glyph = when (chip.vote) {
                    ChipVote.APPROVED -> "✓"
                    ChipVote.REJECTED -> "×"
                    ChipVote.UNVOTED -> chip.name.take(1).uppercase()
                }
                Text(
                    text = glyph,
                    color = Color.White.copy(alpha = if (voted) 1f else 0.7f),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

/** The two verbs, full-width, "Check it" primary. Both settle disabled once a ballot is in flight so
 *  a double-tap cannot send a second doomed ballot (Wave 15.9a; fix 7). */
@Composable
private fun Verbs(enabled: Boolean, onApprove: () -> Unit, onKeepSolving: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OutlinedButton(
            onClick = onKeepSolving,
            enabled = enabled,
            modifier = Modifier.weight(1f),
        ) { Text(VoteCopy.KEEP_SOLVING) }
        Button(
            onClick = onApprove,
            enabled = enabled,
            modifier = Modifier.weight(1f),
            colors = ButtonDefaults.buttonColors(),
        ) { Text(VoteCopy.CHECK_IT) }
    }
}

/** The resolution beat: the one calm line, plus the proposer-only post-fail tally. */
@Composable
private fun ResolutionContent(resolution: VoteResolution, nowMillis: Long, reduceMotion: Boolean, goldText: Color) {
    val line = CheckVoteBenchModel.resolutionLine(resolution, nowMillis, reduceMotion)
    val tally = CheckVoteBenchModel.proposerTally(resolution)
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (line != null) {
            Text(
                text = line,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = if (resolution is VoteResolution.Passed) goldText else MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (tally != null) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = tally,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f),
            )
        }
    }
}
