// The check-vote card (Wave 15.12, owner rulings 2026-07-18; twin of iOS CheckVoteCard.swift): the
// vote presents as a native, centered, BLOCKING card. On the phone the question deserves the screen;
// answering it is the way back to the board. No clock renders anywhere — no ring, no drain, no digits
// — the elector pucks settling as ballots land are the only live signal, and the timebox is felt only
// as the lapse line. The card wears the app's chrome material (an opaque canvas surface over one modal
// shadow; Android has no glass, so the liner is fully opaque rather than iOS's glass + 0.55 canvas)
// so live cells never smear through, and its scrim consumes BOTH taps and drags — nothing reaches the
// deck or the grid.
//
// Dismissal is policy, not posture (CheckVoteCardPolicy, pinned in CheckVoteBenchModel): the elector's
// ballot is the only exit and their card shows no grabber and swallows predictive back; the proposer
// and a non-elector — who have no verb and no vote-cancel on the wire — get the sheet grammar (a
// grabber, swipe down, scrim tap, predictive back) and may return to the board while the vote runs.
// The resolution re-presents in the card, scrim lifted (the room has answered; the board is already
// back), for the ~2.5 s recess (U7). A pass condenses into CheckVoteStatusCapsule instead: "Checking…"
// through the breath and the wash, then "{n} to fix" lands there last (U6). All copy and timing are
// CheckVoteBenchModel's; the composable only lays out and animates.

package crossy.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.activity.compose.BackHandler
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.design.Motion
import crossy.store.VoteView

// MARK: - Motion (the tuned springs, iOS → Compose)

/** SwiftUI `response` maps to a Compose `stiffness` as the natural frequency squared (omega =
 *  2pi/response, stiffness = omega^2); the SwiftUI damping fraction is the Compose dampingRatio. The
 *  WordLoupe chrome-spring translation, here for the card's three registers. */
private fun stiffnessFor(responseMs: Int): Float {
    val response = responseMs / 1000.0
    val omega = 2.0 * Math.PI / response
    return (omega * omega).toFloat()
}

/** The card's arrival (Wave 15.12): a people surface, a whisper of life (iOS voteCard spring,
 *  response 0.40 / damping 0.85). */
private val ArrivalStiffness = stiffnessFor(Motion.Springs.voteCardResponseMs)
private val ArrivalDamping = Motion.Springs.voteCardDampingFraction.toFloat()

/** The withdrawal and every act change: the standing chrome spring, no overshoot (response 0.30 /
 *  damping 1.0). */
private val ChromeStiffness = stiffnessFor(Motion.Springs.chromeResponseMs)
private val ChromeDamping = Motion.Springs.chromeDampingFraction.toFloat()

/** The puck's settle: people may overshoot (celebration spring, response 0.45 / damping 0.78). */
private val CelebrationStiffness = stiffnessFor(Motion.Springs.celebrationResponseMs)
private val CelebrationDamping = Motion.Springs.celebrationDampingFraction.toFloat()

private fun <T> arrivalSpring(): FiniteAnimationSpec<T> = spring(dampingRatio = ArrivalDamping, stiffness = ArrivalStiffness)

private fun <T> chromeSpring(): FiniteAnimationSpec<T> = spring(dampingRatio = ChromeDamping, stiffness = ChromeStiffness)

/** The card's enter transition: the arrival spring scales it up from 0.94 with a fade; Reduce Motion
 *  crossfades (no scale, no spring). Twin of iOS voteCardTransition + checkVoteArrival. */
private fun cardEnter(reduceMotion: Boolean): EnterTransition =
    if (reduceMotion) fadeIn() else fadeIn(arrivalSpring()) + scaleIn(arrivalSpring(), initialScale = 0.94f)

/** The card's exit: the chrome spring settles it away (scale to 0.94 with a fade); Reduce Motion
 *  crossfades. */
private fun cardExit(reduceMotion: Boolean): ExitTransition =
    if (reduceMotion) fadeOut() else fadeOut(chromeSpring()) + scaleOut(chromeSpring(), targetScale = 0.94f)

// MARK: - The card layer

