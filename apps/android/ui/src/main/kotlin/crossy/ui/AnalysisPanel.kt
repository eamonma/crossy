// The post-game analysis surface's content (owner ruling 2026-07-13; twin of apps/ios AnalysisPanel
// .swift): the same readout the web panel carries, re-set native on the bone/void ground. It rides
// inside the completed clue browser's Analysis tab (ClueBar), so this is content only, no scroll of its
// own and no chrome: the "Solved together" eyebrow, the Time/Solvers/Squares trio, the roster legend,
// the momentum ribbon, and the title cards (design/post-game/TITLES.md; the person moment cards, First
// square and Last square, retired in their favor).
//
// Everything here is first-correct truth from GET /analysis (RoomAnalysis): the legend and the titles
// read the bundle's userIds, colored through the same roster seam the avatars and the mosaic use
// (IdentityRoster wire-else-hash, then paired for the ground). No solve value is in reach (INV-6): the
// bundle carries userIds, cells, and numbers only. The derivations are pure and Compose-free, so tests
// pin the legend order, the stat trio, and the caption without a view.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import crossy.design.IdentityRoster
import crossy.design.RGBColor

/** The completed room's user-facing lexicon (twin of the iOS AnalysisPanel copy). The eyebrow reuses
 *  the one "Solved together" sentence the terminal chrome already owns (RoomTerminal.completedNotice),
 *  so the clients never drift on it; the rest are the analysis surface's own sentences. */
object AnalysisCopy {
    /** The gold eyebrow, the same lexicon sentence the solved notice reads, uppercased at the draw. */
    val eyebrow: String get() = RoomTerminal.completedNotice

    const val loading: String = "Loading…"
    const val absent: String = "Analysis isn’t available for this game."
    const val legendCaption: String = "Each square shows who solved it first."

    /** The legend caption once the chips can isolate a solver, none isolated: the tappability
     *  affordance in words (twin of the iOS legendCaption's tappable branch). */
    const val legendCaptionTappable: String =
        "Each square shows who solved it first. Tap a solver to see just theirs."

    /** The caption while the self's own squares are isolated. */
    const val legendCaptionIsolatedSelf: String = "Showing only your squares. Tap again for everyone."

    /** The caption while another solver's squares are isolated (their name interpolated). */
    fun legendCaptionIsolatedOther(name: String): String =
        "Showing only ${name}’s squares. Tap again for everyone."

    /** A legend chip's accessibility hint (iOS accessibilityHint): what a tap does, per selected state. */
    const val isolateHintClear: String = "Shows everyone’s squares again."
    const val isolateHintSelf: String = "Shows only your squares on the board."
    const val isolateHintOther: String = "Shows only their squares on the board."
    const val momentumLabel: String = "Momentum"
    const val titlesLabel: String = "Titles"
    const val timeLabel: String = "Time"
    const val solversLabel: String = "Solvers"
    const val squaresLabel: String = "Squares"
    const val you: String = "You"
    const val aSolver: String = "A solver"

    /** The one line that reads the ribbon, the web copy. The plain form when there is no pause to
     *  shade (a short solve, or a seeded fixture); the stalled form when the turning point marks one. */
    const val momentumCaptionPlain: String =
        "Height tracks solving speed over the course of the solve."
    const val momentumCaptionStalled: String =
        "Height tracks solving speed. The shaded span is the room’s longest pause; the marker is where solving picked back up."
}

/** One legend chip's facts: the owner, their name ("You" for self), and their roster color. */
data class AnalysisLegendRow(
    val userId: String,
    val name: String,
    val color: RGBColor,
    val isSelf: Boolean,
)

/** The analysis panel's pure derivations (twin of the iOS AnalysisPanel private helpers): the legend
 *  order, the stat trio, the moment names, the roster colors, and the ribbon caption. Pure and
 *  Compose-free, so the tests pin them against iOS without a view. */
