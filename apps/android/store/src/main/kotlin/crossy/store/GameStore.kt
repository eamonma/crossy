// The client store (AD-1, mirrored): sequenced state plus an optimistic overlay, reconciled to
// the server's order (DESIGN.md §10, INV-10; PROTOCOL.md §7, §8). The client-store vectors
// (vectors/v1/client-store) are the specification; store/src/test executes every case against
// this class, mirroring the web twin (apps/web/src/store/gameStore.ts) and the iOS twin
// (apps/ios/Sources/CrossyStore/GameStore.swift) so the three stores cannot drift. The store
// speaks wire types from :protocol and sends through the Transport port, so tests need no socket.
//
// Concurrency (AAD-2): the store is confined to a single dispatcher by the composition root and
// publishes a render model via StateFlow. It is JVM-pure (no Android import): confinement is the
// caller's job, so nothing here names a main looper. The single mailbox is `run(_)`, one
// consumption loop over the transport's inbound flow; local intents are plain calls on the same
// dispatcher, so event application and intents interleave in one total order (AD-1).

package crossy.store

import crossy.protocol.Board
import crossy.protocol.CastCheckVoteMessage
import crossy.protocol.Cell
import crossy.protocol.CellSetMessage
import crossy.protocol.CheckPuzzleMessage
import crossy.protocol.CheckVoteCastMessage
import crossy.protocol.CheckVoteClosedMessage
import crossy.protocol.CheckVoteOpenedMessage
import crossy.protocol.CheckVoteSnapshot
import crossy.protocol.ClearCellMessage
import crossy.protocol.ClientMessage
import crossy.protocol.Cursor
import crossy.protocol.Direction
import crossy.protocol.ErrorCode
import crossy.protocol.ErrorMessage
import crossy.protocol.GameStatus
import crossy.protocol.HeartbeatMessage
import crossy.protocol.KickedMessage
import crossy.protocol.MoveCursorMessage
import crossy.protocol.Participant
import crossy.protocol.PlaceLetterMessage
import crossy.protocol.PuzzleCheckedMessage
import crossy.protocol.ReactMessage
import crossy.protocol.RequestSyncMessage
import crossy.protocol.Role
import crossy.protocol.ServerMessage
import crossy.protocol.Stats
import crossy.protocol.normalizeValue
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The store's connection state. Three of these are the PROTOCOL.md §7 wire lifecycle (token set
 * normative in vectors/README.md): `live` applies events in order; `resyncing` has seen a gap,
 * sent `requestSync`, and ignores sequenced events until the next snapshot; `reconnecting` lost
 * the socket after a drop or fatal error and waits for the reconnect `welcome` to reconcile.
 *
 * `connecting` is the honest initial state before the first `welcome` ever lands, mirrored from
 * the web and iOS stores: no board exists yet, so it is deliberately distinct from `reconnecting`
 * (a post-drop state) and local mutations are refused until there is authoritative state to build
 * on. It is client-local and pre-handshake: no vector encodes it, and no wire message carries it.
 */
enum class SyncState(val wire: String) {
    CONNECTING("connecting"),
    LIVE("live"),
    RESYNCING("resyncing"),
    RECONNECTING("reconnecting"),
    ;