/**
 * The vote's card layer, mounted as the top overlay of the room (twin of iOS checkVoteLayer). A live
 * multiplayer vote presents the blocking card over its scrim (never for a solo electorate; the caller
 * gates solo out); a viewer without a castable ballot may have put it away ([dismissed]), in which
 * case the board stands and only the resolution re-presents. A failed or lapsed close plays its calm
 * line in the card for the ~2.5 s recess, scrim lifted (the room has answered). A pass yields to the
 * board for the wash and speaks through [CheckVoteStatusCapsule] instead, so it renders nothing here.
 *
 * @param vote the open vote to present, or null when none is open (or it is solo, or dismissed away).
 * @param resolution a closed vote animating out; only [VoteResolution.Ended] renders a card here.
 * @param dismissed the viewer put the card away (only possible when [CheckVoteBenchModel.cardDismissible]).
 * @param nameFor a departed/unknown member resolves to null; the model supplies the collective fallback.
 * @param wireColorFor the member's `#RRGGBB` wire color for the puck's roster slot, or null to hash the id.
 * @param avatarFor the resolved avatar for the member's url, or null for the colored initial.
 */
@Composable
fun CheckVoteCardLayer(
    vote: VoteView?,
    resolution: VoteResolution?,
    dismissed: Boolean,
    selfUserId: String?,
    ground: GridGround,
    reduceMotion: Boolean,
    nameFor: (String) -> String?,
    wireColorFor: (String) -> String?,
    avatarFor: (String) -> String?,
    ballotPending: Boolean,
    onApprove: () -> Unit,
    onKeepSolving: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    avatars: RosterAvatars = RosterAvatars.none,
) {
    // The blocking open card stands only for a live vote the viewer has not put away. A dismissible
    // viewer's dismissal returns the board; an elector's card cannot be dismissed (their ballot is the
    // exit), so `dismissed` can never strand a castable ballot off screen.
    val blocking = vote != null && !dismissed
    val dismissible = vote != null && CheckVoteBenchModel.cardDismissible(vote, selfUserId)
    // The Ended resolution re-presents in the card (non-blocking); a passing close speaks through the
    // capsule, so it renders nothing here. A terminal (or unknown-reason) close has no line, so it
    // shows no card at all (the completion/abandon surface supersedes, U1).
    val ended = resolution as? VoteResolution.Ended
    val endedLine = ended?.let { CheckVoteBenchModel.resolutionLine(it, 0L) }

    Box(modifier = modifier.fillMaxSize()) {
        // The scrim: the ground's canvas washed over the screen plus a black weight, consuming every
        // touch (taps and drags) so play genuinely pauses under the question. A tap reports up; the
        // caller dismisses when policy allows and ignores it for an elector.
        AnimatedVisibility(
            visible = blocking,
            enter = fadeIn(if (reduceMotion) chromeSpring() else arrivalSpring()),
            exit = fadeOut(chromeSpring()),
        ) {
            CheckVoteScrim(ground = ground, onTap = { if (dismissible) onDismiss() })
        }

        // Predictive back mirrors the sheet grammar: a dismissible card puts itself away; an elector's
        // blocking card swallows back (their ballot is the exit, never the system gesture).
        BackHandler(enabled = blocking) { if (dismissible) onDismiss() }

        // The open, blocking card.
        AnimatedVisibility(
            visible = blocking,
            enter = cardEnter(reduceMotion),
            exit = cardExit(reduceMotion),
            modifier = Modifier.align(Alignment.Center),
        ) {
            if (vote != null) {
                CheckVoteCard(
                    ground = ground,
                    reduceMotion = reduceMotion,
                    interactive = true,
                    proposalLine = CheckVoteBenchModel.proposalLine(vote, selfUserId, nameFor(vote.by)),
                    chips = CheckVoteBenchModel.chips(vote, selfUserId, nameFor),
                    showVerbs = CheckVoteBenchModel.showVerbs(vote, selfUserId),
                    dismissible = dismissible,
                    ballotPending = ballotPending,
                    resolution = null,
                    proposerTally = null,
                    wireColorFor = wireColorFor,
                    avatarFor = avatarFor,
                    avatars = avatars,
                    onApprove = onApprove,
                    onKeepSolving = onKeepSolving,
                    onDismiss = onDismiss,
                )
            }
        }

        // The resolution card: the calm close line (and the proposer's tally) for the recess, scrim
        // lifted, inert to touch (the room has answered; the board is already back). A pass never
        // lands here, and a lineless terminal close shows nothing.
        AnimatedVisibility(
            visible = !blocking && endedLine != null,
            enter = cardEnter(reduceMotion),
            exit = cardExit(reduceMotion),
            modifier = Modifier.align(Alignment.Center),
        ) {
            if (endedLine != null) {
                CheckVoteCard(
                    ground = ground,
                    reduceMotion = reduceMotion,
                    interactive = false,
                    proposalLine = "",
                    chips = emptyList(),
                    showVerbs = false,
                    dismissible = false,
                    ballotPending = false,
                    resolution = endedLine,
                    proposerTally = ended?.let { CheckVoteBenchModel.proposerTally(it) },
                    wireColorFor = wireColorFor,
                    avatarFor = avatarFor,
                    avatars = avatars,
                    onApprove = {},
                    onKeepSolving = {},
                    onDismiss = {},
                )
            }
        }
    }
}

