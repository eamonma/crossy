// The solve room (iOS SolveScreen, trimmed to the Wave A4 functional bar): the top bar, the Canvas
// grid, the active-clue bar, and the key deck, composed over one GameStore's StateFlow. A pure
// function of the render model plus the local selection; every intent flows through InputActions so
// the screen cannot drift from the navigation vectors, and every mutation goes to the store's
// command path (optimistic overlay, INV-10). Presence, cursor relay, and the terminal freeze all
// read the same render model the grid draws from.

package crossy.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.withFrameMillis
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import crossy.design.AttributionSwitches
import crossy.design.IdentityRoster
import crossy.protocol.ClientPuzzle
import crossy.protocol.Clue
import crossy.protocol.GameStatus
import crossy.protocol.Role
import crossy.store.BoardNavigation
import crossy.store.GameStore
import crossy.store.RenderModel
import crossy.store.SyncState
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun RoomScreen(
    store: GameStore,
    puzzle: ClientPuzzle,
    roomName: String?,
    modifier: Modifier = Modifier,
    onExit: () -> Unit = {},
    // The room's share intent, or null when there is no code to share (the demo room). The
    // composition root builds the short link and fires the system share sheet (RoomBar surfaces it).
    onShare: (() -> Unit)? = null,
    // The holder's personal reaction set (Wave 8.5; D25): the five the send fan offers, sourced from
    // GET /me's reactionSet (null -> the defaults) and threaded by the composition root. Read at
    // composition, so a Settings edit reaches the fan the next time a room is entered (live mid-room
    // propagation is not required). Defaults to the protocol five for the demo room and previews.
    reactionEmojis: List<String> = ReactionPolicy.defaultSet,
    // The wall-clock instant (epoch millis) the driver's next reconnect dial is due, or null when
    // none is scheduled (SessionDriver.onReconnectScheduled, threaded by the composition root). The
    // room bar counts it down while the weather is reconnecting; a stale value left after the socket
    // returns live is never rendered (the chip gates on sync), so no clear step is needed.
    reconnectRetryAt: Long? = null,
    // The person's typing-advance settings (personal-settings slice 1), threaded by the composition
    // root from the persisted NavigationSettingsStore. DEFAULT reproduces the pre-slice behavior
    // exactly, so the demo room and previews (which pass nothing) diverge from no navigation vector.
    navigationPrefs: BoardNavigation.NavigationPrefs = BoardNavigation.NavigationPrefs.DEFAULT,
    // The person's swipe-sensitivity choice as the grid's tuning (personal-settings), threaded by the
    // composition root from the persisted NavigationSettingsStore the same way navigationPrefs is.
    // STANDARD (the default) reproduces the pre-tuning swipe grammar, so the demo room and previews
    // (which pass nothing) keep the pinned behavior.
    swipeTuning: SwipeTuning = SwipeTuning.STANDARD,
    // The resolved-avatar bridge for the roster sheet's pucks (threaded from :app's AvatarImageCache).
    // The demo room and previews pass the no-cache provider, which renders every roster row as its
    // initial (PROTOCOL.md §4, the first-class fallback).
    avatars: RosterAvatars = RosterAvatars.none,
    // The host's end-game intent (POST /games/{id}/abandon), or null when there is nothing to end this
    // way (the demo room, or a non-host composition). The facts sheet offers End game only when the
    // self is host AND this is wired; the composition root swallows the REST call's failure.
    onEndGame: (() -> Unit)? = null,
    // Kick a member (host, DELETE .../members/{id}) and a spectator's promote (POST .../role). Wired by
    // the composition root to the REST client; no-ops in the demo room. The roster sheet gates Kick to
    // the host on other people's rows, and Join in to a self-spectator; the server enforces both.
    onKick: (String) -> Unit = {},
    onJoinIn: () -> Unit = {},
    // The post-game analysis fetch (GET /games/{id}/analysis mapped to the render shape), or null when
    // there is no game behind the room (the demo room, previews): there absent stands and nothing is
    // fetched. The composition root closes over the REST client and game id and does the wire->render
    // mapping, keeping :ui out of the REST ring (the AvatarImageCache/AAD-2 pattern). Idempotent: the
    // room drives it on the completion edge and on a tab-open, and AnalysisModel fetches at most once.
    fetchAnalysis: (suspend () -> RoomAnalysis?)? = null,
    // The completion card share intent (design/post-game/SHARE.md; Wave 14.6), surfaced as the "Share
    // card" affordance in the completed room's analysis header. Null when there is no game to share (the
    // demo room, previews): there the affordance never appears. The composition root closes over the REST
    // mint, the server card PNG download, and the system share sheet (the server card is the single visual
    // source of truth), keeping :ui out of the REST and FileProvider rings.
    onShareCard: (() -> Unit)? = null,
    // The solve's haptic player (DESIGN.md §7; the Vibrator-and-View-backed twin of iOS
    // SolveHaptics.shared). The composition root builds it from the live View and Vibrator; previews
    // and the demo room pass the inert NONE, so nothing buzzes off-device.
    haptics: SolveHapticPlayer = SolveHapticPlayer.NONE,
    // The receive-haptics preference (Wave 7.5; iOS ReactionSettings.receiveHapticsEnabled): a
    // received sticker taps softly only when this is on AND it lands near the active word. A stored
    // default, ON, with no Settings UI (matching iOS); the composition root reads it on room entry.
    receiveReactionHaptics: Boolean = true,
    // Whether this composition's transport carries `checkPuzzle` to a real server (design R8): the
    // live room passes true; the demo's scripted transport DROPS the command, so it (and every
    // preview) keeps the default and the facts sheet never grows the check row. Gates the row's
    // existence entirely, not just the send (iOS SolveScreen.supportsRoomCheck).
    supportsRoomCheck: Boolean = false,
) {
    val render by store.render.collectAsStateWithLifecycle()
    val ground = if (isSystemInDarkTheme()) GridGround.OBSERVATORY else GridGround.STUDIO

    val geometry = remember(puzzle) { GridGeometry.from(puzzle) }
    val navGeom = remember(geometry) { BoardNavigation.Geometry(geometry.cols, geometry.rows, geometry.blocks) }
    var selection by remember(puzzle) { mutableStateOf(InputActions.initialSelection(navGeom)) }
    // The inline rebus entry in flight; null when rebus mode is off (iOS SelectionModel.rebusBuffer).
    // Moving the cursor away (a tap or a clue step) discards an open entry, exactly as iOS does.
    var rebusBuffer by remember(puzzle) { mutableStateOf<String?>(null) }

    val values = remember(render) { buildValues(render, geometry) }
    val filled = values.keys
    // The standing room-check marks the grid paints (PROTOCOL.md §10, D27), through the §10
    // overlay-suppression rule: a cell with a pending optimistic overlay renders the overlay, not the
    // mark (visibleCheckMarks = marks - overlayCells; iOS GridFrame.visibleCheckMarks). Indices only,
    // never values (INV-6). Empty until the first accepted check.
    val visibleCheckMarks = remember(render) {
        render.checkedWrong - render.overlay.map { it.cell }.toSet()
    }
    // A terminal room (completed or abandoned) freezes input and retires the deck (INV-4): one
    // condition, one predicate. `frozen` gates local mutation through InputActions; `deckRetired`
    // reads the same fact to remove the deck itself below.
    val frozen = deckRetired(render)
    val activeWord = remember(selection, geometry) { geometry.wordCells(selection.cell, selection.isAcross) }
    // The board's TalkBack semantics (the largest a11y gap; iOS CrossyGridView labels the grid, and
    // Android carries the active cell besides so the solve is drivable): the grid names its shape, and
    // a live description of the cursor's cell carries position, entered letter, and axis so a screen
    // reader hears where it stands and what it holds as the cursor travels.
    val gridA11yLabel = "${geometry.cols} by ${geometry.rows} crossword grid"
    val activeCellA11y = remember(selection, values, geometry) {
        val row = selection.cell / geometry.cols + 1
        val col = selection.cell % geometry.cols + 1
        val letter = values[selection.cell]?.let { "letter $it" } ?: "empty"
        val axis = if (selection.isAcross) "across" else "down"
        "Row $row, column $col, $letter, $axis"
    }
    val presence = remember(render, ground) { Presence.marks(render.cursors, render.participants, render.selfUserId, ground) }
    val cursorTint =
        if (AttributionSwitches.colorInMotionEnabled) Presence.selfColor(render.participants, render.selfUserId, ground)
        else ground.tokens.ink
    // The active clue and, from its prose, the cells of every clue it cross-references (numeric refs
    // plus, when it is a revealer, the starred clues; D26). One resolution, so the bar and the board
    // tint read the same active clue. The grid tint is the only surface here: Android has no clue
    // rail (ClueBar shows just the active clue), so the adjacent-clue lift-up has no home yet.
    val activeEntry = remember(selection, puzzle) { activeClueEntry(puzzle, selection) }
    val activeClue = activeEntry?.let {
        ActiveClue("${it.number} ${if (selection.isAcross) "ACROSS" else "DOWN"}", it.text)
    }
    val referencedKeySet = remember(activeEntry, selection.isAcross, puzzle) {
        referencedKeys(activeEntry, selection.isAcross, puzzle.clues.across, puzzle.clues.down)
    }
    val crossReference = remember(referencedKeySet, puzzle) {
        referencedCells(referencedKeySet, puzzle.clues.across, puzzle.clues.down)
    }

    // The roster the bar and its sheet read (RosterList.membersFrom maps participants + live cursors +
    // the self id), and the two gates it decides: whether the self holds the spectator seat (the
    // watching edge, below) and whether it is host (the facts sheet's End game).
    val members = remember(render.participants, render.cursors, render.selfUserId) {
        RosterList.membersFrom(render.participants, render.cursors, render.selfUserId)
    }
    val spectating = RosterList.selfIsSpectator(members, render.selfUserId)
    val selfIsHost = RosterList.selfIsHost(members, render.selfUserId)

    // The clue browser's rows (ClueBrowser.rows): the active row marked, the crossing and
    // cross-referenced rows washed (D26), a filled word de-emphasized. Rebuilt when the selection, the
    // rendered fill set, or the referenced keys change.
    val acrossRows = remember(puzzle, selection, filled, referencedKeySet) {
        ClueBrowser.rows(puzzle.clues.across, isAcross = true, selection, filled, referencedKeySet)
    }
    val downRows = remember(puzzle, selection, filled, referencedKeySet) {
        ClueBrowser.rows(puzzle.clues.down, isAcross = false, selection, filled, referencedKeySet)
    }

    // The facts sheet the time pill opens (iOS openFacts): a mid-solve surface only, gated to
    // `ongoing`, so a tap on a sealed terminal pill opens nothing.
    var factsOpen by remember(puzzle) { mutableStateOf(false) }

    // Ephemeral reactions (PROTOCOL.md §9; D24): a transient sticker book held HERE beside the
    // store, never inside it, so a snapshot or resync is provably unable to touch a sticker. The
    // store fans inbound reactions out on `reactions`; the fan's local echo places its own sticker
    // (the server never echoes a react). ReactionBook keeps the book a pure transform on an
    // immutable list, so Compose observes every placement, coalesce, and sweep.
    val reduceMotion = rememberReduceMotion()
    // The board's haptic grammar (DESIGN.md §7): one pure fold per room derives at most one moment per
    // observed (filled, selection) pair; whose hand moved is derived, never plumbed. Fed below from the
    // same composite the grid draws (the iOS observeHaptics observation point).
    val hapticFold = remember(puzzle) { SolveHapticFold() }
    var stickers by remember(puzzle) { mutableStateOf(emptyList<ReactionSticker>()) }
    var reactionSentAt by remember(puzzle) { mutableStateOf(emptyList<Double>()) }

    // The check vote UX (PROTOCOL.md §10, D32; Wave 15.6): the Bench, the ring, and the resolution
    // beat. The store owns the vote state; here the composable owns the transient resolution (a
    // closed vote animating out, whose count and tally are snapshotted since the store has cleared
    // `checkVote`), a frame clock the ring drains against, and the ignite origin. Solo is suppressed:
    // the store's render never sets showVoteBench for a solo electorate, so none of this renders for
    // the auto-pass triple, not for a frame.
    var voteResolution by remember(puzzle) { mutableStateOf<VoteResolution?>(null) }
    var pendingVotePass by remember(puzzle) { mutableStateOf(false) }
    var voteNowMs by remember(puzzle) { mutableLongStateOf(System.currentTimeMillis()) }
    var voteOpenedAt by remember(puzzle) { mutableLongStateOf(0L) }
    // The ring's remaining fraction frozen at the close instant (fix 2): the resolution fades from
    // where the drain stood instead of snapping the ring back to full. Carried across the pass's
    // close->puzzleChecked gap so the reveal flashes from the frozen fraction too.
    var voteRingFractionAtClose by remember(puzzle) { mutableFloatStateOf(1f) }
    val liveVote = rememberUpdatedState(render.checkVote)
    val liveSolo = rememberUpdatedState(render.isSoloRoom)
    val liveReduceMotion = rememberUpdatedState(reduceMotion)
    // A disconnect/resync heals the vote wholesale via snapshot with no puzzleChecked event, so a
    // pending reveal armed at a passing close would strand and replay full vote chrome on a LATER solo
    // check (solo-zero-chrome, D32; fix 3). Every heal leaves LIVE first, so clear the flag there.
    LaunchedEffect(render.sync) {
        if (render.sync != SyncState.LIVE) pendingVotePass = false
    }
    // The frame clock: while a vote or its resolution is on screen, sample wall-clock each frame so the
    // ring drains smoothly and the resolution withdraws on time. It also retires a finished resolution.
    val voteOnScreen = render.showVoteBench || voteResolution != null
    LaunchedEffect(voteOnScreen) {
        while (voteOnScreen) {
            withFrameMillis { voteNowMs = System.currentTimeMillis() }
            voteResolution?.let { if (CheckVoteBenchModel.resolutionComplete(it, voteNowMs)) voteResolution = null }
        }
    }
    // The success haptic is timed to the WASH START, not the close event (D32 reveal beat): after the
    // "Checking…" breath, when the ring flash-dissolves and the marks wash in. A resolution replaced
    // or withdrawn before the breath cancels this cleanly (the key change).
    LaunchedEffect(voteResolution) {
        if (voteResolution is VoteResolution.Passed) {
            delay(VoteBenchTiming.REVEAL_BREATH_MS)
            haptics.play(SolveHaptic.VOTE_PASSED)
        }
    }
    // The reveal beat's mark choreography (D32; UX.md U6). During the breath (0..600ms) the grid holds
    // all marks back so the beat reads "Checking…" first. After the breath the marks wash in in
    // ascending cell order over <900ms (the grid owns the per-cell stagger). Reduced motion shows them
    // all at once at the breath end, no stagger, so the wash gates off there. A solo/bare check has no
    // resolution, so its instant marks are untouched.
    val passedReveal = voteResolution as? VoteResolution.Passed
    val sinceRevealMs = passedReveal?.let { voteNowMs - it.startedAt }
    // Reduced motion has no breath: the marks apply instantly rather than being withheld 600 ms (U6;
    // fix 6). Only the animated path holds the marks back through the breath.
    val revealingBreath = !reduceMotion && sinceRevealMs != null && sinceRevealMs < VoteBenchTiming.REVEAL_BREATH_MS
    val washingChecks = sinceRevealMs != null && !reduceMotion &&
        sinceRevealMs >= VoteBenchTiming.REVEAL_BREATH_MS &&
        sinceRevealMs < VoteBenchTiming.REVEAL_BREATH_MS + VoteBenchTiming.WASH_MAX_MS + 100L

    // The conflict flash (PROTOCOL.md §8, D02): the store detects the trigger, the grid animates the
    // ~300 ms wash in the writer's color. The book is held HERE beside the render model (the iOS
    // CrossyGridView wireFlashSink placement), never inside the store. The sink resolves the writer's
    // roster color the way RoomBar resolves a dot (wire color, else the identity hash) and reads the
    // latest participants off the store so the closure captures nothing stale. Recording is ID-1
    // gated inside FlashBook.record, so muting color-in-motion silences the flash at the source.
    var flashes by remember(puzzle) { mutableStateOf(FlashBook()) }
    DisposableEffect(store, ground) {
        store.onConflictFlash = { flash ->
            val writer = store.render.value.participants.firstOrNull { it.userId == flash.by }
            val identity = writer?.let { IdentityRoster.colorForWireColor(it.color) ?: IdentityRoster.color(it.userId) }
                ?: IdentityRoster.color(flash.by)
            flashes = flashes.record(flash.cell, ground.rosterColor(identity), reactionNow())
        }
        // The room's check landing (PROTOCOL.md §6, §10; D27): one soft thud when the marks paint for
        // everyone. The store fires this only for the live sequenced event (the onConflictFlash
        // pattern) — snapshot healing is history arriving and stays silent (the store's §7 seq gate),
        // so no gate is needed here. The marks and count themselves are state the grid and facts read.
        store.onPuzzleChecked = { checked ->
            if (pendingVotePass) {
                // A passing vote's reveal (D32): open the reveal beat ("Checking…" then the ~600 ms
                // breath then the marks and "{n} to fix"). The success haptic is NOT played here (the
                // close event): it is timed to the wash start below. A solo/bare check never sets this.
                pendingVotePass = false
                voteResolution = VoteResolution.Passed(
                    checked.wrongCells.size,
                    System.currentTimeMillis(),
                    voteRingFractionAtClose, // flash/fade from the frozen fraction, never a snap-to-full (fix 2)
                )
            } else {
                // A solo auto-pass or a bare puzzleChecked (server rollout window): the check lands as
                // today, one soft thud, no vote chrome (D32 solo suppression; §10 tolerance).
                haptics.play(SolveHaptic.CHECK_LANDED)
            }
        }
        // The vote opened (D32): the firm click and the ring's ignite origin. Solo is suppressed at the
        // source (a solo electorate of one shows no chrome and no haptic, not for a frame): only a real
        // multi-elector vote rings and clicks. Snapshot healing stays silent (the §7 seq gate).
        store.onVoteOpened = { opened ->
            if (opened.electorate.size > 1) {
                voteResolution = null
                voteOpenedAt = System.currentTimeMillis()
                haptics.play(SolveHaptic.VOTE_OPENED)
            }
        }
        // A ballot settled (D32; U9): a light tick per ballot. The store fires this only for a truly
        // applied cast (never on snapshot healing); the self ballot already ticked at its tap, so only
        // remote ballots tick here (no double tick for the local voter). Fix 7.
        store.onVoteCast = { cast ->
            if (cast.by != store.render.value.selfUserId) haptics.play(SolveHaptic.VOTE_BALLOT)
        }
        // The vote closed (D32): a pass defers its reveal to the puzzleChecked that follows; a fail or
        // cancel shows its one calm line now, with the proposer-only tally from the pre-close vote.
        // Solo is suppressed (the auto-pass triple shows no chrome). A TERMINAL cancellation is silent
        // (fix 1): no line, no fail haptic, no lingering ring, because the completion/abandon surface
        // supersedes it.
        store.onVoteClosed = { closed ->
            val vote = liveVote.value
            val solo = liveSolo.value || (vote?.isSolo ?: true)
            if (!solo) {
                // Freeze the ring's last open fraction so every resolution fades from where the drain
                // stood, never snapping back to full (fix 2; U4).
                voteRingFractionAtClose =
                    vote?.let { CheckVoteBenchModel.ringFraction(it, voteNowMs, liveReduceMotion.value) } ?: 0f
                when {
                    closed.outcome == "passed" -> pendingVotePass = true
                    closed.reason == "TERMINAL" -> {
                        // The completion/abandon surface supersedes: withdraw the vote quietly, no
                        // resolution sliver, no fail haptic, no ring fade beyond immediate removal.
                        pendingVotePass = false
                        voteResolution = null
                    }
                    else -> {
                        haptics.play(SolveHaptic.VOTE_FAILED)
                        voteResolution = VoteResolution.Ended(
                            reason = closed.reason,
                            approvalsAtClose = vote?.approvals?.size ?: 0,
                            needed = vote?.needed ?: 0,
                            isProposer = vote?.by == store.render.value.selfUserId,
                            startedAt = System.currentTimeMillis(),
                            fractionAtClose = voteRingFractionAtClose,
                        )
                    }
                }
            }
        }
        onDispose {
            store.onConflictFlash = null
            store.onPuzzleChecked = null
            store.onVoteOpened = null
            store.onVoteCast = null
            store.onVoteClosed = null
        }
    }
    // The sweep (the FlashBook pattern): re-armed on every trigger, it sleeps to the soonest envelope
    // end, then retires everything past it. Under Reduce Motion the grid holds the wash static and
    // this sweep is the only thing that clears it, so the step reads for the envelope then leaves.
    LaunchedEffect(flashes) {
        val next = flashes.nextExpiry() ?: return@LaunchedEffect
        val waitMs = ((next - reactionNow()) * 1000).toLong()
        if (waitMs > 0) delay(waitMs + 20)
        flashes = flashes.sweep(reactionNow())
    }

    // The pref read live inside the long-lived collect without restarting it (the subscription must
    // not drop events on a toggle); selection is read live through its own state.
    val receiveHapticsState = rememberUpdatedState(receiveReactionHaptics)
    LaunchedEffect(store) {
        store.reactions.collect { event ->
            stickers = ReactionBook.place(stickers, event.userId, event.emoji, event.cell, reactionNow())
            // The receive tap (Wave 7.5; iOS wireReactionSink): an inbound sticker taps softly only
            // when the pref is on AND it lands on or beside the active word, so a lively room never
            // buzzes for a reaction across the board (ReactionProximity, the teammate-letter rule).
            if (receiveHapticsState.value &&
                ReactionProximity.landsNearActiveWord(event.cell, selection, geometry)
            ) {
                haptics.play(SolveHaptic.REACTION_LANDED)
            }
        }
    }
    // The sweep (the FlashBook pattern): re-armed on every mutation, it sleeps to the soonest end,
    // then retires everything past it; the layer's own exit fade already played by then.
    LaunchedEffect(stickers) {
        val next = ReactionBook.nextExpiry(stickers) ?: return@LaunchedEffect
        val waitMs = ((next - reactionNow()) * 1000).toLong()
        if (waitMs > 0) delay(waitMs + 20)
        stickers = ReactionBook.sweep(stickers, reactionNow())
    }

    // The completion moment (apps/ios/DESIGN.md §8; CompletionMoment): the celebration derives from
    // the store's status TRANSITIONS, observed here from render, never as a render fact (INV-3). The
    // gate is the exactly-once fold; it lives beside the render model as view state so a snapshot or
    // resync provably cannot touch it, and it fires the mosaic bloom and confetti exactly once per
    // completed room, never on a reconnect into an already-solved one. Android wires no GET /analysis
    // bloom, so the palette is the sequenced event log's last writer (the iOS "absent" fallback), and
    // the mosaic arms at once on the gate's firing rather than waiting for a bundle.
    val roomStatus = RoomStatus.from(render.status)
    // The post-game analysis, fetched exactly once per completed room (twin of iOS SolveScreen's
    // AnalysisModel drive). The fetch fires on the completion edge (roomStatus turns completed, whether a
    // live finish or a reconnect into a solved room) AND on a tab-open (analysisRequested, set by the
    // ClueBar's Analysis door / tab): both ask, the model resolves at most once (idempotent). A room
    // with no fetch wired (the demo room) resolves absent through a null-returning fetch, so the panel
    // reads the quiet line rather than loading forever.
    val analysisModel = remember(puzzle) { AnalysisModel() }
    var analysisRequested by remember(puzzle) { mutableStateOf(false) }
    LaunchedEffect(roomStatus, analysisRequested) {
        if (roomStatus == RoomStatus.COMPLETED || analysisRequested) {
            // A null fetch (the demo room) resolves absent through a null-returning walk, so the panel
            // reads the quiet line rather than loading forever.
            analysisModel.load { fetchAnalysis?.invoke() }
        }
    }
    var gate by remember(puzzle) { mutableStateOf(CelebrationGate()) }
    // The mosaic's presentation lifecycle (MosaicMoment), folded forward beside the gate: the bloom's
    // trigger, the settled flag (the wash STANDS, never nilled back to ink, the flash-then-disappear
    // fix), and the legend's isolation filter. Split from the gate on purpose: the gate is the
    // exactly-once celebration arbiter (INV-3), this is the wash's own record. A stand (the
    // reconnect-into-completed path) never runs through the gate, so it wears the record without ever
    // celebrating (INV-3 by construction).
    var moment by remember(puzzle) { mutableStateOf(MosaicMoment()) }
    var confettiStartedAt by remember(puzzle) { mutableStateOf<Double?>(null) }
    var celebrationFired by remember(puzzle) { mutableStateOf(false) }
    // The solved notice shows where the retired deck stood, AFTER the moment settles on a live finish,
    // and at once on a reconnect into a room already solved (there is no moment to wait on).
    var solvedNoticeVisible by remember(puzzle) { mutableStateOf(false) }

    LaunchedEffect(roomStatus, render.sync) {
        val step = gate.observe(roomStatus, render.sync == SyncState.LIVE)
        gate = step.gate
        if (!step.fired) return@LaunchedEffect
        val now = reactionNow()
        celebrationFired = true
        // The §7 completion haptic rides the gate's one firing (INV-3), never the fold: the distinct
        // pattern the player renders as the board's celebration, played exactly once per completed room.
        haptics.play(SolveHaptic.COMPLETION)
        // The bloom rides the gate's one firing: arm and set the trigger (ID-1 gated inside bloom, so a
        // muted switch arms but derives no wash). The settle lands on the STANDING wash below.
        moment = moment.bloom(now, AttributionSwitches.completionMosaicEnabled)
        // The confetti is skipped whole under Reduce Motion (a static confetto is just litter); it
        // rides the same instant as the mosaic otherwise (owner ask 2026-07-11).
        if (AttributionSwitches.completionConfettiEnabled && !reduceMotion) confettiStartedAt = now
    }
    // The board's haptic moments (iOS observeHaptics): the same (filled, selection) the grid draws
    // feeds the fold, and the one moment it derives plays. Keyed on both plus the status so it fires on
    // either change and stays silent in a frozen room (a finished board is an object, not a solve). The
    // fold's first observation seeds and never buzzes, so the effect's first run is silent by construction.
    LaunchedEffect(filled, selection, roomStatus) {
        if (roomStatus != RoomStatus.ONGOING) return@LaunchedEffect
        hapticFold.observe(filled, selection, geometry)?.let { haptics.play(it) }
    }
    // The settle's landing: once the envelope lands the mosaic STANDS (the flash-then-disappear fix,
    // iOS settleMosaic). The record is never nilled, so the completed board keeps the room's
    // fingerprint as the blurred color field under the returning ink (the wash-blur ratification; the
    // reveal arc ends at the FIELD's melt, not plain ink); `settled` also pauses the grid's frame
    // loop, a constant record costing no frames. Runs only for a live bloom; a stand is born settled,
    // so this returns at once. The envelope's duration already covers the blur fade's landing.
    LaunchedEffect(moment.startedAt, moment.settled) {
        val start = moment.startedAt
        if (start == null || moment.settled) return@LaunchedEffect
        delay((MosaicEnvelope.DURATION_SECONDS * 1000).toLong())
        if (moment.startedAt == start && !moment.settled) moment = moment.settle()
    }
    // The reconnect-into-completed path (iOS standMosaic, driven off analysis.phase's no-celebration
    // branch): a welcome snapshot of an already-solved room never fired the gate, so nothing blooms,
    // but the terminal board WEARS the settled wash the moment the first-correct bundle lands (the
    // flash-then-disappear fix's revisit half, INV-3: standing is not celebrating). An absent bundle
    // stands nothing: the wash is first-correct truth, and without the bundle there is none. The one
    // arming inside stand() makes a stand-after-bloom (or bloom-after-stand) a no-op.
    LaunchedEffect(roomStatus, celebrationFired, analysisModel.phase) {
        if (!celebrationFired &&
            roomStatus == RoomStatus.COMPLETED &&
            analysisModel.phase is AnalysisModel.Phase.Ready
        ) {
            moment = moment.stand(reactionNow(), AttributionSwitches.completionMosaicEnabled)
        }
    }
    // The confetti unmounts when its drift ends (iOS nils confettiStartedAt on the same clock).
    LaunchedEffect(confettiStartedAt) {
        val start = confettiStartedAt ?: return@LaunchedEffect
        delay((ConfettiEnvelope.DURATION_SECONDS * 1000).toLong())
        if (confettiStartedAt == start) confettiStartedAt = null
    }
    // The solved notice's timing: on the live finish it waits out the mosaic settle so the line lands
    // after the bloom, not during it; on a reconnect into a solved room (no celebration fired) it
    // shows at once, the terminal state without a replayed moment.
    LaunchedEffect(roomStatus, celebrationFired) {
        if (roomStatus != RoomStatus.COMPLETED) {
            solvedNoticeVisible = false
            return@LaunchedEffect
        }
        if (celebrationFired) delay((MosaicEnvelope.DURATION_SECONDS * 1000).toLong())
        solvedNoticeVisible = true
    }

    // The mosaic palette: every filled cell to its writer's roster color, from the sequenced event log
    // (never the optimistic overlay), resolved the way Presence resolves a dot (GridMosaic). Rebuilt
    // only when the sequenced cells or the roster change, so the bloom paints stable color per frame.
    // The palette upgrades from last-writer to first-correct owners when the analysis bundle lands
    // (iOS owner ruling 2026-07-13): before the bundle the bloom paints the sequenced event log's last
    // writer (the absent fallback), and once GET /analysis resolves it repaints in first-correct owner
    // color. Both are a cell->userId map, so the GridMosaic seam takes either with no reshaping; the
    // bundle joins the key so the bloom repaints the frame it arrives on.
    val mosaic = remember(render.cells, render.participants, ground, moment, analysisModel.bundle) {
        moment.startedAt?.let { startedAt ->
            val writers = analysisModel.bundle?.owners ?: sequencedWriters(render.cells)
            MosaicWash(
                colors = GridMosaic.colors(writers, render.participants, ground),
                startedAt = startedAt,
                writers = writers,
                settled = moment.settled,
                isolation = moment.isolation,
            )
        }
    }
    // The directional word loupe's gate (WordLoupe.showsWordLoupe; iOS analysisResting && mosaicSettled):
    // the settled completed board wears the clear glass over the active word. The grid drops its plain
    // selection tint under the same flag (the glass IS the selection made visible on the settled board).
    val showLoupe = showsWordLoupe(roomStatus, moment.settled)
    // The confetti field: the room's writers in their roster colors (the people are the only color,
    // §1), spectators lending none, deterministically seeded so the drift is stable across renders.
    val confettiField = remember(render.participants, ground) {
        val colors = render.participants
            .filter { it.role != Role.SPECTATOR }
            .map { ground.rosterColor(IdentityRoster.colorForWireColor(it.color) ?: IdentityRoster.color(it.userId)) }
        ConfettiField.make(colors)
    }
    // The grid's live camera, reported up from CrossyGrid so the sticker overlay rides the same zoom
    // and pan (iOS threads its resolved camera into the sticker layer). Null at rest, so nothing moves.
    var gridCamera by remember(puzzle) { mutableStateOf<GridCamera?>(null) }

    // Fire a reaction at the current cursor cell: the 5/s sliding-window cap decides, an accepted
    // send echoes locally at once (the server never echoes, §9) and goes to the wire. A capped
    // attempt sends nothing and echoes nothing.
    fun fireReaction(emoji: String) {
        val self = render.selfUserId ?: return
        val now = reactionNow()
        if (!ReactionSendCap.allows(reactionSentAt, now)) return
        reactionSentAt = ReactionSendCap.record(reactionSentAt, now)
        stickers = ReactionBook.place(stickers, self, emoji, selection.cell, now)
        store.react(emoji, selection.cell)
        // A light confirmation under the fan's fire (iOS fireReaction; Wave 7.5): the send is the only
        // reaction haptic that never gates, it is your own hand.
        haptics.play(SolveHaptic.REACTION_SENT)
    }

    // The input env is rebuilt per intent so it reads the latest filled set, freeze, and prefs.
    fun env() = InputEnv(navGeom, filled, selection, frozen, navigationPrefs)

    // The cursor relay (iOS SolveScreen.relayCursor): every selection change goes to the room,
    // throttled to the wire's 10/s cap with a leading send and one coalesced trailing send that
    // always carries the latest position (PROTOCOL.md §9). The store refuses sends while connecting.
    val relayScope = rememberCoroutineScope()
    val relay = remember(puzzle) { CursorRelayThrottle() }
    var trailingRelay by remember(puzzle) { mutableStateOf<Job?>(null) }

    fun relayCursor(sel: GridSelection) {
        // Spectators never send (their cursors are suppressed by default, DESIGN.md §15; iOS
        // relayCursor's spectating gate): browsing stays local, nothing reaches the wire.
        if (spectating) return
        when (val verdict = relay.selectionChanged(reactionNow())) {
            is CursorRelayThrottle.Verdict.Send -> store.moveCursor(sel.cell, sel.direction)
            is CursorRelayThrottle.Verdict.ScheduleTrailing -> {
                trailingRelay?.cancel() // one pending trailing send at a time (iOS relayTrailing)
                trailingRelay = relayScope.launch {
                    delay((verdict.afterSeconds * 1000).toLong())
                    relay.trailingFired(reactionNow())
                    // Read the latest selection at fire time; a stale final cursor would lie.
                    store.moveCursor(selection.cell, selection.direction)
                }
            }
            CursorRelayThrottle.Verdict.Coalesce -> Unit
        }
    }

    fun apply(effect: InputEffect) {
        for (mutation in effect.mutations) when (mutation) {
            is GridMutation.Place -> store.placeLetter(mutation.cell, mutation.value)
            is GridMutation.Clear -> store.clearCell(mutation.cell)
        }
        selection = effect.selection
        relayCursor(effect.selection)
    }

    // A deck key while a rebus buffer is open (iOS SelectionModel.pressInRebusMode): letters grow
    // the buffer, backspace edits and exits, the rebus key commits. Outside the buffer, the rebus
    // key opens it and the rest run the vectored input actions.
    fun onDeckKey(key: DeckKey) {
        val buffer = rebusBuffer
        if (buffer != null) {
            when (key) {
                is DeckKey.Letter -> rebusBuffer = RebusBuffer.append(buffer, key.character)
                DeckKey.Backspace -> rebusBuffer = when (val step = RebusBuffer.backspace(buffer)) {
                    is RebusStep.Editing -> step.buffer
                    else -> null
                }
                DeckKey.Rebus -> when (val step = RebusBuffer.commit(buffer)) {
                    is RebusStep.Commit -> { rebusBuffer = null; apply(InputActions.rebus(env(), step.value)) }
                    else -> rebusBuffer = null
                }
            }
            return
        }
        when (key) {
            is DeckKey.Letter -> apply(InputActions.letter(env(), key.character))
            DeckKey.Backspace -> apply(InputActions.backspace(env()))
            DeckKey.Rebus -> rebusBuffer = ""
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
      Column(modifier = Modifier.fillMaxSize().background(ground.tokens.canvas.toColor())) {
        RoomBar(
            roomName = roomName,
            participants = render.participants,
            cursors = render.cursors,
            selfUserId = render.selfUserId,
            sync = render.sync,
            status = render.status,
            firstFillAt = render.firstFillAt,
            // The clock freezes at either terminal instant (ID-2): completion by design, and a
            // host-ended room stops at the abandonment rather than ticking over a dead board.
            freezeAt = render.completedAt ?: render.abandonedAt,
            ground = ground,
            avatars = avatars,
            onExit = onExit,
            onShare = onShare,
            // The tap opens the facts sheet mid-solve only (iOS gates openFacts to `ongoing`).
            onTapTime = { if (render.status == GameStatus.ONGOING) factsOpen = true },
            // Go to a member's cursor: jump the local selection (the camera follows) exactly as a clue
            // step does, discarding any open rebus entry. A pure move-away, so it relays the cursor.
            onGoTo = { cursor ->
                rebusBuffer = null
                val target = GridSelection(cursor.cell, cursor.isAcross)
                selection = target
                relayCursor(target)
            },
            onKick = onKick,
            onJoinIn = onJoinIn,
            reconnectRetryAt = reconnectRetryAt,
        )
        // The room-facts sheet (iOS RoomFactsSheet), presented off the time pill's tap while ongoing:
        // the room name, the live clock, and the host's End game under a two-beat confirm. A
        // ModalBottomSheet, so it renders as its own surface over the room and dismisses on swipe-down
        // or outside tap. End game shows only for a host with the intent wired (the demo room has none).
        if (factsOpen && render.status == GameStatus.ONGOING) {
            RoomFactsSheet(
                ground = ground,
                content = RoomFactsContent.make(
                    roomName?.takeIf { it.isNotBlank() } ?: "Crossy",
                    // The mid-solve check record (R10) and the sitting-count context (D29): each null
                    // mid-solve (stats arrive at completion), so both read as today until then.
                    checkCount = render.checkCount,
                    sittingCount = render.stats?.sittingCount,
                ),
                // The check row (any host or solver on a live transport, R8/§5) above the host's
                // end-game (§12); its enable gate reads the SEQUENCED empty-cell count (R9: overlays
                // excluded, mirroring the server's own filledCount gate).
                operations = FactsOperations.make(
                    isHost = selfIsHost && onEndGame != null,
                    isSpectator = spectating,
                    supportsCheck = supportsRoomCheck,
                    emptyCells = geometry.playableCellCount - render.filledCount,
                ),
                // The headline Time is active time (owner ruling, D29): the stats twin's preference
                // rule, wall-clock fallback for a frozen pre-D29 row.
                solveTimeSeconds = render.stats?.headlineSolveSeconds,
                firstFillAt = render.firstFillAt,
                freezeAt = render.completedAt ?: render.abandonedAt,
                // The confirm-time race resolves in layers (design R2): fullness re-derives from
                // SEQUENCED state at the confirm tap (a teammate emptying a cell between render and
                // confirm quietly falls back to the disabled row), and a server GRID_NOT_FULL stays
                // silent (§11 non-fatal). The send is the store's intent (R1, no overlay entry).
                // Multiplayer proposes a public vote, so the check control holds to propose (U3, D32);
                // solo auto-passes and keeps the confirm. The grid-full gate re-derives at the propose
                // moment (R2); a GRID_NOT_FULL / VOTE_PENDING answer is non-fatal and silent (§11).
                isSolo = render.isSoloRoom,
                onCheckPuzzle = {
                    if (store.render.value.filledCount == geometry.playableCellCount) store.checkPuzzle()
                },
                onEndGame = { onEndGame?.invoke() },
                onDismiss = { factsOpen = false },
            )
        }
        Box(
            modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            contentAlignment = Alignment.Center,
        ) {
            CrossyGrid(
                geometry = geometry,
                values = values,
                selection = selection,
                activeWord = activeWord,
                presence = presence,
                ground = ground,
                cursorTint = cursorTint,
                crossReference = crossReference,
                // Held back through the reveal breath so a passing vote reads "Checking…" first, then
                // the marks wash in ascending (U6, driven by washingChecks); shown as today otherwise.
                checkedWrong = if (revealingBreath) emptySet() else visibleCheckMarks,
                washingChecks = washingChecks,
                flashes = flashes,
                mosaic = mosaic,
                showsWordLoupe = showLoupe,
                reduceMotion = reduceMotion,
                gridContentDescription = gridA11yLabel,
                activeCellDescription = activeCellA11y,
                swipeTuning = swipeTuning,
                modifier = Modifier.fillMaxWidth(),
                onCamera = { gridCamera = it },
                onCellTap = { cell ->
                    InputActions.tap(env(), cell)?.let {
                        rebusBuffer = null // moving the cursor away discards an open rebus entry
                        selection = it
                        relayCursor(it)
                    }
                },
                // A grid swipe drives the same navigation the deck and clue chevrons do (iOS
                // SelectionModel.swipe): along the solving axis is next/prev word, across it toggles.
                // A move-away, so it discards an open rebus entry.
                onSwipe = { intent ->
                    rebusBuffer = null
                    apply(InputActions.swipe(env(), intent))
                },
            )
            // The directional word loupe over the settled completed board (WordLoupeLayer): iOS mounts it
            // as an overlay ABOVE the Canvas and BELOW the reaction stickers, so it sits here between the
            // grid and the sticker layer. It rides the same reported camera the stickers do, is sized to
            // the grid identically (one module edge governs all three), and never hit-tests, so grid taps
            // pass through. Mounted only when the gate holds, so nothing draws mid-solve or during the bloom.
            if (showLoupe) {
                WordLoupeLayer(
                    geometry = geometry,
                    selection = selection,
                    ground = ground,
                    camera = gridCamera,
                    reduceMotion = reduceMotion,
                    modifier = Modifier.fillMaxWidth().aspectRatio(geometry.cols.toFloat() / geometry.rows),
                )
            }
            // The sticker overlay ABOVE the grid, sized to it (same fillMaxWidth + aspectRatio, so
            // one module edge governs both): reactions render at their cell as native emoji. It
            // never hit-tests, so grid taps pass through untouched.
            ReactionStickerLayer(
                stickers = stickers,
                geometry = geometry,
                camera = gridCamera,
                reduceMotion = reduceMotion,
                modifier = Modifier.fillMaxWidth().aspectRatio(geometry.cols.toFloat() / geometry.rows),
            )
            // The vote ring (PROTOCOL.md §10, D32): a warm-gold halo just outside the grid bounds,
            // draining with the remaining time. The ONLY clock (no digits anywhere). It is hit-inert
            // (a decorative Canvas), so grid taps pass through: the grid above stays fully interactive
            // during a vote. Shows for a live multi-elector vote (never solo) or a resolution fading
            // out; ignites on open, flash-dissolves on a pass, fades quietly on a fail/cancel.
            run {
                val openVote = render.checkVote?.takeIf { render.showVoteBench }
                val res = voteResolution
                if (openVote != null || res != null) {
                    // While open, the live drain; at close, the fraction frozen into the resolution, so
                    // the ring fades from where it stood rather than snapping back to full (fix 2).
                    val fraction = openVote?.let { CheckVoteBenchModel.ringFraction(it, voteNowMs, reduceMotion) }
                        ?: (res?.fractionAtClose ?: 1f)
                    val ignite = if (reduceMotion || openVote == null) 1f
                        else ((voteNowMs - voteOpenedAt).toFloat() / 300f).coerceIn(0.4f, 1f)
                    val dissolve = if (res is VoteResolution.Passed && !reduceMotion) {
                        ((voteNowMs - res.startedAt - VoteBenchTiming.REVEAL_BREATH_MS).toFloat() / 400f).coerceIn(0f, 1f)
                    } else {
                        0f
                    }
                    val ringAlpha = if (res is VoteResolution.Ended) {
                        (1f - (voteNowMs - res.startedAt).toFloat() / VoteBenchTiming.RECESS_MS).coerceIn(0f, 1f)
                    } else {
                        1f
                    }
                    VoteRing(
                        fraction = fraction,
                        ground = ground,
                        ignite = ignite,
                        dissolve = dissolve,
                        alpha = ringAlpha,
                        reduceMotion = reduceMotion,
                        modifier = Modifier.fillMaxWidth().aspectRatio(geometry.cols.toFloat() / geometry.rows),
                    )
                }
            }
            // The floating fan at the grid's trailing-bottom corner (near the clue bar's trailing
            // corner). It is composed here, OUTSIDE the terminal deck retirement below, so it stays
            // visible in any status (reactions are legal post-completion, §9). Gated only before the
            // first welcome, where there is no cursor to aim at yet.
            ReactionFan(
                onPick = { fireReaction(it) },
                ground = ground,
                emojis = reactionEmojis,
                enabled = render.sync != SyncState.CONNECTING,
                reduceMotion = reduceMotion,
                modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp),
            )
            // Reconnecting (and the pre-welcome connecting state) dims the board (DESIGN.md §8;
            // RoomWeather.boardDimmed): a paper wash at 0.45, never a modal or a spinner. It carries
            // no pointer input, so taps still reach the grid and the fan beneath it; input stays live
            // and the store holds it gracefully (PROTOCOL.md §8).
            if (RoomWeather.boardDimmed(render.sync)) {
                Box(
                    Modifier
                        .matchParentSize()
                        .background(ground.tokens.canvas.toColor().copy(alpha = RoomWeather.boardDimOpacity.toFloat())),
                )
            }
        }
        ClueBar(
            clue = activeClue,
            ground = ground,
            acrossRows = acrossRows,
            downRows = downRows,
            // A clue step is a move-away, so it discards an open rebus entry (iOS swipe rule).
            onPrev = { rebusBuffer = null; apply(InputActions.previousWord(env())) },
            onNext = { rebusBuffer = null; apply(InputActions.nextWord(env())) },
            // A browser jump is the pointer's clueClick (iOS ClueBrowserList.jumpTarget): the clue's
            // first cell, its axis set. A move-away, so it discards an open rebus entry and relays.
            onJump = { row ->
                rebusBuffer = null
                val target = ClueBrowser.jumpTarget(row)
                selection = target
                relayCursor(target)
            },
            // A completed room grows the analysis surface: the bar becomes the gold Analysis door and
            // the browser sheet gains the Clues/Analysis tab pair (iOS ClueChrome). The ongoing bar is
            // untouched (completed is false). Opening the surface kicks the idempotent fetch too.
            completed = roomStatus == RoomStatus.COMPLETED,
            analysisPhase = analysisModel.phase,
            analysisMembers = members,
            selfUserId = render.selfUserId,
            onOpenAnalysis = { analysisRequested = true },
            // The legend isolation filter (iOS AnalysisPanel legend chips over the settled wash) folds
            // MosaicMoment.toggleIsolation and feeds the grid's MosaicWash above. Gated on
            // moment.settled: a bloom in flight keeps the legend rows plain and ignores taps (INV-3).
            isolatedSolverId = moment.isolatedSolverId,
            onIsolateSolver = if (moment.settled) {
                { id: String -> moment = moment.toggleIsolation(id, reactionNow()) }
            } else null,
            // The "Share card" header affordance rides only the completed analysis surface; ClueBar
            // renders it only when the room is completed and this intent is wired (the demo room passes
            // null, so no affordance appears there).
            onShareCard = onShareCard,
        )
        if (frozen) {
            // A terminal room retires the deck for everyone (iOS SolveScreen; #205 solved, #235
            // host-ended): a solved room reads "Solved together" where the deck stood, after the
            // completion moment settles or at once on a reconnect into an already-solved room
            // (SolvedNotice); a host-ended room shows the one quiet abandoned notice (iOS
            // abandonedZone); otherwise a small spacer keeps the bottom breath (iOS completed:
            // Color.clear.frame(height: 12)).
            if (roomStatus == RoomStatus.COMPLETED && solvedNoticeVisible) {
                SolvedNotice(
                    ground = ground,
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                )
            } else if (render.status == GameStatus.ABANDONED) {
                AbandonedNotice(ground)
            } else {
                Spacer(Modifier.height(12.dp))
            }
        } else if (spectating) {
            // The spectator edge (iOS watchingZone; EXPERIENCE.md Watching): the full live room,
            // read-only, one affordance. The deck leaves; Join in promotes the seat (changeRole to
            // solver, wired by the composition root). A spectator's input is refused anyway (their
            // cursor is suppressed, DESIGN.md §15), so retiring the deck is the honest surface.
            WatchingZone(ground, onJoinIn)
        } else {
            // The inline rebus field sits over the deck while a buffer is open (iOS SolveScreen):
            // multi-glyph entry types into it and the rebus key commits it back through the deck.
            rebusBuffer?.let { buffer ->
                RebusField(
                    buffer = buffer,
                    ground = ground,
                    modifier = Modifier.padding(horizontal = 10.dp).padding(bottom = 6.dp),
                )
            }
            KeyDeck(
                ground = ground,
                rebusActive = rebusBuffer != null,
                onKey = { onDeckKey(it) },
                // The per-press tick at touch-DOWN (iOS KeyHaptics), fired for every deck key including
                // rebus edits, the light confirm that reads as one weighted press with the visual pop.
                onKeyTick = { haptics.keyTick() },
            )
        }
      }
      // The completion confetti over the WHOLE room (not the grid), between the room and any chrome
      // (§1: people between): a restrained roster-colored drift riding the celebration's instant. The
      // model owns its clock (never set under Reduce Motion, nilled when the drift ends), so this
      // layer simply unmounts; it is hit-inert, so every touch still reaches the room beneath it.
      confettiStartedAt?.let { start ->
          ConfettiOverlay(
              field = confettiField,
              startedAt = start,
              modifier = Modifier.matchParentSize(),
          )
      }
      // The Bench (PROTOCOL.md §10, D32): the vote's venue, a NON-MODAL bottom sheet overlaying the
      // room's bottom with no scrim, so the grid stays fully interactive above it. It installs no
      // BackHandler, so predictive back keeps navigating the room while the Bench stays docked. Solo
      // is suppressed (showVoteBench is false for a solo electorate). Its chips borrow the existing
      // identity colors; its verbs cast the ballot and tick.
      if (render.showVoteBench || voteResolution != null) {
          VoteBench(
              vote = render.checkVote?.takeIf { render.showVoteBench },
              resolution = voteResolution,
              selfUserId = render.selfUserId,
              ground = ground,
              nowMillis = voteNowMs,
              reduceMotion = reduceMotion,
              // Null for a departed/unknown elector; the model supplies the collective fallback copy
              // (never a raw userId, fix 5).
              nameFor = { id -> render.participants.firstOrNull { it.userId == id }?.displayName },
              colorFor = { id ->
                  val member = render.participants.firstOrNull { it.userId == id }
                  val identity = member?.let { IdentityRoster.colorForWireColor(it.color) ?: IdentityRoster.color(it.userId) }
                      ?: IdentityRoster.color(id)
                  ground.rosterColor(identity).toColor()
              },
              // The verbs settle disabled while a ballot is in flight (fix 7): no doomed second ballot.
              ballotPending = render.pendingVoteCommandId != null,
              onApprove = { store.castCheckVote(approve = true); haptics.play(SolveHaptic.VOTE_BALLOT) },
              onKeepSolving = { store.castCheckVote(approve = false); haptics.play(SolveHaptic.VOTE_BALLOT) },
              modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
          )
      }
    }
}

