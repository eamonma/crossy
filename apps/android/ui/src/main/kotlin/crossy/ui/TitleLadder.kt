// The solver-titles display table (design/post-game/TITLES.md; PROTOCOL.md §12; twin of apps/ios
// TitleLadder.swift): the client half of the award ladder. Who won what is decided server-side by the
// engine's TITLE_LADDER (packages/engine/src/titles.ts), the one authority, so no reducer twin exists
// here; this table owns only the words, and the words are the web's (apps/web/src/ui/titlesReadout.ts
// TITLE_COPY, mirrored string for string), so the same room reads identically on both platforms
// (ROADMAP Wave 10.6). Each entry follows its rung's evidence semantics: counts render as pluralized
// counts, the two whole-seconds rungs (the ice breaker's stall, the long hauler's span) render M:SS,
// and the two no-evidence rungs carry a fixed line. The copy obeys the amended law: a title cites its
// own number and nothing else, no rate, no rank, no two people's numbers against each other.
//
// Forward compatibility is the whole shape: a client MUST ignore an unknown title key (§12, how the
// ladder grows without client lockstep), so `card` answers null for a key it does not know and the
// section simply renders one fewer card. Evidence rides as a count or null (INV-6, never a letter); a
// rung whose expected number did not arrive degrades to the label alone rather than inventing copy
// (the web's withCount).

package crossy.ui

/** One render-ready title card: whose it is, what the title is called, and the claim line that rides
 *  under the name. Twin of the iOS TitleCard. */
data class TitleCard(
    val userId: String,
    /** The title's display name ("The saboteur"). */
    val label: String,
    /** The evidence-woven claim ("Overwrote 7 correct squares"), or null when the rung cites a number
     *  the wire did not carry. */
    val detail: String?,
)

/** The pinned ladder's display copy, keyed by the wire's title keys. Twin of the iOS TitleLadder. */
object TitleLadder {
    /** The pinned keys, in ladder rank order (the TITLES.md ladder table; exactly the engine
     *  TITLE_LADDER's keys, v1's fifteen plus the D29 fast-follow's marathoner at rank 8). The wire
     *  already orders titles by rank, so this list exists to pin the display table's coverage, not to
     *  sort. */
    val keys: List<String> = listOf(
        "saboteur",
        "one-hit-wonder",
        "ice-breaker",
        "bullseye",
        "headliner",
        "sprinter",
        "meddler",
        "marathoner",
        "quick-starter",
        "closer",
        "specialist",
        "long-hauler",
        "wanderer",
        "scribbler",
        "collector",
        "workhorse",
    )

    /** The card for one wire title, or null for an unknown key (skipped silently, PROTOCOL.md §12
     *  forward compatibility). Copy is the web's TITLE_COPY verbatim. */
    fun card(title: RoomTitle): TitleCard? {
        val e = title.evidence
        val label: String
        val detail: String?
        when (title.key) {
            "saboteur" -> {
                label = "The saboteur"
                detail = e?.let { "Overwrote ${counted(it, "correct square")}" }
            }
            "one-hit-wonder" -> {
                // Evidence: none (the rung cites nothing); the copy is the whole claim.
                label = "The one-hit wonder"
                detail = "One square, flawlessly chosen"
            }
            "ice-breaker" -> {
                // Evidence: the room's stall in whole seconds, read as a duration. The D29 revisit
                // re-based the stall onto within-sitting active time (TITLES.md, the wrinkle retired),
                // so the silence is one the room actually sat through; the copy already read that way.
                label = "The ice breaker"
                detail = e?.let { "Ended the room's ${formatMSS(it)} silence" }
            }
            "bullseye" -> {
                label = "The bullseye"
                detail = e?.let { "${counted(it, "square")}, none wrong" }
            }
            "headliner" -> {
                // The marquee fallback never claims "theme", only the long answers (TITLES.md marquee
                // rule), so neither does the copy.
                label = "The headliner"
                detail = e?.let { "Led $it of the long ones" }
            }
            "sprinter" -> {
                // 30 is the engine's BURST_WINDOW_MS in whole seconds, the window the stat was counted
                // over (the web derives this from the shared constant).
                label = "The sprinter"
                detail = e?.let { "${counted(it, "square")} in 30 seconds" }
            }
            "meddler" -> {
                label = "The meddler"
                detail = e?.let { "Finished ${counted(it, "word")} others started" }
            }
            "marathoner" -> {
                // Evidence: the room's sitting count, floored at 2 by the gate (the rung is silent in a
                // one-sitting room). "Both" keeps the common two-sitting card reading like English; web
                // renders the same strings.
                label = "The marathoner"
                detail = e?.let {
                    if (it == 2) "Showed up for both sittings" else "Showed up for all $it sittings"
                }
            }
            "quick-starter" -> {
                label = "The quick starter"
                detail = e?.let { "${counted(it, "square")} in the opening stretch" }
            }
            "closer" -> {
                label = "The closer"
                detail = e?.let { "${counted(it, "square")} in the closing stretch" }
            }
            "specialist" -> {
                label = "The specialist"
                detail = e?.let { "Kept to one corner, ${counted(it, "square")}" }
            }
            "long-hauler" -> {
                // Evidence: the solver's span in whole seconds, read as a duration.
                label = "The long hauler"
                detail = e?.let { "On the case for ${formatMSS(it)}" }
            }
            "wanderer" -> {
                // Evidence: none; the territory is the claim.
                label = "The wanderer"
                detail = "Roamed the whole grid"
            }
            "scribbler" -> {
                // writes counts every event, clears included: letters put down, not kept.
                label = "The scribbler"
                detail = e?.let { "Busiest pencil, ${counted(it, "letter")} down" }
            }
            "collector" -> {
                label = "The collector"
                detail = e?.let { "Had a hand in ${counted(it, "word")}" }
            }
            "workhorse" -> {
                label = "The workhorse"
                detail = e?.let { "${counted(it, "square")} filled" }
            }
            else -> return null
        }
        return TitleCard(userId = title.userId, label = label, detail = detail)
    }

    /** "7 squares" / "1 square": a count with a naive plural, so a floor title earned on a single
     *  square never reads "1 squares" (the web's counted). */
    private fun counted(n: Int, noun: String): String = "$n $noun${if (n == 1) "" else "s"}"

    /** Whole seconds as the one CrossyUI moment formatter (RoomAnalysis.formatMSS): "M:SS", hours split
     *  out past sixty minutes ("1:01:40"), matching the web's formatMSS (apps/web analysisReadout.ts)
     *  byte for byte, the same formatter the Analysis header renders so both surfaces agree. */
    private fun formatMSS(totalSeconds: Int): String = RoomAnalysis.formatMSS(totalSeconds.toDouble())
}