// MARK: - The scrim

/** The blocking dim under the card (twin of iOS CheckVoteScrim): two washes, one dim — the canvas
 *  unifies the room under its own paper, the black lends the modal weight. It consumes every touch,
 *  taps and drags alike, and reports a near-stationary release up as a tap. Decorative to a11y. */
@Composable
private fun CheckVoteScrim(ground: GridGround, onTap: () -> Unit) {
    val onTapState = rememberUpdatedState(onTap)
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ground.tokens.canvas.toColor().copy(alpha = 0.40f))
            .background(Color.Black.copy(alpha = 0.14f))
            // One gesture consumes both taps and drags (no pass-through): every pointer change is
            // consumed so nothing reaches the grid or deck, and a near-stationary release is the tap.
            // A gesture the card above already claimed (a tap on the card body) is still swallowed but
            // never reported as a scrim tap, so tapping the card can never dismiss it.
            .pointerInput(Unit) {
                val slop = 10f * density
                awaitPointerEventScope {
                    while (true) {
                        val down = awaitPointerEvent().changes.firstOrNull { it.pressed } ?: continue
                        val claimedAbove = down.isConsumed
                        var maxTravel = 0f
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == down.id }
                            if (change != null) {
                                change.consume()
                                maxTravel = maxOf(maxTravel, (change.position - down.position).getDistance())
                                if (!change.pressed) {
                                    if (maxTravel < slop && !claimedAbove) onTapState.value()
                                    break
                                }
                            }
                            if (event.changes.none { it.pressed }) break
                        }
                    }
                }
            }
            .clearAndSetSemantics {},
    )
}

// MARK: - The card

/** The card as pixels (twin of iOS CheckVoteCard): the open posture (proposal line, elector pucks,
 *  the two verbs) or the resolution posture (the one calm line, the proposer's tally). Width capped,
 *  seated a hair above center, on the app's opaque canvas material over one modal shadow. */
@Composable
private fun CheckVoteCard(
    ground: GridGround,
    reduceMotion: Boolean,
    // The open card blocks: it swallows stray taps so nothing falls to the scrim beneath. The
    // resolution card is inert (no scrim to guard, the board is already back), so it lets touches pass.
    interactive: Boolean,
    proposalLine: String,
    chips: List<ElectorChip>,
    showVerbs: Boolean,
    dismissible: Boolean,
    ballotPending: Boolean,
    resolution: String?,
    proposerTally: String?,
    wireColorFor: (String) -> String?,
    avatarFor: (String) -> String?,
    avatars: RosterAvatars,
    onApprove: () -> Unit,
    onKeepSolving: () -> Unit,
    onDismiss: () -> Unit,
) {
    val tokens = ground.tokens
    val ink = tokens.ink.toColor()
    val onDismissState = rememberUpdatedState(onDismiss)
    // The card floats a hair above true center: the deck weighs the screen's foot, so the optical
    // middle sits higher than the geometric one (iOS offset y -24).
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .offset(y = (-24).dp)
            .padding(horizontal = 28.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 340.dp)
                .fillMaxWidth()
                // The one shadow in the vote's chrome (iOS shadow radius 28, y 10): the card floats OVER
                // the room, so it separates from the canvas the way a system alert does.
                .shadow(elevation = 16.dp, shape = RoundedCornerShape(28.dp), clip = false)
                .clip(RoundedCornerShape(28.dp))
                // The opaque canvas liner (Android's answer to iOS glass + 0.55 canvas): fully opaque so
                // live cells — block cells included — never smear through the card.
                .background(tokens.canvas.toColor())
                // A dismissible card puts itself away on a downward swipe (the sheet grammar).
                .pointerInput(dismissible) {
                    if (dismissible) {
                        var drag = 0f
                        detectVerticalDragGestures(
                            onDragStart = { drag = 0f },
                            onDragEnd = { if (drag > 32f * density) onDismissState.value() },
                        ) { change, amount ->
                            change.consume()
                            if (amount > 0) drag += amount
                        }
                    }
                }
                // The open card swallows stray taps so nothing reaches the scrim beneath (the verbs are
                // children and win); the inert resolution card lets touches through to the live board.
                .then(
                    if (interactive) {
                        Modifier.pointerInput(Unit) {
                            awaitPointerEventScope { while (true) { awaitPointerEvent().changes.forEach { if (!it.isConsumed) it.consume() } } }
                        }
                    } else {
                        Modifier
                    },
                )
                .semantics {
                    paneTitle = "Check vote"
                    isTraversalGroup = true
                    traversalIndex = -1f
                },
        ) {
            if (resolution != null) {
                ResolutionBody(resolution = resolution, tally = proposerTally, ink = ink, ground = ground)
            } else {
                OpenBody(
                    ground = ground,
                    reduceMotion = reduceMotion,
                    proposalLine = proposalLine,
                    chips = chips,
                    showVerbs = showVerbs,
                    dismissible = dismissible,
                    ballotPending = ballotPending,
                    wireColorFor = wireColorFor,
                    avatarFor = avatarFor,
                    avatars = avatars,
                    onApprove = onApprove,
                    onKeepSolving = onKeepSolving,
                )
            }
        }
    }
}

