// Every wire message (PROTOCOL.md §§2, 5, 6). Types are hand-written and stand alone: no consumer
// needs a runtime schema library to use them. The codec (codec.ts) parses `unknown` frames into
// these shapes; unknown fields are ignored per §3.

import type { Board, Direction, Role, Stats } from "./board";
import type { ErrorCode } from "./errors";

// --- Client to server (PROTOCOL.md §2, §5) ---

/** First frame from the client (PROTOCOL.md §2). `protocolVersion` is negotiated, not fixed. */
export interface HelloMessage {
  readonly type: "hello";
  readonly protocolVersion: number;
  readonly token: string;
  /** Optional and informational; the server always replies with a full snapshot (§2). */
  readonly resumeFromSeq?: number;
}

/** Place a value in a cell (PROTOCOL.md §5). A board mutation carrying an idempotent commandId. */
export interface PlaceLetterMessage {
  readonly type: "placeLetter";
  readonly commandId: string;
  readonly cell: number;
  readonly value: string;
}

/** Clear a cell (PROTOCOL.md §5). Board mutation; the value becomes null. */
export interface ClearCellMessage {
  readonly type: "clearCell";
  readonly commandId: string;
  readonly cell: number;
}

/** Move this client's cursor (PROTOCOL.md §5). Ephemeral: no commandId, no seq. */
export interface MoveCursorMessage {
  readonly type: "moveCursor";
  readonly cell: number;
  readonly direction: Direction;
}

/**
 * React with an ephemeral emoji at a cell (PROTOCOL.md §5, §9). Role any, spectators included by
 * design. Ephemeral like moveCursor: no commandId, no seq. `emoji` is an exact grapheme from the
 * server's published reaction set and `cell` a grid index; the server drops any violation (an
 * unpublished emoji, a bad cell, over-rate) silently (§9). The wire carries the grapheme itself,
 * never a symbolic token, so the set MAY widen without a version bump; the codec checks shape only
 * (non-empty, at most 32 UTF-8 bytes), never set membership, which is session-service policy (§9).
 */
export interface ReactMessage {
  readonly type: "react";
  readonly emoji: string;
  readonly cell: number;
}

/**
 * Propose a room check (PROTOCOL.md §5, §10; D32). Legal for host or solver while the game is
 * ongoing, the grid is full, and no vote is already open; otherwise GAME_NOT_ONGOING,
 * GRID_NOT_FULL, or VOTE_PENDING (§11). Since D32 it no longer checks immediately: it opens an
 * attributed, timeboxed majority vote (one `checkVoteOpened`, §6), and a passing vote is the
 * accepted check. On a solo electorate the vote passes at open, so a `checkVoteClosed` and
 * `puzzleChecked` follow in the same command.
 */
export interface CheckPuzzleMessage {
  readonly type: "checkPuzzle";
  readonly commandId: string;
}

/**
 * Cast one immutable ballot on the open check vote (PROTOCOL.md §5, §10; D32). Legal for host or
 * solver; its gates in order are ROLE_FORBIDDEN, GAME_NOT_ONGOING, NO_VOTE_OPEN (no open vote, or a
 * stale `voteSeq` naming a closed one), NOT_ELECTOR (sender outside the frozen electorate), and
 * ALREADY_VOTED (the proposer approved at proposal time, and a ballot is one per elector). `voteSeq`
 * names the vote (its `checkVoteOpened` `seq`); `approve` is the direction. An accepted ballot
 * broadcasts one `checkVoteCast`, and may resolve the vote (a decisive close follows).
 */
export interface CastCheckVoteMessage {
  readonly type: "castCheckVote";
  readonly commandId: string;
  readonly voteSeq: number;
  readonly approve: boolean;
}

/** Liveness ping, every 15 s (PROTOCOL.md §5, §9). */
export interface HeartbeatMessage {
  readonly type: "heartbeat";
}

/** Ask the server for a fresh snapshot (PROTOCOL.md §5). The server replies with sync. */
export interface RequestSyncMessage {
  readonly type: "requestSync";
}

/** The discriminated union of every client-to-server message. */
export type ClientMessage =
  | HelloMessage
  | PlaceLetterMessage
  | ClearCellMessage
  | MoveCursorMessage
  | ReactMessage
  | CheckPuzzleMessage
  | CastCheckVoteMessage
  | HeartbeatMessage
  | RequestSyncMessage;

