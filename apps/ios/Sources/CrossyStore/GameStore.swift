// The client store (AD-1): sequenced state plus an optimistic overlay, reconciled to
// the server's order (DESIGN.md §10, INV-10; PROTOCOL.md §7, §8). The client-store
// vectors (vectors/v1/client-store) are the specification; Tests/CrossyStoreTests
// executes every case against this class, mirroring the web twin
// (apps/web/src/store/gameStore.ts) so the two stores cannot drift. The store speaks
// wire types from CrossyProtocol and sends through the Transport port, so tests need
// no socket.

import CrossyProtocol
import Foundation
import Observation

/// The store's connection state. Three of these are the PROTOCOL.md §7 wire lifecycle
/// (token set normative in vectors/README.md): `live` applies events in order;
/// `resyncing` has seen a gap, sent `requestSync`, and ignores sequenced events until
/// the next snapshot; `reconnecting` lost the socket after a drop or fatal error and
/// waits for the reconnect `welcome` to reconcile.
///
/// `connecting` is the honest initial state before the first `welcome` ever lands,
/// mirrored from the web store: no board exists yet, so it is deliberately distinct
/// from `reconnecting` (a post-drop state) and local mutations are refused until there
/// is authoritative state to build on. It is client-local and pre-handshake: no vector
/// encodes it (every case supplies an explicit `given.sync` and only transitions
/// produce live/resyncing/reconnecting), and no wire message carries it.
public enum SyncState: String, Sendable, Equatable {
    case connecting
    case live
    case resyncing
    case reconnecting
}

/// A sent-but-unconfirmed mutation (PROTOCOL.md §8). `value` is nil for a pending
/// clearCell. `agedOut` marks an entry past the recent-command window K, so snapshot
/// reconciliation drops it instead of re-sending; how a client measures age against K
/// is deliberately unsettled (PROTOCOL.md §8, "Age against K"), so nothing in this
/// store derives the flag. The vectors supply it as case input.
public struct PendingCommand: Sendable, Equatable {
    public let commandId: String
    public let cell: Int
    public let value: String?
    public let agedOut: Bool

    public init(commandId: String, cell: Int, value: String?, agedOut: Bool = false) {
        self.commandId = commandId
        self.cell = cell
        self.value = value
        self.agedOut = agedOut
    }
}

/// A conflict-flash trigger (PROTOCOL.md §8, D02): the store detects, the view
/// animates the ~300 ms flash in the writer's color.
public struct ConflictFlash: Sendable, Equatable {
    public let cell: Int
    public let by: String

    public init(cell: Int, by: String) {
        self.cell = cell
        self.by = by
    }
}