@Composable
private fun OpenBody(
    ground: GridGround,
    reduceMotion: Boolean,
    proposalLine: String,
    chips: List<ElectorChip>,
    showVerbs: Boolean,
    dismissible: Boolean,
    ballotPending: Boolean,
    wireColorFor: (String) -> String?,
    avatarFor: (String) -> String?,
    avatars: RosterAvatars,
    onApprove: () -> Unit,
    onKeepSolving: () -> Unit,
) {
    val ink = ground.tokens.ink.toColor()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 22.dp)
            .padding(top = 12.dp, bottom = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // A grabber for a dismissible card (the sheet grammar); an elector's card shows none (their
        // ballot is the exit), holding the same 5 dp of top breath.
        if (dismissible) {
            Box(
                modifier = Modifier
                    .width(36.dp)
                    .height(5.dp)
                    .clip(RoundedCornerShape(50))
                    .background(ink.copy(alpha = 0.22f)),
            )
        } else {
            Spacer(Modifier.height(5.dp))
        }
        Text(
            text = proposalLine,
            color = ink,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        PuckRow(
            chips = chips,
            ground = ground,
            reduceMotion = reduceMotion,
            wireColorFor = wireColorFor,
            avatarFor = avatarFor,
            avatars = avatars,
        )
        if (showVerbs) {
            Verbs(ground = ground, enabled = !ballotPending, onApprove = onApprove, onKeepSolving = onKeepSolving)
        }
    }
}

/** The electorate as faces (U5): real roster pucks in electorate order. An unvoted puck waits small
 *  and dim; a ballot settles it — full presence, full size, its mark riding the corner — on the people
 *  spring. Decorative to a11y: the row speaks one merged summary that updates per ballot (the
 *  announcements carry the motion; no tally is ever spoken). */
@Composable
private fun PuckRow(
    chips: List<ElectorChip>,
    ground: GridGround,
    reduceMotion: Boolean,
    wireColorFor: (String) -> String?,
    avatarFor: (String) -> String?,
    avatars: RosterAvatars,
) {
    Row(
        modifier = Modifier.clearAndSetSemantics { contentDescription = CheckVoteBenchModel.chipsSummary(chips) },
        horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (chip in chips) {
            Puck(
                chip = chip,
                ground = ground,
                reduceMotion = reduceMotion,
                wireColor = wireColorFor(chip.userId),
                avatar = avatars.bitmap(avatarFor(chip.userId)),
            )
        }
    }
}

@Composable
private fun Puck(
    chip: ElectorChip,
    ground: GridGround,
    reduceMotion: Boolean,
    wireColor: String?,
    avatar: ImageBitmap?,
) {
    val voted = chip.vote != ChipVote.UNVOTED
    // The ballot settles the puck to full presence on the people spring; an unvoted puck waits at 0.35
    // opacity and 0.86 scale. Reduce Motion snaps to the resting values (no spring, no overshoot).
    val settle: FiniteAnimationSpec<Float> =
        if (reduceMotion) spring(stiffness = Spring.StiffnessHigh) else spring(dampingRatio = CelebrationDamping, stiffness = CelebrationStiffness)
    val target = if (voted) 1f else 0.86f
    val scaleValue by animateFloatAsState(target, settle, label = "puckScale")
    val alphaValue by animateFloatAsState(if (voted) 1f else 0.35f, settle, label = "puckAlpha")
    Box(contentAlignment = Alignment.BottomEnd) {
        Box(
            modifier = Modifier
                .scale(scaleValue)
                .alpha(alphaValue),
        ) {
            RosterPuck(
                userId = chip.userId,
                displayName = chip.name,
                ground = ground,
                diameter = 44.dp,
                wireColor = wireColor,
                avatar = avatar,
            )
        }
        if (voted) {
            BallotMark(approved = chip.vote == ChipVote.APPROVED, ground = ground)
        }
    }
}

