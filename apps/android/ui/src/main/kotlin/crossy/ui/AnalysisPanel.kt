// The post-game analysis surface's content (owner ruling 2026-07-13; twin of apps/ios AnalysisPanel
// .swift): the same readout the web panel carries, re-set native on the bone/void ground. It rides
// inside the completed clue browser's Analysis tab (ClueBar), so this is content only, no scroll of its
// own and no chrome: the "Solved together" eyebrow, the Time/Solvers/Squares trio, the roster legend,
// the momentum ribbon, and the two moment cards.
//
// Everything here is first-correct truth from GET /analysis (RoomAnalysis): the legend and the moments
// read the owners map's userIds, colored through the same roster seam the avatars and the mosaic use
// (IdentityRoster wire-else-hash, then paired for the ground). No solve value is in reach (INV-6): the
// bundle carries userIds, cells, and numbers only. The derivations are pure and Compose-free, so tests
// pin the legend order, the stat trio, and the caption without a view.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.semantics.contentDescription
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
    const val momentumLabel: String = "Momentum"
    const val momentsLabel: String = "Moments"
    const val timeLabel: String = "Time"
    const val solversLabel: String = "Solvers"
    const val squaresLabel: String = "Squares"
    const val firstSquare: String = "First square"
    const val lastSquare: String = "Last square"
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
     *  moments still name them). Twin of the iOS legendRows. */
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

    /** The stat trio as (label, value) pairs: Time (M:SS), Solvers, Squares. Twin of the iOS statTrio. */
    fun statTrio(analysis: RoomAnalysis): List<Pair<String, String>> = listOf(
        AnalysisCopy.timeLabel to analysis.durationLabel,
        AnalysisCopy.solversLabel to analysis.solverCount.toString(),
        AnalysisCopy.squaresLabel to analysis.entryCount.toString(),
    )

    /** The one line that reads the ribbon, matching the web copy: the stalled form when there is a
     *  pause to shade, the short-solve fallback otherwise. Twin of the iOS momentumCaption. */
    fun momentumCaption(analysis: RoomAnalysis): String =
        if (analysis.momentum.hasSignal && analysis.turningPoint != null) {
            AnalysisCopy.momentumCaptionStalled
        } else {
            AnalysisCopy.momentumCaptionPlain
        }

    /** A solver's name for the moments: "You", the roster display name, or a plain fallback for someone
     *  who has left (an owner can outlive their roster row). Twin of the iOS name(for:). */
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
            is AnalysisModel.Phase.Ready -> Content(phase.bundle, members, selfUserId, ground)
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
) {
    val tokens = ground.tokens
    Eyebrow(ground)
    StatTrio(analysis, ground, modifier = Modifier.padding(top = 12.dp))

    val legend = AnalysisPanelModel.legendRows(analysis, members, selfUserId, ground)
    if (legend.isNotEmpty()) {
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (row in legend) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(
                        Modifier
                            .size(10.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(row.color.toColor()),
                    )
                    Text(
                        row.name,
                        color = (if (row.isSelf) tokens.ink else tokens.number).toColor(),
                        fontSize = 12.5.sp,
                        fontWeight = if (row.isSelf) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
        }
        Text(
            AnalysisCopy.legendCaption,
            color = tokens.number.toColor().copy(alpha = 0.85f),
            fontSize = 11.sp,
            modifier = Modifier.padding(top = 6.dp),
        )
    }

    CapsLabel(AnalysisCopy.momentumLabel, ground, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
    MomentumRibbon(momentum = analysis.momentum, turningPoint = analysis.turningPoint, ground = ground)
    Text(
        AnalysisPanelModel.momentumCaption(analysis),
        color = tokens.number.toColor().copy(alpha = 0.85f),
        fontSize = 11.sp,
        modifier = Modifier.padding(top = 8.dp),
    )

    if (analysis.firstToFall != null || analysis.lastSquare != null) {
        CapsLabel(AnalysisCopy.momentsLabel, ground, modifier = Modifier.padding(top = 22.dp, bottom = 2.dp))
        Column {
            analysis.firstToFall?.let {
                MomentRow(AnalysisCopy.firstSquare, it.userId, members, selfUserId, ground)
            }
            if (analysis.firstToFall != null && analysis.lastSquare != null) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(tokens.number.toColor().copy(alpha = 0.18f)),
                )
            }
            analysis.lastSquare?.let {
                MomentRow(AnalysisCopy.lastSquare, it.userId, members, selfUserId, ground)
            }
        }
    }
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
        verticalAlignment = Alignment.CenterVertically,
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
            Column(
                modifier = Modifier.weight(1f).padding(vertical = 12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                CapsLabel(cell.first, ground)
                Text(cell.second, color = tokens.ink.toColor(), fontSize = 21.sp, style = digits)
            }
        }
    }
}

@Composable
private fun MomentRow(
    label: String,
    userId: String,
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
                .background(AnalysisPanelModel.colorFor(userId, members, ground).toColor()),
        )
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            CapsLabel(label, ground)
            Text(
                AnalysisPanelModel.nameFor(userId, members, selfUserId),
                color = tokens.ink.toColor(),
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
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