/// One GameStore per connected game (ARCHITECTURE.md §3): the client mirror of the
/// server's per-game actor. `@MainActor` and `@Observable` (AD-3): SwiftUI reads it
/// synchronously with no hop, and every transition is O(1)-ish work the main thread
/// absorbs trivially. The single mailbox is `run(_:)`, the one consumption loop over
/// the transport's inbound stream; local intents are MainActor calls, so event
/// application and intents interleave in one total order on the main actor.
///
/// Views see sequenced state painted with the overlay and nothing else (INV-10),
/// through `renderValue(_:)`.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class GameStore {
    /// Starting state, used by the vector suite to seed `given` and by previews. A
    /// freshly opened game omits it and starts `connecting` (see `SyncState`).
    public struct Seed: Sendable {
        public var seq: Int
        public var sync: SyncState
        public var status: GameStatus
        public var cells: [Int: Cell]
        public var overlay: [PendingCommand]

        public init(
            seq: Int,
            sync: SyncState,
            status: GameStatus = .ongoing,
            cells: [Int: Cell] = [:],
            overlay: [PendingCommand] = []
        ) {
            self.seq = seq
            self.sync = sync
            self.status = status
            self.cells = cells
            self.overlay = overlay
        }
    }

    // MARK: - Read surface (views are pure functions of this)

    /// Last applied sequence number (PROTOCOL.md §7).
    public private(set) var seq: Int
    public private(set) var sync: SyncState
    public private(set) var status: GameStatus
    /// Sequenced cells, sparse: an unlisted cell is `{v: nil, by: nil}` (a black
    /// square or a never-written cell, PROTOCOL.md §4).
    public private(set) var cells: [Int: Cell]
    /// The optimistic overlay in send order, oldest first (PROTOCOL.md §8).
    public private(set) var overlay: [PendingCommand]
    /// Presence, render-only: never persisted, never sequenced (PROTOCOL.md §9).
    public private(set) var participants: [Participant] = []
    /// Live cursors by userId, render-only (PROTOCOL.md §9).
    public private(set) var cursors: [String: Cursor] = [:]
    /// The derived timer origin (root DESIGN.md D15): set once from the first fill's
    /// delta `cellSet` (PROTOCOL.md §6) and authoritative from every snapshot (§4).
    public private(set) var firstFillAt: String?
    public private(set) var completedAt: String?
    public private(set) var abandonedAt: String?
    public private(set) var stats: Stats?
    public private(set) var selfUserId: String?
    /// The last non-fatal rejection, surfaced for the UI (PROTOCOL.md §8: a non-fatal
    /// error clears the matching overlay entry and surfaces the rejection).
    public private(set) var lastRejection: ErrorMessage?
    /// Outbound frames awaiting the transport pump, in send order. Transitions append
    /// synchronously, so the vector suite asserts `then.send` deterministically;
    /// `run(_:)` drains to the transport in the same order.
    public private(set) var outbox: [ClientMessage] = []
    /// The reconnect walk (AD-6). The store owns the decision state; the adapter
    /// consumes delays via `nextReconnectDelaySeconds()` and only sleeps and dials.
    public private(set) var backoff: BackoffSchedule

    /// The view animates the ~300 ms conflict flash; the store only detects the
    /// trigger (PROTOCOL.md §8, D02). Vectors exclude it: ephemeral view animation.
    @ObservationIgnored public var onConflictFlash: (@MainActor (ConflictFlash) -> Void)?

    /// The composition root raises the kicked terminal from this notice (EXPERIENCE.md
    /// Kicked; the I2d flag lives on RoomChromeModel). The `kicked` frame carries no
    /// `seq` and mutates no sequenced state (PROTOCOL.md §6: it is followed by close
    /// 1008), so the store reconciles nothing and the vectors exclude it; it only
    /// surfaces the notice to the root, the one place that owns the exit, exactly as
    /// `onConflictFlash` surfaces the flash to the view. Set by the composition root.
    @ObservationIgnored public var onKicked: (@MainActor (KickedMessage) -> Void)?

    @ObservationIgnored private let newCommandId: () -> String
    @ObservationIgnored private var outboxWake: AsyncStream<Void>.Continuation?

    public init(
        seed: Seed? = nil,
        backoff: BackoffSchedule = BackoffSchedule(),
        newCommandId: (() -> String)? = nil
    ) {
        self.seq = seed?.seq ?? 0
        self.sync = seed?.sync ?? .connecting
        self.status = seed?.status ?? .ongoing
        self.cells = seed?.cells ?? [:]
        self.overlay = seed?.overlay ?? []
        self.backoff = backoff
        // PROTOCOL.md §3: commandId is a client-generated UUIDv4. Lowercased to the
        // RFC 4122 canonical form the web's crypto.randomUUID emits; the fold is
        // ASCII-only by construction (UUID text is ASCII hex and dashes; INV-1).
        self.newCommandId = newCommandId ?? { UUID().uuidString.asciiLowercasedUUID() }
    }

    /// The composite the user sees for one cell (INV-10): sequenced state painted
    /// with the overlay, the most recently sent pending entry winning per cell
    /// (PROTOCOL.md §8). Pending values render through the same path as confirmed
    /// ones, so the view cannot tell them apart.
    public func renderValue(_ cell: Int) -> String? {
        for entry in overlay.reversed() where entry.cell == cell {
            return entry.value
        }
        return cells[cell]?.v
    }

    // MARK: - Local intents (PROTOCOL.md §8: overlay entry plus send)

    public func placeLetter(cell: Int, value: String, commandId: String? = nil) {
        sendMutation(cell: cell, value: normalizeValue(value), commandId: commandId)
    }

    public func clearCell(cell: Int, commandId: String? = nil) {
        sendMutation(cell: cell, value: nil, commandId: commandId)
    }

    /// Relay the local cursor to the room (PROTOCOL.md §5, §9). Ephemeral: no overlay,
    /// no seq, best-effort. Refused before the first snapshot (`connecting`), since
    /// there is no authoritative game to move a cursor over yet; the 10/s throttle is
    /// the caller's job (§9).
    public func moveCursor(cell: Int, direction: Direction) {
        if sync == .connecting { return }
        emit(.moveCursor(MoveCursorMessage(cell: cell, direction: direction)))
    }

    /// Liveness ping (PROTOCOL.md §5, §9). The adapter owns the 15 s timer
    /// (`ReconnectPolicy.heartbeatIntervalSeconds`); emitting through the store keeps
    /// one ordered outbound path. Meaningless before the first welcome, so gated like
    /// the other intents.
    public func heartbeat() {
        if sync == .connecting { return }
        emit(.heartbeat(HeartbeatMessage()))
    }

    private func sendMutation(cell: Int, value: String?, commandId: String?) {
        // Before the first welcome there is no authoritative board yet: refuse local
        // mutations so a keystroke cannot mint an overlay entry against an empty grid
        // (the web store's pre-welcome gate, mirrored). The first welcome flips sync
        // to live and unlocks input; a later drop goes reconnecting, where optimistic
        // mutations are still allowed and reconciled (PROTOCOL.md §8).
        if sync == .connecting { return }
        // Terminal states freeze mutation locally: refused here, never reaching the
        // wire (INV-4 governs the board; the server would answer GAME_NOT_ONGOING).
        if status != .ongoing { return }
        let id = commandId ?? newCommandId()
        overlay.append(PendingCommand(commandId: id, cell: cell, value: value))
        if let value {
            emit(.placeLetter(PlaceLetterMessage(commandId: id, cell: cell, value: value)))
        } else {
            emit(.clearCell(ClearCellMessage(commandId: id, cell: cell)))
        }
    }

    // MARK: - Connection state machine (PROTOCOL.md §7; AD-6)

    /// The transport lost the socket: back off and reconnect (PROTOCOL.md §7). The
    /// overlay is preserved so the reconnect welcome can re-send it (§8).
    public func connectionLost() {
        sync = .reconnecting
    }

    /// The next reconnect delay (AD-6): the store decides, the adapter sleeps and
    /// dials. Full jitter over the 0/1/2/4/8/16/30 s walk (PROTOCOL.md §7).
    public func nextReconnectDelaySeconds() -> Double {
        backoff.nextDelaySeconds()
    }

    /// Report how long the last connection lived; 30 s or more resets the backoff
    /// walk (PROTOCOL.md §7). The duration arrives as data: the store holds no clock.
    public func connectionSurvived(seconds: Double) {
        backoff.connectionSurvived(seconds: seconds)
    }

    // MARK: - Inbound frames (decoded by CrossyProtocol before they reach here)

    public func receive(_ message: ServerMessage) {
        switch message {
        case .welcome(let welcome):
            selfUserId = welcome.selfIdentity.userId
            applySnapshot(welcome.board)
        case .sync(let snapshot):
            applySnapshot(snapshot.board)
        case .cellSet(let event):
            applySequenced(event.seq) { applyCellSet(event) }
        case .gameCompleted(let event):
            applySequenced(event.seq) {
                status = .completed
                completedAt = event.at
                stats = event.stats
            }
        case .gameAbandoned(let event):
            applySequenced(event.seq) {
                status = .abandoned
                abandonedAt = event.at
            }
        case .error(let error):
            if error.fatal {
                // The connection is about to close (1008). Clear nothing by
                // commandId: the overlay must survive for the post-reconnect re-send
                // (PROTOCOL.md §7, §8; the fatal-error vector pins exactly this).
                sync = .reconnecting
                return
            }
            // A non-fatal error for a pending command clears its overlay entry so the
            // cell's true value is never masked (the immortal-overlay case, INV-10),
            // and the rejection is surfaced for the UI (§8).
            lastRejection = error
            if let commandId = error.commandId {
                removeOverlayEntry(commandId)
            }
        case .playerConnected(let notice):
            let joined = Participant(
                userId: notice.userId,
                displayName: notice.displayName,
                avatarUrl: notice.avatarUrl,
                color: notice.color,
                role: notice.role,
                connected: true)
            if let index = participants.firstIndex(where: { $0.userId == notice.userId }) {
                participants[index] = joined
            } else {
                participants.append(joined)
            }
        case .playerDisconnected(let notice):
            if let index = participants.firstIndex(where: { $0.userId == notice.userId }) {
                let present = participants[index]
                participants[index] = Participant(
                    userId: present.userId,
                    displayName: present.displayName,
                    avatarUrl: present.avatarUrl,
                    color: present.color,
                    role: present.role,
                    connected: false)
                cursors[notice.userId] = nil
            }
        case .cursor(let notice):
            cursors[notice.userId] = Cursor(
                userId: notice.userId, cell: notice.cell, direction: notice.direction)
        case .checkResult:
            // Check styling is M6 scope (root ROADMAP Phase 5); ignored here exactly
            // as the web store skeleton ignores it.
            return
        case .kicked(let notice):
            // Followed by close 1008; the transport surfaces the closure. Nothing to
            // reconcile in sequenced state (the notice carries no seq), so the store
            // hands the notice to the composition root's terminal flag and returns.
            onKicked?(notice)
            return
        }
    }

    /// The §7 ordering rules for sequenced events: apply iff seq is exactly
    /// lastApplied + 1; a gap sends requestSync and goes resyncing (events are
    /// ignored until the snapshot lands); a stale event is discarded.
    private func applySequenced(_ eventSeq: Int, _ apply: () -> Void) {
        if sync != .live { return }  // awaiting a snapshot; ignore events
        if eventSeq == seq + 1 {
            apply()
            seq = eventSeq
            return
        }
        if eventSeq > seq + 1 {
            sync = .resyncing
            emit(.requestSync(RequestSyncMessage()))
        }
        // eventSeq <= seq: stale, discard (PROTOCOL.md §7).
    }

    private func applyCellSet(_ event: CellSetMessage) {
        let renderedBefore = renderValue(event.cell)
        cells[event.cell] = Cell(v: event.value, by: event.by)
        // The first fill's cellSet carries firstFillAt, so the shared timer starts on
        // the delta instead of waiting for the next snapshot (PROTOCOL.md §6; D15).
        // Set-once: only the first fill's frame carries it, and a stale or redelivered
        // frame never reaches here (the §7 seq gate in applySequenced), so the origin
        // is set exactly once and never moves.
        if let origin = event.firstFillAt, firstFillAt == nil {
            firstFillAt = origin
        }
        // Your own echo clears its overlay entry (INV-10).
        removeOverlayEntry(event.commandId)
        // Conflict flash (PROTOCOL.md §8, D02): another user's event changed the value
        // you were rendering as non-null. Comparing the rendered composite before and
        // after means an event masked by a still-pending overlay entry never flashes,
        // and an erase of your letter always does.
        let renderedAfter = renderValue(event.cell)
        if event.by != selfUserId, renderedBefore != nil, renderedAfter != renderedBefore {
            onConflictFlash?(ConflictFlash(cell: event.cell, by: event.by))
        }
    }

    private func removeOverlayEntry(_ commandId: String) {
        if let index = overlay.firstIndex(where: { $0.commandId == commandId }) {
            overlay.remove(at: index)
        }
    }

    /// Snapshot reconciliation, identical for welcome, sync, and a crash-rollback
    /// snapshot (PROTOCOL.md §7, §8): replace all sequenced state (a lower seq is
    /// accepted and rolled back to, INV-5), then per still-pending command: confirmed
    /// by recentCommandIds drops; aged out drops without re-send; otherwise re-add
    /// and re-send (MUST, not MAY). Duplicates drop by commandId.
    private func applySnapshot(_ board: Board) {
        seq = board.seq
        status = board.status
        firstFillAt = board.firstFillAt
        completedAt = board.completedAt
        abandonedAt = board.abandonedAt
        stats = board.stats
        participants = board.participants
        cursors = Dictionary(
            board.cursors.map { ($0.userId, $0) },
            uniquingKeysWith: { _, last in last })
        cells = [:]
        for (index, cell) in board.cells.enumerated() where cell.v != nil || cell.by != nil {
            cells[index] = cell
        }

        let recent = Set(board.recentCommandIds)
        let pending = overlay
        overlay = []
        var seen: Set<String> = []
        for entry in pending {
            if seen.contains(entry.commandId) { continue }
            seen.insert(entry.commandId)
            if recent.contains(entry.commandId) { continue }  // confirmed inside the gap
            if entry.agedOut { continue }  // past the window K: drop, never re-send
            overlay.append(
                PendingCommand(commandId: entry.commandId, cell: entry.cell, value: entry.value))
            if let value = entry.value {
                emit(
                    .placeLetter(
                        PlaceLetterMessage(commandId: entry.commandId, cell: entry.cell, value: value)))
            } else {
                emit(.clearCell(ClearCellMessage(commandId: entry.commandId, cell: entry.cell)))
            }
        }
        sync = .live
    }

    // MARK: - The mailbox (AD-1) and the outbound pump

    /// The client-side mailbox: the ONE consumption loop over the transport's inbound
    /// stream (ARCHITECTURE.md §3). Every inbound frame is applied here on the main
    /// actor, and local intents are MainActor calls, so event application and intents
    /// interleave in one total order. A single pump child forwards emitted frames to
    /// the transport in FIFO order. Returns when the inbound stream finishes (the
    /// socket closed), after marking the store `reconnecting`; the session adapter
    /// then consults `nextReconnectDelaySeconds()`, sleeps, and dials (AD-6).
    public func run(_ transport: any Transport) async {
        let (wakeups, wake) = AsyncStream<Void>.makeStream()
        outboxWake = wake
        defer { outboxWake = nil }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.pumpOutbox(to: transport, wakeups: wakeups) }
            for await message in transport.inbound {
                receive(message)
            }
            // The inbound stream finishing IS the transport drop (see Ports.swift).
            connectionLost()
            wake.finish()
        }
    }

    /// The one sender: FIFO order holds because only this task drains.
    private func pumpOutbox(to transport: any Transport, wakeups: AsyncStream<Void>) async {
        await drainOutbox(to: transport)
        for await _ in wakeups {
            await drainOutbox(to: transport)
        }
    }

    private func drainOutbox(to transport: any Transport) async {
        while !outbox.isEmpty {
            let frame = outbox.removeFirst()
            await transport.send(frame)
        }
    }

    private func emit(_ frame: ClientMessage) {
        outbox.append(frame)
        outboxWake?.yield()
    }
}

extension String {
    /// ASCII-only A-Z to a-z over UTF-8 bytes, for UUID canonical form (INV-1: no
    /// locale-aware casing anywhere, even where the input is known-ASCII).
    fileprivate func asciiLowercasedUUID() -> String {
        String(
            decoding: utf8.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 },
            as: UTF8.self)
    }
}