object AnalysisPanelModel {
    /** The solvers who own at least one square, self first and named "You" (the web's legendSolvers). A
     *  member who owns nothing is dropped; an owner no longer in the roster is not invented here (the
     *  titles still name them). Twin of the iOS legendRows. */
    fun legendRows(
        analysis: RoomAnalysis,
        members: List<RosterMember>,
        selfUserId: String?,
        ground: GridGround,
    ): List<AnalysisLegendRow> {
        val owners = analysis.owners.values.toSet()
        val rows = mutableListOf<AnalysisLegendRow>()
        for (member in members) {
            if (member.userId !in owners) continue
            val isSelf = member.userId == selfUserId
            val row = AnalysisLegendRow(
                userId = member.userId,
                name = if (isSelf) AnalysisCopy.you else member.displayName,
                color = colorFor(member.userId, members, ground),
                isSelf = isSelf,
            )
            if (isSelf) rows.add(0, row) else rows.add(row)
        }
        return rows
    }

    /** The legend's one caption: what the squares mean; then, once the chips can isolate (tappable),
     *  what a tap does; then who is isolated. Matches the web/iOS legend caption grammar. `tappable` is
     *  false until the mosaic wash settles (a bloom in flight leaves the chips plain labels). Pure and
     *  Compose-free, so the copy pins headlessly. Twin of the iOS legendCaption. */
    fun legendCaption(
        rows: List<AnalysisLegendRow>,
        isolatedSolverId: String?,
        tappable: Boolean,
    ): String {
        if (!tappable) return AnalysisCopy.legendCaption
        val isolated = rows.firstOrNull { it.userId == isolatedSolverId }
        return when {
            isolated == null -> AnalysisCopy.legendCaptionTappable
            isolated.isSelf -> AnalysisCopy.legendCaptionIsolatedSelf
            else -> AnalysisCopy.legendCaptionIsolatedOther(isolated.name)
        }
    }

    /** The stat trio as (label, value, context) triples: Time (M:SS), Solvers, Squares. The Time cell
     *  carries the sitting-count context ("2 sittings", owner ruling D29), only at two or more; the
     *  other two never do. Twin of the iOS statTrio. */
    fun statTrio(analysis: RoomAnalysis): List<Triple<String, String, String?>> = listOf(
        Triple(AnalysisCopy.timeLabel, analysis.durationLabel, analysis.sittingCountSuffix),
        Triple(AnalysisCopy.solversLabel, analysis.solverCount.toString(), null),
        Triple(AnalysisCopy.squaresLabel, analysis.entryCount.toString(), null),
    )

    /** The one line that reads the ribbon, matching the web copy: the stalled form when there is a
     *  pause to shade, the short-solve fallback otherwise. Twin of the iOS momentumCaption. */
    fun momentumCaption(analysis: RoomAnalysis): String =
        if (analysis.momentum.hasSignal && analysis.turningPoint != null) {
            AnalysisCopy.momentumCaptionStalled
        } else {
            AnalysisCopy.momentumCaptionPlain
        }

    /** A solver's name for the title cards: "You", the roster display name, or a plain fallback for
     *  someone who has left (a titled solver can outlive their roster row). Twin of the iOS name(for:). */
    fun nameFor(userId: String, members: List<RosterMember>, selfUserId: String?): String {
        if (userId == selfUserId) return AnalysisCopy.you
        return members.firstOrNull { it.userId == userId }?.displayName ?: AnalysisCopy.aSolver
    }

    /** The roster color for a userId, through the same seam the avatars and mosaic use: the member's
     *  wire color when known, the userId hash otherwise (IdentityRoster.colorForWireColor tolerates an
     *  empty wire and falls back), then paired for this ground. Twin of the iOS color(for:). */
    fun colorFor(userId: String, members: List<RosterMember>, ground: GridGround): RGBColor {
        val wire = members.firstOrNull { it.userId == userId }?.wireColor ?: ""
        val identity = IdentityRoster.colorForWireColor(wire) ?: IdentityRoster.color(userId)
        return ground.rosterColor(identity)
    }
}

/** The analysis panel, rendered from the fetch phase. Loading and absent read the quiet line under the
 *  eyebrow (the iOS placeholder); a ready bundle draws the full readout. Content only: the ClueBar's
 *  sheet owns the scroll and the surface. */