/** The settled puck's mark riding the bottom-trailing corner: a check on the warm gold for a Check
 *  it, a cross on dimmed ink for a Keep solving, ringed in the cell tone so it reads off any puck. */
@Composable
private fun BallotMark(approved: Boolean, ground: GridGround) {
    val fill = if (approved) AnalysisPalette.gold(ground).toColor() else ground.tokens.ink.toColor().copy(alpha = 0.55f)
    Box(
        modifier = Modifier
            .offset(x = 3.dp, y = 3.dp)
            .size(18.dp)
            .clip(CircleShape)
            .background(ground.tokens.cell.toColor())
            .padding(1.5.dp)
            .clip(CircleShape)
            .background(fill),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (approved) "✓" else "✕",
            color = Color.White,
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/** The two verbs (U1): "Keep solving" quiet on a faint ink wash, "Check it" primary in the warm gold
 *  (never an identity color, so a verb can never be mistaken for a voter). Both settle disabled while
 *  a ballot is in flight so a double-tap cannot send a second doomed ballot. */
@Composable
private fun Verbs(ground: GridGround, enabled: Boolean, onApprove: () -> Unit, onKeepSolving: () -> Unit) {
    val ink = ground.tokens.ink.toColor()
    val gold = AnalysisPalette.gold(ground).toColor()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        VerbButton(
            label = VoteCopy.KEEP_SOLVING,
            textColor = ink,
            background = ink.copy(alpha = 0.08f),
            weight = FontWeight.Medium,
            enabled = enabled,
            modifier = Modifier.weight(1f),
            onClick = onKeepSolving,
        )
        VerbButton(
            label = VoteCopy.CHECK_IT,
            textColor = Color.White,
            background = gold,
            weight = FontWeight.SemiBold,
            enabled = enabled,
            modifier = Modifier.weight(1f),
            onClick = onApprove,
        )
    }
}

@Composable
private fun VerbButton(
    label: String,
    textColor: Color,
    background: Color,
    weight: FontWeight,
    enabled: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val onClickState = rememberUpdatedState(onClick)
    Box(
        modifier = modifier
            .heightIn(min = 50.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (enabled) background else background.copy(alpha = 0.5f))
            .alpha(if (enabled) 1f else 0.5f)
            .pointerInput(enabled) {
                if (enabled) detectTapGestures { onClickState.value() }
            }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = textColor,
            fontSize = 16.sp,
            fontWeight = weight,
            modifier = Modifier.padding(vertical = 13.dp, horizontal = 8.dp),
        )
    }
}

/** The resolution posture (U7): the one calm close line, plus the proposer-only post-fail tally in the
 *  warm gold, together or not at all. No pucks (the chips already told anyone watching), no verbs. */
@Composable
private fun ResolutionBody(resolution: String, tally: String?, ink: Color, ground: GridGround) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 26.dp, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = resolution,
            color = ink,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
        )
        if (tally != null) {
            Text(
                text = tally,
                color = AnalysisPalette.gold(ground).toColor(),
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                style = TextStyle.Default.withTabularNumerals(),
            )
        }
    }
}

// MARK: - The status capsule

/** The pass's condensed voice (U6; twin of iOS CheckVoteStatusCapsule): a small capsule above the clue
 *  bar carrying "Checking…" through the breath and the wash, then "{n} to fix", landing last. Inert to
 *  touch — the board is the star; this is the caption. Its live-region text announces each beat. */
@Composable
fun CheckVoteStatusCapsule(text: String, ground: GridGround, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .heightIn(min = 40.dp)
            .shadow(elevation = 8.dp, shape = RoundedCornerShape(20.dp), clip = false)
            .clip(RoundedCornerShape(20.dp))
            .background(ground.tokens.canvas.toColor())
            .padding(horizontal = 18.dp)
            .semantics { contentDescription = text },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            color = ground.tokens.ink.toColor(),
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            style = TextStyle.Default.withTabularNumerals(),
        )
    }
}