    companion object {
        fun fromWire(wire: String): SyncState? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * A sent-but-unconfirmed mutation (PROTOCOL.md §8). `value` is null for a pending clearCell.
 * `agedOut` marks an entry past the recent-command window K, so snapshot reconciliation drops it
 * instead of re-sending; how a client measures age against K is deliberately unsettled
 * (PROTOCOL.md §8, "Age against K"), so nothing in this store derives the flag. The vectors supply
 * it as case input.
 */
data class PendingCommand(
    val commandId: String,
    val cell: Int,
    val value: String?,
    val agedOut: Boolean = false,
)

/**
 * A conflict-flash trigger (PROTOCOL.md §8, D02): the store detects, the view animates the ~300 ms
 * flash in the writer's color. Ephemeral, so the vectors exclude it (vectors/README.md).
 */
data class ConflictFlash(val cell: Int, val by: String)

/** The check vote timebox (PROTOCOL.md §10, CHECK_VOTE_TTL_MS = 30,000 ms; D32). The clamp ceiling. */
const val CHECK_VOTE_TTL_MS: Long = 30_000L

/**
 * The open check vote as the view reads it (PROTOCOL.md §4, §6, §10; D32), null on RenderModel when
 * none is open. Reconstructed from the three sequenced vote events and healed wholesale by every
 * snapshot (`board.checkVote`). `voteSeq` is the vote's identity (its checkVoteOpened `seq`, the id a
 * ballot names); `by` is the proposer; `electorate` is the frozen ascending eligible-voter array;
 * `approvals` and `rejections` are who has voted each way, `approvals` opening as `[by]`; `needed` is
 * the strict majority the wire carried; `expiresAt` is the absolute ISO 8601 timeout. Indices and
 * ids only, never values or answers (INV-6).
 */
data class VoteView(
    val voteSeq: Int,
    val by: String,
    val electorate: List<String>,
    val approvals: List<String>,
    val rejections: List<String>,
    val needed: Int,
    val expiresAt: String,
) {
    /** The timeout as epoch millis, parsed once; null if the timestamp does not parse (render falls
     * back to the full timebox rather than a jumpy ring). */
    val expiresAtEpochMs: Long? = runCatching { Instant.parse(expiresAt).toEpochMilli() }.getOrNull()

    /** Whether this elector has already cast a ballot (the proposer counts, opening in `approvals`). */
    fun hasVoted(userId: String): Boolean = userId in approvals || userId in rejections

    /**
     * Remaining time in millis, `expiresAt − now` clamped to `[0, CHECK_VOTE_TTL_MS]` (D32). The
     * store holds no clock (AAD-2): the caller passes `now`, so the ring drains against the same
     * frame clock the view animates on. An unparseable timeout renders as the full timebox.
     */
    fun remainingMillis(nowMillis: Long): Long =
        expiresAtEpochMs?.let { (it - nowMillis).coerceIn(0L, CHECK_VOTE_TTL_MS) } ?: CHECK_VOTE_TTL_MS

    /** A solo electorate of one auto-passes at open; the vote chrome must never render for it (D32). */
    val isSolo: Boolean get() = electorate.size <= 1
}

/**
 * A vote's close, surfaced once for the view's resolution beat (PROTOCOL.md §6, §10; D32). Fired only
 * under the §7 seq gate, so it marks the actual moment a vote resolved, never snapshot healing.
 * `outcome` is `passed` / `failed` / `cancelled`; `reason` is the §10 cause (REJECTED, EXPIRED,
 * GRID_BROKEN, TERMINAL), null when passed. The Bench reads it to choose the one recess line.
 */
data class VoteClosed(val voteSeq: Int, val outcome: String, val reason: String?)

/**
 * The non-fatal vote rejections (PROTOCOL.md §11; D32). A proposal or ballot the server refuses:
 * handled quietly (clear the pending intent, no toast), unlike a mutation rejection which the UI
 * surfaces. A ballot writes no cell, so none of these carries an overlay entry to clear.
 */
private val VOTE_ERROR_CODES: Set<ErrorCode> = setOf(
    ErrorCode.VOTE_PENDING,
    ErrorCode.NO_VOTE_OPEN,
    ErrorCode.NOT_ELECTOR,
    ErrorCode.ALREADY_VOTED,
)

/**
 * An inbound reaction to fan out to the sticker layer (PROTOCOL.md §6, §9; D24). The store holds
 * NOTHING for a reaction: it is never sequenced, never in RenderModel's board state, and never in a
 * snapshot (there is no `board.reactions`, §9), so this event is pure fan-out and gone. Twin of the
 * data the iOS `onReaction` callback carries; the reaction stream (`GameStore.reactions`) publishes
 * it main-confined like `render`, and the UI's sticker book (`:ui` ReactionModel) owns decay,
 * placement, and coalescing. `userId` lets the sticker layer key own-vs-teammate placement.
 */
data class ReactionEvent(val userId: String, val emoji: String, val cell: Int)

/**
 * The published render model (AAD-2): an immutable snapshot views are pure functions of (INV-10).
 * Rebuilt on every transition and pushed to `GameStore.render`. It carries sequenced state, the
 * optimistic overlay, presence, the derived timer origin, and the terminal facts; the outbound
 * queue is not view state and lives on the store, not here.
 */
data class RenderModel(
    /** Last applied sequence number (PROTOCOL.md §7). */
    val seq: Int,
    val sync: SyncState,
    val status: GameStatus,
    /** Sequenced cells, sparse: an unlisted cell is a black square or a never-written cell. */
    val cells: Map<Int, Cell>,
    /** The optimistic overlay in send order, oldest first (PROTOCOL.md §8). */
    val overlay: List<PendingCommand>,
    /** Presence, render-only: never persisted, never sequenced (PROTOCOL.md §9). */
    val participants: List<Participant>,
    /** Live cursors by userId, render-only (PROTOCOL.md §9). */
    val cursors: Map<String, Cursor>,
    /** The derived timer origin (root DESIGN.md D15): set once from the first fill's delta
     * `cellSet` (PROTOCOL.md §6) and authoritative from every snapshot (§4). */
    val firstFillAt: String?,
    val completedAt: String?,
    val abandonedAt: String?,
    val stats: Stats?,
    val selfUserId: String?,
    /** The last non-fatal rejection, surfaced for the UI (PROTOCOL.md §8). */
    val lastRejection: ErrorMessage?,
    /** The standing room-check marks (PROTOCOL.md §4, §10; D32): indices only, never values or
     * answers (INV-6). Replaced wholesale by every accepted `puzzleChecked` and by every snapshot;
     * a mark clears only when the cell's value changes (`applyCellSet`). Mirrors the web store's
     * `checkedWrongCells` and the iOS `checkedWrong`. */
    val checkedWrong: Set<Int>,
    /** The game's total accepted checks; permanent, never reset (PROTOCOL.md §10). */
    val checkCount: Int,
    /** The open check vote, null when none (PROTOCOL.md §4, §10; D32). Rebuilt from the three
     * sequenced vote events and healed wholesale by every snapshot. The Bench renders when this is
     * non-null and NOT solo; a solo electorate auto-passes and shows no chrome. */
    val checkVote: VoteView?,
    /** The commandId of a proposal or ballot this client sent that is still in flight (D32). Cleared
     * when its own event echoes back or the server rejects it (the four vote errors, quietly). The
     * hold/ballot affordance reads it; not sequenced state. */
    val pendingVoteCommandId: String?,
) {
    /**
     * The connected voting members: host and solver, connected now (PROTOCOL.md §10). The proposer
     * assembles a proposal's electorate from this on the server; the client uses it only to decide
     * solo (a lone connected host/solver) so it keeps the confirm step instead of a hold, and never
     * shows vote chrome for the auto-pass triple (D32).
     */
    val connectedVoters: List<String>
        get() = participants.filter { it.connected && (it.role == Role.HOST || it.role == Role.SOLVER) }
            .map { it.userId }

    /** A lone connected host/solver: no room to interpose, so the client keeps the confirm flow and
     * renders the auto-pass triple as an instant check, no Bench (D32). */
    val isSoloRoom: Boolean get() = connectedVoters.size <= 1

    /** The Bench shows only for a real multi-elector vote in flight; never solo, not for a frame. */
    val showVoteBench: Boolean get() = checkVote != null && !checkVote.isSolo
    /**
     * The composite the user sees for one cell (INV-10): sequenced state painted with the overlay,
     * the most recently sent pending entry winning per cell (PROTOCOL.md §8). Pending values render
     * through the same path as confirmed ones, so the view cannot tell them apart.
     */
    fun renderValue(cell: Int): String? {
        for (i in overlay.indices.reversed()) {
            if (overlay[i].cell == cell) return overlay[i].value
        }
        return cells[cell]?.v
    }

    /**
     * Filled playable cells: one per non-null sequenced value (PROTOCOL.md §12a). The optimistic
     * overlay is a render concern (INV-10) and stays out, so this reads confirmed progress. A
     * cleared cell keeps its `by` with `v=null` and does NOT count, mirroring the server's
     * `filledCount` (apps/session/src/hydrate.ts) exactly.
     */
    val filledCount: Int get() = cells.values.count { it.v != null }
}

/**
 * One GameStore per connected game (ARCHITECTURE.md §3): the client mirror of the server's
 * per-game actor. Intents flow in, render models flow out, effects live behind ports.
 */
class GameStore(
    seed: Seed? = null,
    private val backoff: BackoffSchedule = BackoffSchedule(),
    newCommandId: (() -> String)? = null,
) {
    /** Starting state, used by the vector suite to seed `given` and by previews. A freshly opened
     * game omits it and starts `connecting` (see [SyncState]). */
    data class Seed(
        val seq: Int,
        val sync: SyncState,
        val status: GameStatus = GameStatus.ONGOING,
        val cells: Map<Int, Cell> = emptyMap(),
        val overlay: List<PendingCommand> = emptyList(),
    )

    // MARK: sequenced + overlay state (the two things INV-10 allows, nothing else)

    private var seq: Int = seed?.seq ?: 0
    private var sync: SyncState = seed?.sync ?: SyncState.CONNECTING
    private var status: GameStatus = seed?.status ?: GameStatus.ONGOING
    private var cells: Map<Int, Cell> = seed?.cells ?: emptyMap()
    private var overlay: List<PendingCommand> = seed?.overlay ?: emptyList()
    private var participants: List<Participant> = emptyList()
    private var cursors: Map<String, Cursor> = emptyMap()
    private var firstFillAt: String? = null
    private var completedAt: String? = null
    private var abandonedAt: String? = null
    private var stats: Stats? = null
    private var selfUserId: String? = null
    private var lastRejection: ErrorMessage? = null
    private var checkedWrong: Set<Int> = emptySet()
    private var checkCount: Int = 0
    private var checkVote: VoteView? = null
    private var pendingVoteCommandId: String? = null

    // PROTOCOL.md §3: commandId is a client-generated UUIDv4. Java's UUID.toString() is already the
    // RFC 4122 canonical lowercase-hex form the web's crypto.randomUUID emits, ASCII by
    // construction (INV-1), so no fold is needed. Injectable so the vectors pin ids exactly.
    private val newCommandId: () -> String = newCommandId ?: { UUID.randomUUID().toString() }

    private val _render = MutableStateFlow(snapshot())

    /** The published render model (AAD-2). Compose collects it with
     * collectAsStateWithLifecycle; the vector suite and unit tests read `render.value`. */
    val render: StateFlow<RenderModel> = _render.asStateFlow()

    // The ephemeral reaction stream (PROTOCOL.md §6, §9; D24), the SharedFlow twin of the iOS
    // `onReaction` callback: a fan-out beside `render`, never part of it. An inbound `reaction`
    // notice emits here and the sticker layer collects it; the store keeps nothing, so a snapshot or
    // resync is provably unable to replay one (there is no store state to reconcile). replay = 0
    // (a reaction is a live event; a late collector missed it), and a bounded buffer with
    // DROP_OLDEST keeps a `tryEmit` from ever suspending the confined mailbox under a burst.
    private val _reactions = MutableSharedFlow<ReactionEvent>(
        replay = 0,
        extraBufferCapacity = 32,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val reactions: SharedFlow<ReactionEvent> = _reactions.asSharedFlow()

    /** Outbound frames awaiting the transport pump, in send order. Transitions append
     * synchronously, so the vector suite reads `then.send` deterministically; `run` drains to the
     * transport in the same order. Not part of the render model: it is outbound, not view state. */
    private val outboxQueue = ArrayDeque<ClientMessage>()
    val outbox: List<ClientMessage> get() = outboxQueue.toList()

    /** The view animates the ~300 ms conflict flash; the store only detects the trigger
     * (PROTOCOL.md §8, D02). The composition root routes it to [Effects]/the grid view. */
    var onConflictFlash: ((ConflictFlash) -> Unit)? = null

    /** The composition root raises the kicked terminal from this notice (PROTOCOL.md §6): the
     * `kicked` frame carries no `seq` and mutates no sequenced state (close 1008 follows), so the
     * store reconciles nothing and the vectors exclude it. */
    var onKicked: ((KickedMessage) -> Unit)? = null

    /** A live `puzzleChecked` landed (PROTOCOL.md §6, §10; D27): the onConflictFlash pattern for
     * the one moment the room checked itself. Fired only under the §7 seq gate (a truly applied
     * live event) — snapshot healing (welcome/sync carrying standing marks) is history arriving,
     * not a moment, and stays silent. The marks and count themselves are state
     * (`checkedWrong`/`checkCount`); this only surfaces the beat for the view's haptic. Set by the
     * composition root. */
    var onPuzzleChecked: ((PuzzleCheckedMessage) -> Unit)? = null

    /** A check vote opened (PROTOCOL.md §6, §10; D32): the Bench rises and the ring ignites. Fired
     * only under the §7 seq gate (a truly applied open), never on snapshot healing (a reconnecting
     * client rebuilds the Bench from `checkVote` without replaying the ceremony). Set by the
     * composition root for the open haptic and the ring pulse. */
    var onVoteOpened: ((CheckVoteOpenedMessage) -> Unit)? = null

    /** A ballot settled on the open vote (PROTOCOL.md §6, §10; D32; U9): the light tick, one per
     * ballot. Fired only under the §7 seq gate (a truly applied cast), so a reconnect that heals the
     * approvals wholesale via snapshot never re-ticks history. Fires for every applied cast, self and
     * remote; the composition root ticks remote ones (the self ballot already ticked at its tap). */
    var onVoteCast: ((CheckVoteCastMessage) -> Unit)? = null

    /** A check vote closed (PROTOCOL.md §6, §10; D32): the resolution beat. Fired only under the §7
     * seq gate, so it marks the moment a vote resolved, never history arriving in a snapshot. The
     * Bench reads the outcome/reason for its one recess line and the pass/fail haptic. */
    var onVoteClosed: ((VoteClosed) -> Unit)? = null

    private var outboxWake: SendChannel<Unit>? = null

    // MARK: read helpers over live state (the render model is the canonical read surface)

    private fun renderValueInternal(cell: Int): String? {
        for (i in overlay.indices.reversed()) {
            if (overlay[i].cell == cell) return overlay[i].value
        }
        return cells[cell]?.v
    }

    private fun snapshot(): RenderModel =
        RenderModel(
            seq = seq,
            sync = sync,
            status = status,
            cells = cells,
            overlay = overlay,
            participants = participants,
            cursors = cursors,
            firstFillAt = firstFillAt,
            completedAt = completedAt,
            abandonedAt = abandonedAt,
            stats = stats,
            selfUserId = selfUserId,
            lastRejection = lastRejection,
            checkedWrong = checkedWrong,
            checkCount = checkCount,
            checkVote = checkVote,
            pendingVoteCommandId = pendingVoteCommandId,
        )

    /** Republish the render model. StateFlow only emits when the snapshot differs, so a no-op
     * transition (a stale event, a refused intent) never wakes a collector. */
    private fun publish() {
        _render.value = snapshot()
    }

    // MARK: local intents (PROTOCOL.md §8: overlay entry plus send)

    fun placeLetter(cell: Int, value: String, commandId: String? = null) {
        sendMutation(cell, normalizeValue(value), commandId)
    }

    fun clearCell(cell: Int, commandId: String? = null) {
        sendMutation(cell, null, commandId)
    }

    /** Relay the local cursor to the room (PROTOCOL.md §5, §9). Ephemeral: no overlay, no seq,
     * best-effort. Refused before the first snapshot (`connecting`); the 10/s throttle is the
     * caller's job (§9). Nothing here mutates state, so no render model is published. */
    fun moveCursor(cell: Int, direction: Direction) {
        if (sync == SyncState.CONNECTING) return
        emit(ClientMessage.MoveCursor(MoveCursorMessage(cell, direction)))
    }

    /** Send an emoji reaction at the given cell (PROTOCOL.md §5, §9): moveCursor's presence-family
     * twin. Stateless by design (D24): no overlay entry, no seq, nothing recorded here, so a
     * snapshot or resync is provably unable to touch a sticker. Legal in any game status, completed
     * and abandoned included (§9: reactions on the finished grid are intended), so unlike a mutation
     * it never checks `status`. Refused before the first snapshot (`connecting`) like every intent;
     * the 5/s client cap is the caller's job (§9), matching moveCursor's caller-owned throttle. The
     * server never echoes a react, so the sender's own sticker is a local echo the UI raises. */
    fun react(emoji: String, cell: Int) {
        if (sync == SyncState.CONNECTING) return
        emit(ClientMessage.React(ReactMessage(emoji, cell)))
    }

    /** Liveness ping (PROTOCOL.md §5, §9). The adapter owns the 15 s timer
     * (ReconnectPolicy.heartbeatIntervalSeconds); emitting through the store keeps one ordered
     * outbound path. Meaningless before the first welcome, so gated like the other intents. */
    fun heartbeat() {
        if (sync == SyncState.CONNECTING) return
        emit(ClientMessage.Heartbeat(HeartbeatMessage()))
    }

    /** Request the room-wide check (PROTOCOL.md §5, §10; D27): one command marks every wrong cell
     * for everyone. Minted like every mutation intent, but no overlay entry (INV-10) — a check is
     * not a cell write, so there is nothing to paint optimistically and nothing for §8's
     * reconciliation to re-send. Gated like [sendMutation]: refused before the first welcome
     * (`connecting`) and after a terminal status (the server would answer GAME_NOT_ONGOING). The
     * grid-full gate is the UI's confirm step plus the server's own check; a `GRID_NOT_FULL`
     * rejection is non-fatal and silent (§11) — `lastRejection` records it, and the error path's
     * overlay clear is a no-op because no entry carries this id. Mirrors iOS `GameStore.checkPuzzle`. */
    fun checkPuzzle(commandId: String? = null) {
        if (sync == SyncState.CONNECTING) return
        if (status != GameStatus.ONGOING) return
        val id = commandId ?: newCommandId()
        // The proposal is now a vote proposal (D32): track it as the pending vote intent so its
        // checkVoteOpened echo clears the hold affordance and a VOTE_PENDING / GRID_NOT_FULL
        // rejection clears it quietly. Like a check, no overlay entry (INV-10): it writes no cell.
        pendingVoteCommandId = id
        emit(ClientMessage.CheckPuzzle(CheckPuzzleMessage(id)))
        publish()
    }

    /**
     * Cast one ballot on the open check vote (PROTOCOL.md §5, §10; D32). Gated like [checkPuzzle]:
     * refused before the first welcome (`connecting`) and after a terminal status. Refused with no
     * open vote (nothing to name a `voteSeq` for). No overlay entry (INV-10): a ballot writes no
     * cell. The `voteSeq` names the current open vote; the sent command is tracked as the pending
     * intent so its checkVoteCast echo, or a NO_VOTE_OPEN / NOT_ELECTOR / ALREADY_VOTED rejection,
     * clears the in-flight ballot affordance quietly (no toast, §11 D32).
     */
    fun castCheckVote(approve: Boolean, commandId: String? = null) {
        if (sync == SyncState.CONNECTING) return
        if (status != GameStatus.ONGOING) return
        val vote = checkVote ?: return
        val id = commandId ?: newCommandId()
        pendingVoteCommandId = id
        emit(ClientMessage.CastCheckVote(CastCheckVoteMessage(id, vote.voteSeq, approve)))
        publish()
    }

    private fun sendMutation(cell: Int, value: String?, commandId: String?) {
        // Before the first welcome there is no authoritative board yet: refuse local mutations so
        // a keystroke cannot mint an overlay entry against an empty grid (the web/iOS pre-welcome
        // gate, mirrored). The first welcome flips sync to live and unlocks input; a later drop
        // goes reconnecting, where optimistic mutations are still allowed and reconciled (§8).
        if (sync == SyncState.CONNECTING) return
        // Terminal states freeze mutation locally: refused here, never reaching the wire (INV-4
        // governs the board; the server would answer GAME_NOT_ONGOING).
        if (status != GameStatus.ONGOING) return
        val id = commandId ?: newCommandId()
        overlay = overlay + PendingCommand(id, cell, value)
        emit(
            if (value != null) {
                ClientMessage.PlaceLetter(PlaceLetterMessage(id, cell, value))
            } else {
                ClientMessage.ClearCell(ClearCellMessage(id, cell))
            }
        )
        publish()
    }

    /** Drop a participant from the roster after a host kick the server has confirmed (PROTOCOL.md
     * §12). Idempotent: an unknown userId is a no-op. The next snapshot rebuilds `participants`
     * without them regardless (§7), so this only closes the gap until then. */
    fun removeParticipant(userId: String) {
        participants = participants.filterNot { it.userId == userId }
        cursors = cursors - userId
        publish()
    }

    /** Seed the roster from the REST game view before the first `welcome`, so the players pill
     * renders its true width on frame one (owner device finding 2026-07-11). The REST view carries
     * the roster, not presence, so each seeded member holds `connected = false`, the register a
     * `playerDisconnected` carries. Gated to `connecting`: the welcome stays the authority and
     * rebuilds `participants` wholesale when it lands (`applySnapshot`). */
    fun seedRoster(roster: List<Participant>) {
        if (sync != SyncState.CONNECTING) return
        participants = roster.toList()
        publish()
    }

    /** Seed a known-completed status before the socket answers (the seeded-birth rule, DESIGN.md
     * §4, §12), so a solved room retires its key deck from the push's first frame. Gated to
     * `connecting` exactly like [seedRoster]; completion is terminal (INV-4), so a seeded
     * `completed` can never contradict the snapshot that confirms it. */
    fun seedCompleted(at: String?) {
        if (sync != SyncState.CONNECTING) return
        status = GameStatus.COMPLETED
        completedAt = at
        publish()
    }

    /** Seed a known-abandoned status before the socket answers, the terminal twin of [seedCompleted]
     * (the seeded-birth rule, DESIGN.md §4, §12): the tapped card carries the room's abandonment fact
     * (`GET /games` `abandonedAt`, the Ended shelf's gathering key), so a host-ended room retires its
     * key deck from the push's first frame instead of flashing the deck for the connect beat and
     * dropping it when the welcome lands abandoned. Gated to `connecting` exactly like [seedCompleted]:
     * a pre-handshake courtesy the welcome always overrides (`applySnapshot` sets status and
     * abandonedAt from the board). Abandonment is terminal (INV-4), so a seeded `abandoned` can never
     * contradict the snapshot that confirms it, and the mutation freeze already keys on
     * `status != ONGOING`. Mirrors iOS `GameStore.seedAbandoned`. */
    fun seedAbandoned(at: String?) {
        if (sync != SyncState.CONNECTING) return
        status = GameStatus.ABANDONED
        abandonedAt = at
        publish()
    }

    // MARK: connection state machine (PROTOCOL.md §7; AD-6)

    /** The transport lost the socket: back off and reconnect (PROTOCOL.md §7). The overlay is
     * preserved so the reconnect welcome can re-send it (§8). */
    fun connectionLost() {
        sync = SyncState.RECONNECTING
        publish()
    }

    /** The next reconnect delay (AD-6): the store decides, the adapter sleeps and dials. Full
     * jitter over the 0/1/2/4/8/16/30 s walk (PROTOCOL.md §7). */
    fun nextReconnectDelaySeconds(): Double = backoff.nextDelaySeconds()

    /** Report how long the last connection lived; 30 s or more resets the backoff walk
     * (PROTOCOL.md §7). The duration arrives as data: the store holds no clock. */
    fun connectionSurvived(seconds: Double) {
        backoff.connectionSurvived(seconds)
    }

    // MARK: inbound frames (decoded by :protocol before they reach here)

    fun receive(message: ServerMessage) {
        when (message) {
            is ServerMessage.Welcome -> {
                selfUserId = message.message.self.userId
                applySnapshot(message.message.board)
            }
            is ServerMessage.Sync -> applySnapshot(message.message.board)
            is ServerMessage.CellSet ->
                applySequenced(message.message.seq) { applyCellSet(message.message) }
            is ServerMessage.GameCompleted ->
                applySequenced(message.message.seq) {
                    status = GameStatus.COMPLETED
                    completedAt = message.message.at
                    stats = message.message.stats
                }
            is ServerMessage.GameAbandoned ->
                applySequenced(message.message.seq) {
                    status = GameStatus.ABANDONED
                    abandonedAt = message.message.at
                }
            is ServerMessage.Error -> {
                val error = message.message
                if (error.fatal) {
                    // The connection is about to close (1008). Clear nothing by commandId: the
                    // overlay must survive for the post-reconnect re-send (PROTOCOL.md §7, §8; the
                    // fatal-error vector pins exactly this).
                    sync = SyncState.RECONNECTING
                } else if (error.code in VOTE_ERROR_CODES) {
                    // A rejected proposal or ballot (VOTE_PENDING, NO_VOTE_OPEN, NOT_ELECTOR,
                    // ALREADY_VOTED; §11 D32): handled quietly. Clear the pending vote intent so the
                    // hold/ballot affordance settles, and surface NO toast (`lastRejection`
                    // untouched). A ballot writes no cell, so there is no overlay entry to clear.
                    clearPendingVote(error.commandId)
                } else {
                    // A non-fatal error for a pending command clears its overlay entry so the
                    // cell's true value is never masked (the immortal-overlay case, INV-10), and
                    // the rejection is surfaced for the UI (§8).
                    lastRejection = error
                    error.commandId?.let { removeOverlayEntry(it) }
                }
            }
            is ServerMessage.PlayerConnected -> {
                val notice = message.message
                val joined =
                    Participant(
                        userId = notice.userId,
                        displayName = notice.displayName,
                        color = notice.color,
                        role = notice.role,
                        connected = true,
                        avatarUrl = notice.avatarUrl,
                    )
                val index = participants.indexOfFirst { it.userId == notice.userId }
                participants =
                    if (index == -1) {
                        participants + joined
                    } else {
                        participants.toMutableList().also { it[index] = joined }
                    }
            }
            is ServerMessage.PlayerDisconnected -> {
                val index = participants.indexOfFirst { it.userId == message.message.userId }
                if (index != -1) {
                    val present = participants[index]
                    participants =
                        participants.toMutableList().also {
                            it[index] = present.copy(connected = false)
                        }
                    cursors = cursors - message.message.userId
                }
            }
            is ServerMessage.Cursor -> {
                val notice = message.message
                cursors = cursors + (notice.userId to Cursor(notice.userId, notice.cell, notice.direction))
            }
            is ServerMessage.Reaction -> {
                // Pure fan-out (PROTOCOL.md §9, D24): unlike a cursor, the store keeps NO current
                // value for a reaction, so nothing a snapshot reconciles can ever carry one. Publish
                // to the sticker layer and return without mutating or republishing render state.
                val notice = message.message
                _reactions.tryEmit(ReactionEvent(notice.userId, notice.emoji, notice.cell))
                return
            }
            is ServerMessage.PuzzleChecked -> {
                val event = message.message
                // Sequenced (PROTOCOL.md §6, §10; D27): applied under the §7 seq gate exactly as
                // cellSet. The event replaces any standing marks wholesale and the count is
                // permanent (§10); the beat is surfaced for the view's haptic only when the event
                // truly applied (never on a stale or gapped frame, never on snapshot healing).
                applySequenced(event.seq) {
                    checkedWrong = event.wrongCells.toSet()
                    checkCount = event.checkCount
                    onPuzzleChecked?.invoke(event)
                }
            }
            is ServerMessage.CheckVoteOpened -> {
                val event = message.message
                // Sequenced (PROTOCOL.md §6, §10; D32): applied under the §7 seq gate like cellSet.
                // Opening creates the vote; approvals open as [by] (the proposal is the proposer's
                // approval), the wire carries no approvals/rejections. The proposer's own echo
                // clears its pending intent. The open beat fires only on a truly applied open.
                applySequenced(event.seq) {
                    checkVote = VoteView(
                        voteSeq = event.seq,
                        by = event.by,
                        electorate = event.electorate,
                        approvals = listOf(event.by),
                        rejections = emptyList(),
                        needed = event.needed,
                        expiresAt = event.expiresAt,
                    )
                    clearPendingVote(event.commandId)
                    onVoteOpened?.invoke(event)
                }
            }
            is ServerMessage.CheckVoteCast -> {
                val event = message.message
                // Sequenced ballot (PROTOCOL.md §6, §10; D32): file it into the open vote if it names
                // the current vote. The voter's own echo clears its pending ballot. A cast that does
                // not match the open vote (a race across a snapshot) is ignored: the snapshot heals.
                applySequenced(event.seq) {
                    val vote = checkVote
                    if (vote != null && vote.voteSeq == event.voteSeq && !vote.hasVoted(event.by)) {
                        checkVote = if (event.approve) {
                            vote.copy(approvals = (vote.approvals + event.by).sorted())
                        } else {
                            vote.copy(rejections = (vote.rejections + event.by).sorted())
                        }
                    }
                    clearPendingVote(event.commandId)
                    // The ballot's tick beat (U9): surfaced only for a truly applied cast, never on
                    // snapshot healing. The composition root ticks remote ballots (self already ticked).
                    onVoteCast?.invoke(event)
                }
            }
            is ServerMessage.CheckVoteClosed -> {
                val event = message.message
                // Sequenced close (PROTOCOL.md §6, §10; D32): clear the vote and surface the
                // resolution beat once (only under the §7 gate, never on snapshot healing). A passing
                // close is immediately followed by one puzzleChecked at the next seq, which applies
                // the marks; the Bench's reveal reads that. Failed/cancelled change no marks or count.
                applySequenced(event.seq) {
                    checkVote = null
                    onVoteClosed?.invoke(VoteClosed(event.voteSeq, event.outcome, event.reason))
                }
            }
            is ServerMessage.Kicked -> {
                // Followed by close 1008; the transport surfaces the closure. Nothing to reconcile
                // (the notice carries no seq), so hand it to the composition root and return.
                onKicked?.invoke(message.message)
                return
            }
        }
        publish()
    }

    /** The §7 ordering rules for sequenced events: apply iff seq is exactly lastApplied + 1; a gap
     * sends requestSync and goes resyncing (events are ignored until the snapshot lands); a stale
     * event is discarded. */
    private fun applySequenced(eventSeq: Int, apply: () -> Unit) {
        if (sync != SyncState.LIVE) return // awaiting a snapshot; ignore events
        if (eventSeq == seq + 1) {
            apply()
            seq = eventSeq
            return
        }
        if (eventSeq > seq + 1) {
            sync = SyncState.RESYNCING
            emit(ClientMessage.RequestSync(RequestSyncMessage()))
        }
        // eventSeq <= seq: stale, discard (PROTOCOL.md §7).
    }

    private fun applyCellSet(event: CellSetMessage) {
        val renderedBefore = renderValueInternal(event.cell)
        // Mark clearing on VALUE CHANGE only (PROTOCOL.md §10, the reducer's rule, mirrored from
        // the web store): a different letter or a clear removes a standing check mark; a same-value
        // no-op keeps it, because the mark is still true. Both sides of the comparison are
        // server-normalized wire values, so == is byte-wise (INV-1) exactly as the engine's.
        if (event.value != cells[event.cell]?.v) {
            checkedWrong = checkedWrong - event.cell
        }
        cells = cells + (event.cell to Cell(event.value, event.by))
        // The first fill's cellSet carries firstFillAt, so the shared timer starts on the delta
        // instead of waiting for the next snapshot (PROTOCOL.md §6; D15). Set-once: only the first
        // fill's frame carries it, and a stale or redelivered frame never reaches here (the §7 seq
        // gate in applySequenced), so the origin is set exactly once and never moves.
        if (event.firstFillAt != null && firstFillAt == null) {
            firstFillAt = event.firstFillAt
        }
        // Your own echo clears its overlay entry (INV-10).
        removeOverlayEntry(event.commandId)
        // Conflict flash (PROTOCOL.md §8, D02): another user's event changed the value you were
        // rendering as non-null. Comparing the rendered composite before and after means an event
        // masked by a still-pending overlay entry never flashes, and an erase of your letter does.
        val renderedAfter = renderValueInternal(event.cell)
        if (event.by != selfUserId && renderedBefore != null && renderedAfter != renderedBefore) {
            onConflictFlash?.invoke(ConflictFlash(event.cell, event.by))
        }
    }

    private fun removeOverlayEntry(commandId: String) {
        val index = overlay.indexOfFirst { it.commandId == commandId }
        if (index != -1) {
            overlay = overlay.toMutableList().also { it.removeAt(index) }
        }
    }

    /** Clear the pending vote intent iff it matches (an echo or a rejection of the command we sent).
     * A mismatched id (someone else's event) leaves ours in flight. */
    private fun clearPendingVote(commandId: String?) {
        if (commandId != null && commandId == pendingVoteCommandId) pendingVoteCommandId = null
    }

    /** Rebuild the view's [VoteView] from a snapshot's `board.checkVote` (PROTOCOL.md §4; D32). */
    private fun voteViewFromSnapshot(snapshot: CheckVoteSnapshot): VoteView =
        VoteView(
            voteSeq = snapshot.openedSeq,
            by = snapshot.by,
            electorate = snapshot.electorate,
            approvals = snapshot.approvals,
            rejections = snapshot.rejections,
            needed = snapshot.needed,
            expiresAt = snapshot.expiresAt,
        )

    /** Snapshot reconciliation, identical for welcome, sync, and a crash-rollback snapshot
     * (PROTOCOL.md §7, §8): replace all sequenced state (a lower seq is accepted and rolled back
     * to, INV-5), then per still-pending command: confirmed by recentCommandIds drops; aged out
     * drops without re-send; otherwise re-add and re-send (MUST, not MAY). Duplicates drop by
     * commandId. */
    private fun applySnapshot(board: Board) {
        seq = board.seq
        status = board.status
        firstFillAt = board.firstFillAt
        completedAt = board.completedAt
        abandonedAt = board.abandonedAt
        stats = board.stats
        // The marks and count ride every snapshot (PROTOCOL.md §4), so reconnect and resync heal
        // the check state with no delta replay, and a snapshot without marks clears a stale set.
        checkedWrong = board.checkedWrongCells.toSet()
        checkCount = board.checkCount
        // The open vote rides every snapshot too (PROTOCOL.md §4, §10; D32): a reconnect mid-vote
        // reconstructs the whole vote wholesale, and a snapshot with no vote clears a stale one.
        checkVote = board.checkVote?.let(::voteViewFromSnapshot)
        participants = board.participants.toList()
        cursors = board.cursors.associateBy { it.userId }
        cells = buildMap {
            board.cells.forEachIndexed { index, cell ->
                if (cell.v != null || cell.by != null) put(index, cell)
            }
        }

        val recent = board.recentCommandIds.toSet()
        val pending = overlay
        val rebuilt = mutableListOf<PendingCommand>()
        val seen = mutableSetOf<String>()
        for (entry in pending) {
            if (!seen.add(entry.commandId)) continue // duplicate commandId: drop
            if (entry.commandId in recent) continue // confirmed inside the gap
            if (entry.agedOut) continue // past the window K: drop, never re-send
            rebuilt.add(PendingCommand(entry.commandId, entry.cell, entry.value))
            emit(
                if (entry.value != null) {
                    ClientMessage.PlaceLetter(PlaceLetterMessage(entry.commandId, entry.cell, entry.value))
                } else {
                    ClientMessage.ClearCell(ClearCellMessage(entry.commandId, entry.cell))
                }
            )
        }
        overlay = rebuilt
        sync = SyncState.LIVE
    }

    // MARK: the mailbox (AD-1) and the outbound pump

    /**
     * The client-side mailbox: the ONE consumption loop over the transport's inbound flow
     * (ARCHITECTURE.md §3). Every inbound frame is applied here on the confining dispatcher, and
     * local intents are calls on the same dispatcher, so event application and intents interleave
     * in one total order. A single pump child forwards emitted frames to the transport in FIFO
     * order. Returns when the inbound flow completes (the socket closed), after marking the store
     * `reconnecting`; the session adapter then consults `nextReconnectDelaySeconds()`, sleeps, and
     * dials (AD-6).
     */
    suspend fun run(transport: Transport): Unit = coroutineScope {
        val wake = Channel<Unit>(Channel.CONFLATED)
        outboxWake = wake
        val pump = launch {
            drainOutbox(transport)
            for (signal in wake) drainOutbox(transport)
        }
        try {
            transport.inbound.collect { receive(it) }
        } finally {
            // The inbound flow completing IS the transport drop (see Ports.kt).
            connectionLost()
            outboxWake = null
            wake.close()
        }
        pump.join()
    }

    /** The one sender: FIFO order holds because only this task drains. */
    private suspend fun drainOutbox(transport: Transport) {
        while (outboxQueue.isNotEmpty()) {
            transport.send(outboxQueue.removeFirst())
        }
    }

    private fun emit(frame: ClientMessage) {
        outboxQueue.addLast(frame)
        outboxWake?.trySend(Unit)
    }
}
