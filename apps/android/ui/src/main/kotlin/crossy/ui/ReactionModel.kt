// Ephemeral emoji reactions, the client's entire memory of them (PROTOCOL.md §9; root DESIGN.md
// D24): a transient sticker book BESIDE the store, never inside it. Twin of apps/ios ReactionModel
// (ReactionPolicy + ReactionSticker + the sticker book) and apps/web ReactionStickers.tsx. The
// store's part is one stateless send and one fan-out stream (GameStore.react / reactions);
// everything a sticker is — its five-second life, its placement, its coalescing, the 5/s client cap
// — lives here, so a snapshot or resync is provably unable to touch a sticker (no store state
// exists to reconcile). Receive-any, send-gated (§9): `place` renders any well-formed emoji; only
// the send path consults the set, and the caller gates on it.
//
// Deliberately PURE (no Compose type crosses this file), so the whole book is a set of functions on
// an immutable List<ReactionSticker> that the sticker layer holds as one mutableStateOf. Time
// arrives as data (seconds), so ReactionModelTests and StickerEnvelopeTests pin every rule with no
// clock, exactly as the iOS/web suites do.
//
// Born-correct placement (the web review's shipped-bug list, and PR #245's settle-pop lesson): a
// sticker's offset, lean, and rotation are derived ONCE at creation, seeded only from its own stable
// key — never from sibling count or pile index — and never change while it lives. Incumbents in a
// pile hold still when a newcomer lands, and the resting transform is identical from the loud
// entrance's settle through exit-fade start (every StickerEnvelope track ends at exactly identity).

package crossy.ui

/**
 * The one monotonic clock the sticker book and the render layer share (seconds). A sticker's birth,
 * every coalesce, the sweep schedule, and the render layer's per-frame sample all read this, so the
 * closed-form envelope is evaluated against the same origin the book stamped. Monotonic
 * (System.nanoTime), never wall-clock, so a device clock adjustment cannot warp a decay.
 */
fun reactionNow(): Double = System.nanoTime() / 1_000_000_000.0

/**
 * Client-side reaction policy: the default send set and the caps. Deliberately OUTSIDE the codec
 * (PROTOCOL.md §9: decoders enforce shape only, never set membership) and outside the store (D24:
 * the store holds nothing for reactions). Twin of the iOS ReactionPolicy / ReactionSetSpec.
 */
object ReactionPolicy {
    /**
     * The DEFAULT personal send set, exactly these five graphemes in slot order (PROTOCOL.md §9;
     * D25: 🔥 🤔 🐐 💀 😭, the Phase 7 five retired). What a null `/me` `reactionSet` means, and
     * what every send surface offers until an account chooses its own five. Send-side only: an
     * inbound emoji outside any set still renders (receive-any, §9). The reaction-sets follow-up
     * track (personal sets from `/me`) wires the per-user five; the fan takes the five as a
     * parameter defaulting to this constant, so that seam is already open.
     */
    val defaultSet: List<String> = listOf("🔥", "🤔", "🐐", "💀", "😭")

    /** A sticker's whole life (PROTOCOL.md §9's ~5 seconds). The ONE decay constant; everything
     *  else (the exit start, the render horizon) derives from it. */
    const val DECAY_SECONDS: Double = 5.0

    /** The client send cap (PROTOCOL.md §5, §9: at most 5/s, server MAY drop excess silently; the
     *  client simply never over-sends). A sliding window, not a bucket. */
    const val MAX_SENDS_PER_SECOND: Int = 5

    /** The sliding window the send cap counts within. */
    const val SEND_WINDOW_SECONDS: Double = 1.0

    /** Render budget per cell: the newest sticker replaces the oldest once a pile holds this many
     *  (owner spec; the replaced one leaves through the exit fade). */
    const val MAX_VISIBLE_PER_CELL: Int = 4
}

/**
 * One live sticker. Placement (`offsetX`/`offsetY` in module units from the cell origin,
 * `tiltDegrees`) is seeded at birth from the stable key alone and immutable for the sticker's life
 * (the born-correct rule); only the timestamps move, and only through coalescing or eviction.
 * Geometry mirrors the web/iOS retune (2026-07-14): anchored near-center with a slight lower-left
 * bias, a square jitter of at most 8 units per axis, and a tilt whose magnitude is always 8 to 12
 * degrees, never near-upright.
 */
