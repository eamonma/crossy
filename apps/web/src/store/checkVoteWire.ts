// The check-vote wire shim (PROTOCOL.md §4, §6, §11; D32, merged as the contract in Wave 15.1).
//
// BRIDGE, NOT A FORK: Wave 15.1 landed the vote contract in PROTOCOL.md and the vectors, but the
// `@crossy/protocol` TypeScript package (its message types AND its codec) was not updated in the
// same PR, and this wave's scope is apps/web only. So the vote wire types and their decode live
// here, mirroring the contract byte for byte, and wrap the protocol codec instead of replacing it.
// When `@crossy/protocol` grows these types (a follow-up protocol PR), delete this module and read
// them from the package: the store already speaks these exact shapes.
//
// Everything here is INV-6 clean: a vote carries userIds, indices, counts, and timestamps, never a
// cell value or an answer.
import {
  decodeServerMessage,
  type Board,
  type Decoded,
  type PuzzleCheckedEvent,
  type ServerMessage,
  type SyncMessage,
  type WelcomeMessage,
  type ClientMessage,
  type ErrorCode,
} from "@crossy/protocol";

/**
 * The open check vote riding a snapshot (`board.checkVote`, PROTOCOL.md §4). `null` when none is
 * open. `openedSeq` is the `seq` of the vote's `checkVoteOpened` (the `voteSeq` a ballot names);
 * `approvals` starts as `[by]` because the proposal is the proposer's approval; `needed` is the
 * strict majority the server computed (`floor(electorate.length / 2) + 1`), carried so no client
 * reimplements the arithmetic; `expiresAt` is the absolute ISO 8601 timeout. Every userId array is
 * ascending ASCII byte order (INV-1).
 */
export interface OpenCheckVote {
  readonly openedSeq: number;
  readonly by: string;
  readonly electorate: readonly string[];
  readonly approvals: readonly string[];
  readonly rejections: readonly string[];
  readonly needed: number;
  readonly expiresAt: string;
}

/** Proposes a check: an attributed, timeboxed room vote (PROTOCOL.md §6). Sequenced. */
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

/** One immutable ballot on the open vote (PROTOCOL.md §6). Sequenced. The proposer never casts one. */
export interface CheckVoteCastEvent {
  readonly type: "checkVoteCast";
  readonly seq: number;
  readonly voteSeq: number;
  readonly by: string;
  readonly approve: boolean;
  readonly commandId: string;
  readonly at: string;
}

export type CheckVoteOutcome = "passed" | "failed" | "cancelled";
/** `reason` is absent when passed (PROTOCOL.md §6, §10). */
export type CheckVoteReason =
  "REJECTED" | "EXPIRED" | "GRID_BROKEN" | "TERMINAL";

/** Emitted once when a vote resolves (PROTOCOL.md §6). Sequenced. A passed close is followed by one
 * `puzzleChecked` at the next seq; a failed/cancelled close changes no marks or count. */
export interface CheckVoteClosedEvent {
  readonly type: "checkVoteClosed";
  readonly seq: number;
  readonly voteSeq: number;
  readonly outcome: CheckVoteOutcome;
  readonly reason?: CheckVoteReason;
  readonly at: string;
}

/** `puzzleChecked` with the D32 attribution (`by`, the proposer). Optional so a bare frame from an
 * older server (the rollout window) still parses (PROTOCOL.md §6). */
export type WebPuzzleCheckedEvent = PuzzleCheckedEvent & {
  readonly by?: string;
};

/** Casts one ballot on the open check vote (PROTOCOL.md §5). */
export interface CastCheckVoteMessage {
  readonly type: "castCheckVote";
  readonly commandId: string;
  readonly voteSeq: number;
  readonly approve: boolean;
}

/** The four non-fatal vote errors (PROTOCOL.md §5, §11). */
export type CheckVoteErrorCode =
  "VOTE_PENDING" | "NO_VOTE_OPEN" | "NOT_ELECTOR" | "ALREADY_VOTED";

const VOTE_ERROR_CODES: ReadonlySet<string> = new Set([
  "VOTE_PENDING",
  "NO_VOTE_OPEN",
  "NOT_ELECTOR",
  "ALREADY_VOTED",
]);

export function isCheckVoteErrorCode(code: string): code is CheckVoteErrorCode {
  return VOTE_ERROR_CODES.has(code);
}

/** An error frame whose code may be one of the vote codes the base `ErrorCode` does not yet list. */
export interface WebErrorMessage {
  readonly type: "error";
  readonly code: ErrorCode | CheckVoteErrorCode;
  readonly message: string;
  readonly fatal: boolean;
  readonly commandId?: string;
}

/** The board payload with its open vote attached (PROTOCOL.md §4). `checkVote` is optional in the
 * type only so pre-vote snapshots and existing test fixtures still satisfy it; the wire always
 * carries it since Wave 15.1. */
export type WebBoard = Board & { readonly checkVote?: OpenCheckVote | null };
type WebWelcomeMessage = Omit<WelcomeMessage, "board"> & { board: WebBoard };
type WebSyncMessage = Omit<SyncMessage, "board"> & { board: WebBoard };

/** Every server-to-client frame the web store understands: the base protocol union with the
 * vote-aware welcome/sync/puzzleChecked/error variants swapped in and the three vote events added. */
export type WebServerMessage =
  | Exclude<
      ServerMessage,
      WelcomeMessage | SyncMessage | PuzzleCheckedEvent | { type: "error" }
    >
  | WebWelcomeMessage
  | WebSyncMessage
  | WebPuzzleCheckedEvent
  | WebErrorMessage
  | CheckVoteOpenedEvent
  | CheckVoteCastEvent
  | CheckVoteClosedEvent;