// --- Server to client: sequenced events (PROTOCOL.md §6) ---

/** Emitted for every accepted placeLetter or clearCell, including overwrites and no-ops (§6). */
export interface CellSetMessage {
  readonly type: "cellSet";
  readonly seq: number;
  readonly cell: number;
  /** A string, or null for a clear (PROTOCOL.md §6). */
  readonly value: string | null;
  readonly by: string;
  /** Echoes the originating command so the writer can clear its overlay (§6, §8). */
  readonly commandId: string;
  readonly at: string;
  /**
   * Present only on the single cellSet that establishes the first fill (§6), carrying the
   * timer origin so an already-connected client starts the shared timer on the delta rather
   * than waiting for a snapshot. Additive and optional (§14): an older client ignores it.
   */
  readonly firstFillAt?: string;
}

/** Exactly one per game on a full-and-correct board (PROTOCOL.md §6; INV-3). */
export interface GameCompletedMessage {
  readonly type: "gameCompleted";
  readonly seq: number;
  readonly at: string;
  readonly stats: Stats;
}

/** The game was abandoned by the host (PROTOCOL.md §6; INV-4). */
export interface GameAbandonedMessage {
  readonly type: "gameAbandoned";
  readonly seq: number;
  readonly at: string;
  readonly by: string;
}

/**
 * Emitted only as the immediate successor of a `checkVoteClosed` whose `outcome` is `passed`, and
 * broadcast to the whole room (PROTOCOL.md §6, §10; D32). `wrongCells` lists, ascending, every
 * playable cell failing the comparator at close time: indices only, never values or answers
 * (INV-6), and never empty (the §10 lifecycle keeps the board full and imperfect at any pass).
 * `checkCount` is the game's total accepted checks including this one, permanent and never reset.
 * `by` is the proposer, the same id `checkVoteOpened` carried: the check is a fully attributed room
 * act (D32 overturns D27's wire neutrality). It is optional on the type so a pre-vote producer still
 * typechecks; the session always sets it. `at` is stamped by the session adapter, like
 * `gameCompleted`'s.
 */
export interface PuzzleCheckedEvent {
  readonly type: "puzzleChecked";
  readonly seq: number;
  readonly wrongCells: readonly number[];
  readonly checkCount: number;
  readonly by?: string;
  readonly commandId: string;
  readonly at: string;
}

/**
 * Emitted for every accepted `checkPuzzle` and broadcast to the whole room (PROTOCOL.md §6, §10;
 * D32). It proposes an attributed, timeboxed vote rather than checking at once. `by` is the
 * proposer; `electorate` is the frozen ascending userId array of eligible voters, always including
 * `by`; `needed` = `floor(electorate.length / 2) + 1` is the strict majority; `expiresAt` is the
 * absolute ISO 8601 timeout, adapter-stamped from the server clock like `at`; `commandId` echoes
 * the proposal. On a solo electorate the vote passes at open (a `checkVoteClosed` and
 * `puzzleChecked` follow immediately, same command processing).
 */
export interface CheckVoteOpenedEvent {
  readonly type: "checkVoteOpened";
  readonly seq: number;
  readonly by: string;
  readonly electorate: readonly string[];
  readonly needed: number;
  readonly expiresAt: string;
  readonly commandId: string;
  readonly at: string;
}

/**
 * Emitted for every accepted `castCheckVote` and broadcast to the whole room (PROTOCOL.md §6, §10;
 * D32). `voteSeq` identifies the vote (its `checkVoteOpened` `seq`); `by` is the voter; `approve` is
 * the ballot; `commandId` echoes the ballot command; `at` is adapter-stamped.
 */
export interface CheckVoteCastEvent {
  readonly type: "checkVoteCast";
  readonly seq: number;
  readonly voteSeq: number;
  readonly by: string;
  readonly approve: boolean;
  readonly commandId: string;
  readonly at: string;
}

/** A vote's terminal outcome (PROTOCOL.md §6, §10; D32). */
export type CheckVoteOutcome = "passed" | "failed" | "cancelled";

/**
 * The close reason on a non-passing outcome (PROTOCOL.md §6, §10; D32); absent when `passed`.
 * `REJECTED` (majority unreachable) or `EXPIRED` (timebox) accompany `failed`; `GRID_BROKEN` (a
 * clear emptied a cell) or `TERMINAL` (a mutation completed or abandoned the game) accompany
 * `cancelled`.
 */