/** The spectator edge (iOS SolveScreen `watchingZone`; EXPERIENCE.md Watching): the full live room,
 *  read-only, one affordance. The quiet Watching word names the seat and the Join in pill promotes it
 *  (changeRole spectator -> solver, the only server-supported transition, PROTOCOL.md §12); the words
 *  are plain (ID-5). Sits where the deck would, so the room's shape holds when the seat changes. */
@Composable
private fun WatchingZone(ground: GridGround, onJoinIn: () -> Unit) {
    val tokens = ground.tokens
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(tokens.canvas.toColor())
            .padding(horizontal = 10.dp)
            .padding(top = 10.dp, bottom = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "Watching",
            color = tokens.number.toColor(),
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
        Surface(
            color = tokens.cell.toColor(),
            contentColor = tokens.ink.toColor(),
            shape = RoundedCornerShape(23.dp),
            modifier = Modifier
                .fillMaxWidth()
                .pointerInput(Unit) { detectTapGestures { onJoinIn() } },
        ) {
            Text(
                "Join in",
                color = tokens.ink.toColor(),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(vertical = 13.dp),
            )
        }
    }
}

/** A terminal room retires its key deck for everyone (iOS SolveScreen / RoomTerminal.deckRetired;
 *  #205 solved, #235 host-ended): once the render model reports completed or abandoned the deck
 *  leaves and never returns. A pure function of the render model, so the retirement lands on the
 *  first frame the model reports terminal — the welcome that carries the terminal status retires
 *  the deck with no flash, exactly as a mid-solve completion does. One predicate covers both
 *  terminal statuses (`!= ONGOING`), so the host-ended case (#235) needs no view logic beyond the
 *  solved case (#205). Mutation was already refused by the store and InputActions (INV-4); this is
 *  the rendered truth. Selection stays for browsing. */
internal fun deckRetired(render: RenderModel): Boolean = render.status != GameStatus.ONGOING

/** The board's rendered composite as a cell to glyph map, blocks and empty cells omitted. Reads the
 *  store's INV-10 composite (sequenced state painted with the overlay) through GameStore.renderValue. */
private fun buildValues(render: RenderModel, geometry: GridGeometry): Map<Int, String> {
    val out = HashMap<Int, String>()
    for (cell in 0 until geometry.cellCount) {
        if (cell in geometry.blocks) continue
        render.renderValue(cell)?.let { out[cell] = it }
    }
    return out
}

/** The clue running through the cursor on its axis: the one whose cell list contains the selection,
 *  on the solving axis. Null when no clue names the cell (a lone cell or a gap), which renders an
 *  empty bar and tints nothing. The bar label and the cross-reference resolution both read this one
 *  clue, so they can never disagree on which clue is active. */
private fun activeClueEntry(puzzle: ClientPuzzle, selection: GridSelection): Clue? {
    val list = if (selection.isAcross) puzzle.clues.across else puzzle.clues.down
    return list.firstOrNull { selection.cell in it.cellIndices }
}