data class ReactionSticker(
    /** The coalesce identity: same sender + emoji + cell is the same sticker (PROTOCOL.md §9's
     *  client guidance: repeats coalesce, never stack sprites). */
    val id: String,
    val userId: String,
    val emoji: String,
    val cell: Int,
    /** Birth: never changes. A coalesce refreshes `refreshedAt` instead. */
    val bornAt: Double,
    /** The latest coalesce, replaying the WHOLE loud gesture (owner ruling 2026-07-14: a repeat
     *  shout, not a softer echo); equals `bornAt` until one lands. */
    val refreshedAt: Double,
    /** When the sticker is gone. Coalescing pushes it out; pile eviction pulls it in. */
    val endsAt: Double,
    // Born-correct placement: the anchor from the CELL ORIGIN, module units, jitter already folded
    // in; and the static tilt.
    val offsetX: Double,
    val offsetY: Double,
    val tiltDegrees: Double,
) {
    companion object {
        fun key(userId: String, emoji: String, cell: Int): String = "$userId|$emoji|$cell"

        /** The anchor in the 36-unit module: near-centered with a slight lower-left bias (the
         *  web/iOS 17,20), so the glyph reads seated rather than pinned. */
        const val ANCHOR_X_UNITS: Double = 17.0
        const val ANCHOR_Y_UNITS: Double = 20.0

        /** Square jitter per axis, module units. With the ~23-unit glyph this keeps a sticker mostly
         *  inside its cell (bleed is possible by z-order, not a goal). */
        const val SCATTER_UNITS: Double = 8.0
        const val MIN_TILT_DEGREES: Double = 8.0
        const val MAX_TILT_DEGREES: Double = 12.0

        /** Mint a born-correct sticker: identity and placement are birth's, seeded from the key
         *  alone (never from sibling count or pile index). */
        fun create(userId: String, emoji: String, cell: Int, now: Double): ReactionSticker {
            val id = key(userId, emoji, cell)
            val seed = StickerSeed.hash(id)
            val offsetX = ANCHOR_X_UNITS + (StickerSeed.unit(seed, 0UL) * 2 - 1) * SCATTER_UNITS
            val offsetY = ANCHOR_Y_UNITS + (StickerSeed.unit(seed, 1UL) * 2 - 1) * SCATTER_UNITS
            // Tilt magnitude 8..12, sign by its own lane: every sticker leans a little, none lies
            // flat (the web retune's character).
            val magnitude =
                MIN_TILT_DEGREES + StickerSeed.unit(seed, 2UL) * (MAX_TILT_DEGREES - MIN_TILT_DEGREES)
            val tilt = if (StickerSeed.unit(seed, 3UL) < 0.5) -magnitude else magnitude
            return ReactionSticker(
                id = id,
                userId = userId,
                emoji = emoji,
                cell = cell,
                bornAt = now,
                refreshedAt = now,
                endsAt = now + ReactionPolicy.DECAY_SECONDS,
                offsetX = offsetX,
                offsetY = offsetY,
                tiltDegrees = tilt,
            )
        }
    }
}

/**
 * Deterministic placement seeding: FNV-1a over the sticker's key bytes, mixed per lane. Deliberately
 * NOT the JVM `hashCode` (a sticker's placement must be reproducible so tests pin it and re-creation
 * lands identically). ASCII-agnostic byte hashing, no locale anywhere (INV-1). Twin of the iOS
 * StickerSeed and the web FNV-1a hash.
 */
object StickerSeed {
    fun hash(key: String): ULong {
        var h = 0xcbf29ce484222325UL
        for (byte in key.encodeToByteArray()) {
            h = h xor (byte.toULong() and 0xFFUL)
            h *= 0x100000001b3UL
        }
        return h
    }

    /** A stable value in [0, 1) for one lane of one seed (splitmix-style finalizer). */
    fun unit(seed: ULong, lane: ULong): Double {
        var x = seed xor (lane * 0x9e3779b97f4a7c15UL)
        x = x xor (x shr 33)
        x *= 0xff51afd7ed558ccdUL
        x = x xor (x shr 33)
        return (x shr 11).toDouble() / (1UL shl 53).toDouble()
    }
}