export type CheckVoteCloseReason =
  "REJECTED" | "EXPIRED" | "GRID_BROKEN" | "TERMINAL";

/**
 * Emitted once when a vote resolves and broadcast to the whole room (PROTOCOL.md §6, §10; D32).
 * `voteSeq` names the vote (its `checkVoteOpened` `seq`). `reason` is absent when `passed`. A
 * `passed` close is immediately followed by one `puzzleChecked` at the next `seq`; a `failed` or
 * `cancelled` close changes no marks or count. `at` is adapter-stamped. It carries no `commandId`:
 * a close is a server-driven resolution, not a command echo.
 */
export interface CheckVoteClosedEvent {
  readonly type: "checkVoteClosed";
  readonly seq: number;
  readonly voteSeq: number;
  readonly outcome: CheckVoteOutcome;
  readonly reason?: CheckVoteCloseReason;
  readonly at: string;
}

/** Events that mutate durable state and carry a per-game `seq` (PROTOCOL.md §6). */
export type SequencedEvent =
  | CellSetMessage
  | GameCompletedMessage
  | GameAbandonedMessage
  | PuzzleCheckedEvent
  | CheckVoteOpenedEvent
  | CheckVoteCastEvent
  | CheckVoteClosedEvent;

// --- Server to client: ephemeral notices (PROTOCOL.md §6) ---

/** Handshake success (PROTOCOL.md §2). Carries the caller's identity and the full board. */
export interface WelcomeMessage {
  readonly type: "welcome";
  readonly protocolVersion: number;
  readonly self: { readonly userId: string; readonly role: Role };
  readonly board: Board;
}

/** A full snapshot replacing all sequenced state (PROTOCOL.md §6, §7). */
export interface SyncMessage {
  readonly type: "sync";
  readonly board: Board;
}

/** A participant joined or reconnected (PROTOCOL.md §6). */
export interface PlayerConnectedMessage {
  readonly type: "playerConnected";
  readonly userId: string;
  readonly displayName: string;
  /** The same opaque nullable avatar URL the participant carries (PROTOCOL.md §4). */
  readonly avatarUrl: string | null;
  readonly color: string;
  readonly role: Role;
}

/** A participant went away (PROTOCOL.md §6, §9). */
export interface PlayerDisconnectedMessage {
  readonly type: "playerDisconnected";
  readonly userId: string;
}

/** Another participant's cursor moved (PROTOCOL.md §6). Best-effort, never sequenced (§9). */
export interface CursorMessage {
  readonly type: "cursor";
  readonly userId: string;
  readonly cell: number;
  readonly direction: Direction;
}

/**
 * Another participant reacted (PROTOCOL.md §6, §9). Relayed to the other connections on a valid
 * `react`, never echoed to the sender, the same fan-out as `cursor`. Even lighter than a cursor:
 * ephemeral, never sequenced, and never recorded, so it never appears in a welcome/sync snapshot
 * (there is no `board.reactions`). `emoji` is any well-formed grapheme; a receiver renders or
 * ignores it and MUST NOT reject one outside its own send set (receive-any, send-gated, §9).
 */
export interface ReactionNotice {
  readonly type: "reaction";
  readonly userId: string;
  readonly emoji: string;
  readonly cell: number;
}

/** The caller was removed (PROTOCOL.md §6). Followed by a 1008 close. */
export interface KickedMessage {
  readonly type: "kicked";
  readonly reason: string;
}

/** An error (PROTOCOL.md §6, §11). `commandId` is present when the offending command carried one. */
export interface ErrorMessage {
  readonly type: "error";
  readonly code: ErrorCode;
  readonly message: string;
  readonly fatal: boolean;
  readonly commandId?: string;
}

/** Server messages with no `seq` (PROTOCOL.md §6). */
export type EphemeralNotice =
  | WelcomeMessage
  | SyncMessage
  | PlayerConnectedMessage
  | PlayerDisconnectedMessage
  | CursorMessage
  | ReactionNotice
  | KickedMessage
  | ErrorMessage;

/** The discriminated union of every server-to-client message. */
export type ServerMessage = SequencedEvent | EphemeralNotice;