/** Every client-to-server frame the web store sends: the base union plus the ballot. */
export type WebClientMessage = ClientMessage | CastCheckVoteMessage;

// --- Minimal, local parsing (the codec's discipline, scoped to the vote shapes) ---

class ParseFail extends Error {}
function obj(x: unknown): Record<string, unknown> {
  if (typeof x !== "object" || x === null) throw new ParseFail("not an object");
  return x as Record<string, unknown>;
}
function str(x: unknown): string {
  if (typeof x !== "string") throw new ParseFail("not a string");
  return x;
}
function int(x: unknown): number {
  if (typeof x !== "number" || !Number.isInteger(x))
    throw new ParseFail("not an integer");
  return x;
}
function bool(x: unknown): boolean {
  if (typeof x !== "boolean") throw new ParseFail("not a boolean");
  return x;
}
function strArray(x: unknown): string[] {
  if (!Array.isArray(x)) throw new ParseFail("not an array");
  return x.map(str);
}

/** Parse `board.checkVote` off a raw snapshot: the object, or `null` when none is open or the value
 * is malformed (tolerant: a bad vote never sinks an otherwise good snapshot). */
export function readOpenCheckVote(raw: unknown): OpenCheckVote | null {
  if (raw === null || raw === undefined) return null;
  try {
    const o = obj(raw);
    return {
      openedSeq: int(o.openedSeq),
      by: str(o.by),
      electorate: strArray(o.electorate),
      approvals: strArray(o.approvals),
      rejections: strArray(o.rejections),
      needed: int(o.needed),
      expiresAt: str(o.expiresAt),
    };
  } catch {
    return null;
  }
}

function malformed(detail: string): Decoded<WebServerMessage> {
  return { ok: false, error: { kind: "malformed", detail } };
}

function decodeCheckVoteOpened(
  o: Record<string, unknown>,
): Decoded<WebServerMessage> {
  try {
    return {
      ok: true,
      value: {
        type: "checkVoteOpened",
        seq: int(o.seq),
        by: str(o.by),
        electorate: strArray(o.electorate),
        needed: int(o.needed),
        expiresAt: str(o.expiresAt),
        commandId: str(o.commandId),
        at: str(o.at),
      },
    };
  } catch (e) {
    return malformed(`checkVoteOpened: ${(e as Error).message}`);
  }
}

function decodeCheckVoteCast(
  o: Record<string, unknown>,
): Decoded<WebServerMessage> {
  try {
    return {
      ok: true,
      value: {
        type: "checkVoteCast",
        seq: int(o.seq),
        voteSeq: int(o.voteSeq),
        by: str(o.by),
        approve: bool(o.approve),
        commandId: str(o.commandId),
        at: str(o.at),
      },
    };
  } catch (e) {
    return malformed(`checkVoteCast: ${(e as Error).message}`);
  }
}

function decodeCheckVoteClosed(
  o: Record<string, unknown>,
): Decoded<WebServerMessage> {
  try {
    const outcome = str(o.outcome);
    if (
      outcome !== "passed" &&
      outcome !== "failed" &&
      outcome !== "cancelled"
    ) {
      return malformed(`checkVoteClosed: bad outcome "${outcome}"`);
    }
    const base: CheckVoteClosedEvent = {
      type: "checkVoteClosed",
      seq: int(o.seq),
      voteSeq: int(o.voteSeq),
      outcome,
      at: str(o.at),
    };
    return {
      ok: true,
      value:
        o.reason === undefined
          ? base
          : { ...base, reason: str(o.reason) as CheckVoteReason },
    };
  } catch (e) {
    return malformed(`checkVoteClosed: ${(e as Error).message}`);
  }
}

/**
 * Decode a server frame into a `WebServerMessage`: the three vote events and vote-coded errors are
 * decoded here (the base codec rejects them as unknown/malformed), snapshots gain `board.checkVote`,
 * `puzzleChecked` gains `by`, and everything else passes straight through the protocol codec so its
 * behavior is untouched. This is the ONLY inbound path change the vote needed on web.
 */
export function decodeWebServerMessage(
  raw: unknown,
): Decoded<WebServerMessage> {
  const type =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>).type
      : undefined;

  if (type === "checkVoteOpened")
    return decodeCheckVoteOpened(raw as Record<string, unknown>);
  if (type === "checkVoteCast")
    return decodeCheckVoteCast(raw as Record<string, unknown>);
  if (type === "checkVoteClosed")
    return decodeCheckVoteClosed(raw as Record<string, unknown>);

  if (type === "error") {
    const code = (raw as Record<string, unknown>).code;
    if (typeof code === "string" && isCheckVoteErrorCode(code)) {
      try {
        const o = raw as Record<string, unknown>;
        const base: WebErrorMessage = {
          type: "error",
          code,
          message: str(o.message),
          fatal: bool(o.fatal),
        };
        return {
          ok: true,
          value:
            o.commandId === undefined
              ? base
              : { ...base, commandId: str(o.commandId) },
        };
      } catch (e) {
        return malformed(`error: ${(e as Error).message}`);
      }
    }
  }

  const base = decodeServerMessage(raw);
  if (!base.ok) return base;

  if (base.value.type === "welcome" || base.value.type === "sync") {
    const rawBoard = (raw as Record<string, unknown>).board as
      Record<string, unknown> | undefined;
    const checkVote = readOpenCheckVote(rawBoard?.checkVote);
    return {
      ok: true,
      value: {
        ...base.value,
        board: { ...base.value.board, checkVote },
      },
    };
  }

  if (base.value.type === "puzzleChecked") {
    const rawBy = (raw as Record<string, unknown>).by;
    return {
      ok: true,
      value:
        typeof rawBy === "string" ? { ...base.value, by: rawBy } : base.value,
    };
  }

  return base as Decoded<WebServerMessage>;
}