/**
 * The sticker book as pure transforms on an immutable list. The sticker layer holds the list as one
 * mutableStateOf and applies these, so Compose observes every placement, coalesce, and sweep while
 * the rules stay headlessly testable. Twin of the iOS ReactionModel methods (receive/send/sweep) and
 * the web reducer.
 */
object ReactionBook {
    /** An inbound reaction, or a local echo: the one placement path (PROTOCOL.md §6, §9). Coalesces
     *  a live same-key sticker (same sender + emoji + cell) by replaying its loud gesture in place
     *  and refreshing its timer, never stacking a sprite; evicts the stalest incumbent when the
     *  cell's pile is at budget; otherwise appends a born-correct sticker. Receive-any: no set
     *  check, no rate check (the sender was already capped). */
    fun place(
        stickers: List<ReactionSticker>,
        userId: String,
        emoji: String,
        cell: Int,
        now: Double,
    ): List<ReactionSticker> {
        val key = ReactionSticker.key(userId, emoji, cell)

        // Coalesce (§9 client guidance): the same sender repeating the same emoji at the same cell
        // replays the loud gesture in place and refreshes its timer. bornAt holds; identity and
        // placement are birth's.
        val liveIndex = stickers.indexOfFirst { it.id == key && it.endsAt > now }
        if (liveIndex != -1) {
            return stickers.mapIndexed { i, s ->
                if (i == liveIndex) s.copy(refreshedAt = now, endsAt = now + ReactionPolicy.DECAY_SECONDS)
                else s
            }
        }

        // An EXPIRED same-key sticker the sweep has not yet retired leaves first: the book never
        // holds two stickers with one identity (the render layer keys on it).
        val out = stickers.filterNot { it.id == key }.toMutableList()

        // Pile cap: with MAX_VISIBLE_PER_CELL already standing in this cell, the stalest incumbent
        // (oldest refresh) starts its exit now — replaced, not popped, so the departure still reads
        // as motion. Nothing else in the pile moves (incumbents hold still).
        val standing = out.indices.filter { out[it].cell == cell && out[it].endsAt > now }
        if (standing.size >= ReactionPolicy.MAX_VISIBLE_PER_CELL) {
            val evict = standing.minByOrNull { out[it].refreshedAt }
            if (evict != null) {
                val s = out[evict]
                out[evict] = s.copy(endsAt = minOf(s.endsAt, now + StickerEnvelope.EXIT_SECONDS))
            }
        }

        out.add(ReactionSticker.create(userId, emoji, cell, now))
        return out
    }

    /** Retire everything past its end. Idempotent; the hosting layer schedules calls off the soonest
     *  `endsAt` (the sweep pattern). */
    fun sweep(stickers: List<ReactionSticker>, now: Double): List<ReactionSticker> =
        stickers.filterNot { it.endsAt <= now }

    /** The soonest instant a sweep could retire something; null with no stickers. */
    fun nextExpiry(stickers: List<ReactionSticker>): Double? = stickers.minOfOrNull { it.endsAt }
}

/**
 * The client 5/s send cap as a pure sliding window (PROTOCOL.md §5, §9). The send surface holds the
 * accepted-instant list as state; `allows` decides and `record` folds an accepted send in, dropping
 * instants that have aged past the window. Twin of the iOS ReactionModel.send window (`sentAt`). A
 * capped attempt sends nothing and echoes nothing.
 */
object ReactionSendCap {
    /** Whether a send at `now` is within the 5/s window given the accepted instants so far. */
    fun allows(sentAt: List<Double>, now: Double): Boolean =
        sentAt.count { now - it < ReactionPolicy.SEND_WINDOW_SECONDS } < ReactionPolicy.MAX_SENDS_PER_SECOND

    /** The accepted-instant list after folding in an accepted send at `now`, pruned to the window. */
    fun record(sentAt: List<Double>, now: Double): List<Double> =
        (sentAt.filter { now - it < ReactionPolicy.SEND_WINDOW_SECONDS }) + now
}