@Composable
fun AnalysisPanel(
    phase: AnalysisModel.Phase,
    members: List<RosterMember>,
    selfUserId: String?,
    ground: GridGround,
    modifier: Modifier = Modifier,
    // The isolated solver on the settled wash (the legend chips' selected state), or null at the full
    // multi-color record. Twin of the iOS isolatedSolverId.
    isolatedSolverId: String? = null,
    // Isolate a solver from their legend chip: same-tap clears, another switches (MosaicMoment
    // .toggleIsolation up in RoomScreen). Null while isolation is unavailable (the bloom still playing,
    // or no completed wash), where the chips stay the plain labels they always were. Twin of the iOS
    // onIsolateSolver.
    onIsolateSolver: ((String) -> Unit)? = null,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 6.dp)
            .padding(top = 10.dp, bottom = 22.dp)
            .semantics { contentDescription = "Post-game analysis" },
    ) {
        when (phase) {
            AnalysisModel.Phase.Idle, AnalysisModel.Phase.Loading -> Placeholder(AnalysisCopy.loading, ground)
            AnalysisModel.Phase.Absent -> Placeholder(AnalysisCopy.absent, ground)
            is AnalysisModel.Phase.Ready ->
                Content(phase.bundle, members, selfUserId, ground, isolatedSolverId, onIsolateSolver)
        }
    }
}

@Composable
private fun Placeholder(text: String, ground: GridGround) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Eyebrow(ground)
        Text(text, color = ground.tokens.number.toColor(), fontSize = 14.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Content(
    analysis: RoomAnalysis,
    members: List<RosterMember>,
    selfUserId: String?,
    ground: GridGround,
    isolatedSolverId: String? = null,
    onIsolateSolver: ((String) -> Unit)? = null,
) {
    val tokens = ground.tokens
    Eyebrow(ground)
    StatTrio(analysis, ground, modifier = Modifier.padding(top = 12.dp))

    val legend = AnalysisPanelModel.legendRows(analysis, members, selfUserId, ground)
    if (legend.isNotEmpty()) {
        // Tighter chip spacing once the rows wear the tappable capsule (its own padding carries the
        // air); the plain labels keep theirs (iOS FlowLayout spacing 8 vs 14).
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(if (onIsolateSolver == null) 14.dp else 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (row in legend) {
                LegendChip(
                    row = row,
                    isIsolated = row.userId == isolatedSolverId,
                    ground = ground,
                    onIsolate = onIsolateSolver,
                )
            }
        }
        Text(
            AnalysisPanelModel.legendCaption(legend, isolatedSolverId, tappable = onIsolateSolver != null),
            color = tokens.number.toColor().copy(alpha = 0.85f),
            fontSize = 11.sp,
            modifier = Modifier.padding(top = 6.dp),
        )
    }

    CapsLabel(AnalysisCopy.momentumLabel, ground, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
    MomentumRibbon(
        momentum = analysis.momentum,
        turningPoint = analysis.turningPoint,
        ground = ground,
        sittings = analysis.sittings,
    )
    Text(
        AnalysisPanelModel.momentumCaption(analysis),
        color = tokens.number.toColor().copy(alpha = 0.85f),
        fontSize = 11.sp,
        modifier = Modifier.padding(top = 8.dp),
    )

    // Titles: everyone's superlative (design/post-game/TITLES.md), one card per titled solver, in the
    // wire's ladder-rank order (reordering client-side would fork the two platforms' surfaces). An
    // unknown key renders nothing (PROTOCOL §12: a client MUST ignore an unknown key; that is how the
    // ladder grows), and a solo solve (or an older API) ships no titles, so the section vanishes
    // entirely, never an empty-state box.
    val cards = analysis.titles.mapNotNull { TitleLadder.card(it) }
    if (cards.isNotEmpty()) {
        CapsLabel(AnalysisCopy.titlesLabel, ground, modifier = Modifier.padding(top = 22.dp, bottom = 2.dp))
        Column {
            cards.forEachIndexed { index, card ->
                if (index > 0) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(tokens.number.toColor().copy(alpha = 0.18f)),
                    )
                }
                TitleRow(card, members, selfUserId, ground)
            }
        }
    }
}

/** One legend row. Once the wash settles (`onIsolate` non-null) the row is a button that isolates its
 *  solver on the board: a quiet hairline capsule marks it tappable (the stat trio's border vocabulary),
 *  and the selected chip wears its solver's color, the dot always colored but the chrome otherwise
 *  achromatic (DESIGN.md §3). TalkBack reads a button with a meaningful hint (onClickLabel) and the
 *  selected trait. While the bloom still plays (`onIsolate` null) the row is the plain label it always
 *  was, keeping the file's existing legend idiom. Twin of the iOS legendChip. */
@Composable
private fun LegendChip(
    row: AnalysisLegendRow,
    isIsolated: Boolean,
    ground: GridGround,
    onIsolate: ((String) -> Unit)?,
) {
    val tokens = ground.tokens
    val emphasized = row.isSelf || isIsolated
    val label: @Composable () -> Unit = {
        Box(
            Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(row.color.toColor()),
        )
        Text(
            row.name,
            color = (if (emphasized) tokens.ink else tokens.number).toColor(),
            fontSize = 12.5.sp,
            fontWeight = if (emphasized) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
    if (onIsolate == null) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) { label() }
        return
    }
    val hint = when {
        isIsolated -> AnalysisCopy.isolateHintClear
        row.isSelf -> AnalysisCopy.isolateHintSelf
        else -> AnalysisCopy.isolateHintOther
    }
    val capsule = RoundedCornerShape(percent = 50)
    val borderColor =
        if (isIsolated) row.color.toColor().copy(alpha = 0.55f) else tokens.number.toColor().copy(alpha = 0.22f)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        modifier = Modifier
            .clip(capsule)
            .background(if (isIsolated) row.color.toColor().copy(alpha = 0.16f) else Color.Transparent)
            .border(1.dp, borderColor, capsule)
            .semantics { selected = isIsolated }
            .clickable(role = Role.Button, onClickLabel = hint) { onIsolate(row.userId) }
            .padding(horizontal = 9.dp, vertical = 5.dp),
    ) { label() }
}

@Composable
private fun StatTrio(analysis: RoomAnalysis, ground: GridGround, modifier: Modifier = Modifier) {
    val tokens = ground.tokens
    val digits = TextStyle(fontFamily = FontFamily.Monospace).withTabularNumerals()
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .border(1.dp, tokens.number.toColor().copy(alpha = 0.22f), RoundedCornerShape(14.dp)),
        // Top-aligned so the caps labels stay on one line when the Time cell grows its context caption;
        // without a caption nothing moves (iOS HStack alignment .top).
        verticalAlignment = Alignment.Top,
    ) {
        AnalysisPanelModel.statTrio(analysis).forEachIndexed { index, cell ->
            if (index > 0) {
                Box(
                    Modifier
                        .width(1.dp)
                        .height(52.dp)
                        .background(tokens.number.toColor().copy(alpha = 0.18f)),
                )
            }
            val (label, value, context) = cell
            Column(
                modifier = Modifier.weight(1f).padding(vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                CapsLabel(label, ground)
                Text(value, color = tokens.ink.toColor(), fontSize = 21.sp, style = digits)
                // The Time cell's quiet context (owner ruling, D29): active time is THE time and the
                // sitting count is context, never a second stat, so it rides inside the cell as a small
                // caption ("2 sittings"), only at two or more. A single sitting and an older bundle read
                // exactly as today.
                if (context != null) {
                    Text(
                        context,
                        color = tokens.number.toColor().copy(alpha = 0.85f),
                        fontSize = 11.sp,
                        style = digits,
                    )
                }
            }
        }
    }
}

/** One title card, the retired moment row's exact grammar plus the evidence line: the solver's dot, the
 *  title's caps label, the name, and the claim (nothing when the rung's number did not arrive; the card
 *  degrades to the label alone). Twin of the iOS titleRow. */
@Composable
private fun TitleRow(
    card: TitleCard,
    members: List<RosterMember>,
    selfUserId: String?,
    ground: GridGround,
) {
    val tokens = ground.tokens
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Box(
            Modifier
                .size(11.dp)
                .clip(RoundedCornerShape(50))
                .background(AnalysisPanelModel.colorFor(card.userId, members, ground).toColor()),
        )
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            CapsLabel(card.label, ground)
            Text(
                AnalysisPanelModel.nameFor(card.userId, members, selfUserId),
                color = tokens.ink.toColor(),
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
            card.detail?.let { detail ->
                Text(
                    detail,
                    color = tokens.number.toColor().copy(alpha = 0.85f),
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun Eyebrow(ground: GridGround) {
    Text(
        AnalysisCopy.eyebrow.uppercase(),
        color = AnalysisPalette.goldText(ground).toColor(),
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.4.sp,
    )
}

@Composable
private fun CapsLabel(text: String, ground: GridGround, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        color = ground.tokens.number.toColor(),
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.1.sp,
        modifier = modifier,
    )
}
