// The wire codec (PROTOCOL.md §2 framing; DESIGN.md §4 "WebSocket codec per PROTOCOL.md"). One
// JSON object per text frame. Decoders are hand-rolled type guards: no schema library, so the
// exported types stand alone and the validation logic mirrors 1:1 into the Swift port (Codable
// plus manual checks) rather than relying on TS-only schema magic. See the Wave 1.1a report.
//
// Posture (PROTOCOL.md §3, §14): unknown fields are ignored, so decoders copy only known fields
// into a fresh object. Required fields are validated structurally. Semantic checks that need
// game geometry (INVALID_CELL range, black squares) or the solution (comparator) belong to the
// server, not here; isValidValue (values.ts) is provided for the INVALID_VALUE mapping. Version
// negotiation is business logic: a hello with any integer protocolVersion decodes cleanly, and
// the server maps an unsupported one to PROTOCOL_VERSION_UNSUPPORTED.

import type {
  Board,
  Cell,
  Cursor,
  Direction,
  GameStatus,
  Participant,
  Role,
  Stats,
} from "./board";
import { ERROR_CODES } from "./errors";
import type { ErrorCode } from "./errors";
import type {
  CellSetMessage,
  CheckPuzzleMessage,
  ClearCellMessage,
  ClientMessage,
  CursorMessage,
  ErrorMessage,
  GameAbandonedMessage,
  GameCompletedMessage,
  HelloMessage,
  KickedMessage,
  MoveCursorMessage,
  PlaceLetterMessage,
  PlayerConnectedMessage,
  PlayerDisconnectedMessage,
  PuzzleCheckedEvent,
  ReactionNotice,
  ReactMessage,
  ServerMessage,
  SyncMessage,
  WelcomeMessage,
} from "./messages";

/** Why a frame did not decode. `unknown_type` is a valid string type the peer does not know. */
export interface DecodeError {
  readonly kind: "malformed" | "unknown_type";
  readonly type?: string;
  readonly detail: string;
}

/** The result of decoding one frame. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DecodeError };

/** Internal control-flow signal for a structural failure, caught at the decode entry points. */
class DecodeFail extends Error {}

function fail(detail: string): never {
  throw new DecodeFail(detail);
}

function asObject(x: unknown, what: string): Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    fail(`${what}: object required`);
  }
  return x as Record<string, unknown>;
}

function asString(x: unknown, what: string): string {
  if (typeof x !== "string") fail(`${what}: string required`);
  return x;
}

function asInt(x: unknown, what: string): number {
  if (typeof x !== "number" || !Number.isInteger(x)) {
    fail(`${what}: integer required`);
  }
  return x;
}

function asBoolean(x: unknown, what: string): boolean {
  if (typeof x !== "boolean") fail(`${what}: boolean required`);
  return x;
}

function asNullableString(x: unknown, what: string): string | null {
  return x === null ? null : asString(x, what);
}

function asStringArray(x: unknown, what: string): string[] {
  if (!Array.isArray(x)) fail(`${what}: array required`);
  return x.map((el, i) => asString(el, `${what}[${i}]`));
}

function asIntArray(x: unknown, what: string): number[] {
  if (!Array.isArray(x)) fail(`${what}: array required`);
  return x.map((el, i) => asInt(el, `${what}[${i}]`));
}

// Cell-index arrays (checkedWrongCells, wrongCells) are non-negative by construction
// (PROTOCOL.md §3 cell indexing); ascending order is a producer rule, not re-checked here,
// matching the posture that geometry-dependent semantics belong to the server.
function asNonNegativeIntArray(x: unknown, what: string): number[] {
  return asIntArray(x, what).map((el, i) => {
    if (el < 0) fail(`${what}[${i}]: non-negative integer required`);
    return el;
  });
}

function asDirection(x: unknown, what: string): Direction {
  const s = asString(x, what);
  if (s !== "across" && s !== "down") {
    fail(`${what}: "across" or "down" required`);
  }
  return s;
}

function asRole(x: unknown, what: string): Role {
  const s = asString(x, what);
  if (s !== "host" && s !== "solver" && s !== "spectator") {
    fail(`${what}: "host", "solver", or "spectator" required`);
  }
  return s;
}

function asStatus(x: unknown, what: string): GameStatus {
  const s = asString(x, what);
  if (s !== "ongoing" && s !== "completed" && s !== "abandoned") {
    fail(`${what}: "ongoing", "completed", or "abandoned" required`);
  }
  return s;
}

function asErrorCode(x: unknown, what: string): ErrorCode {
  const s = asString(x, what);
  if (!Object.prototype.hasOwnProperty.call(ERROR_CODES, s)) {
    fail(`${what}: unknown error code "${s}"`);
  }
  return s as ErrorCode;
}

// UTF-8 byte length, computed without a platform encoder so the package stays dependency-free (no
// TextEncoder or Buffer) and the Swift port mirrors it as `String.utf8.count`. `for...of` iterates
// whole code points, so surrogate pairs count once as their 4-byte form.
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x7f) bytes += 1;
    else if (cp <= 0x7ff) bytes += 2;
    else if (cp <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

// Reaction emoji shape check (PROTOCOL.md §9): a non-empty string of at most 32 UTF-8 bytes. Shape
// only. The codec never checks set membership, so an emoji outside the v1 set still decodes
// (receive-any, §9); the published set is session-service policy and MAY widen without a version
// bump (§14), so encoding it here would wrongly reject a future reaction from a newer server.
function asEmoji(x: unknown, what: string): string {
  const s = asString(x, what);
  if (s.length === 0) fail(`${what}: non-empty string required`);
  if (utf8ByteLength(s) > 32) fail(`${what}: at most 32 UTF-8 bytes required`);
  return s;
}

function decodeCell(x: unknown, what: string): Cell {
  const o = asObject(x, what);
  return {
    v: asNullableString(o.v, `${what}.v`),
    by: asNullableString(o.by, `${what}.by`),
  };
}

function decodeParticipant(x: unknown, what: string): Participant {
  const o = asObject(x, what);
  return {
    userId: asString(o.userId, `${what}.userId`),
    displayName: asString(o.displayName, `${what}.displayName`),
    avatarUrl: asNullableString(o.avatarUrl, `${what}.avatarUrl`),
    color: asString(o.color, `${what}.color`),
    role: asRole(o.role, `${what}.role`),
    connected: asBoolean(o.connected, `${what}.connected`),
  };
}

function decodeCursor(x: unknown, what: string): Cursor {
  const o = asObject(x, what);
  return {
    userId: asString(o.userId, `${what}.userId`),
    cell: asInt(o.cell, `${what}.cell`),
    direction: asDirection(o.direction, `${what}.direction`),
  };
}

function decodeStats(x: unknown, what: string): Stats {
  const o = asObject(x, what);
  return {
    solveTimeSeconds: asInt(o.solveTimeSeconds, `${what}.solveTimeSeconds`),
    totalEvents: asInt(o.totalEvents, `${what}.totalEvents`),
    participantCount: asInt(o.participantCount, `${what}.participantCount`),
    checkCount: asInt(o.checkCount, `${what}.checkCount`),
    // Additive (PROTOCOL.md §4, D29): stats frozen before sittings shipped lack these and are
    // never backfilled, so absence decodes clean and the key is simply omitted.
    ...(o.activeSolveSeconds !== undefined && {
      activeSolveSeconds: asInt(
        o.activeSolveSeconds,
        `${what}.activeSolveSeconds`,
      ),
    }),
    ...(o.sittingCount !== undefined && {
      sittingCount: asInt(o.sittingCount, `${what}.sittingCount`),
    }),
  };
}

/** Decode a board payload (PROTOCOL.md §4), used by welcome and sync and exported for the API. */
export function decodeBoard(x: unknown): Decoded<Board> {
  try {
    return { ok: true, value: decodeBoardOrThrow(x, "board") };
  } catch (e) {
    if (e instanceof DecodeFail) {
      return { ok: false, error: { kind: "malformed", detail: e.message } };
    }
    throw e;
  }
}

function decodeBoardOrThrow(x: unknown, what: string): Board {
  const o = asObject(x, what);
  if (!Array.isArray(o.cells)) fail(`${what}.cells: array required`);
  if (!Array.isArray(o.participants)) {
    fail(`${what}.participants: array required`);
  }
  if (!Array.isArray(o.cursors)) fail(`${what}.cursors: array required`);
  return {
    seq: asInt(o.seq, `${what}.seq`),
    status: asStatus(o.status, `${what}.status`),
    firstFillAt: asNullableString(o.firstFillAt, `${what}.firstFillAt`),
    completedAt: asNullableString(o.completedAt, `${what}.completedAt`),
    abandonedAt: asNullableString(o.abandonedAt, `${what}.abandonedAt`),
    cells: o.cells.map((c, i) => decodeCell(c, `${what}.cells[${i}]`)),
    checkedWrongCells: asNonNegativeIntArray(
      o.checkedWrongCells,
      `${what}.checkedWrongCells`,
    ),
    checkCount: asInt(o.checkCount, `${what}.checkCount`),
    participants: o.participants.map((p, i) =>
      decodeParticipant(p, `${what}.participants[${i}]`),
    ),
    cursors: o.cursors.map((c, i) => decodeCursor(c, `${what}.cursors[${i}]`)),
    recentCommandIds: asStringArray(
      o.recentCommandIds,
      `${what}.recentCommandIds`,
    ),
    stats: o.stats === null ? null : decodeStats(o.stats, `${what}.stats`),
  };
}

// --- Client to server ---

function decodeHello(o: Record<string, unknown>): HelloMessage {
  const base = {
    type: "hello" as const,
    protocolVersion: asInt(o.protocolVersion, "protocolVersion"),
    token: asString(o.token, "token"),
  };
  return o.resumeFromSeq === undefined
    ? base
    : { ...base, resumeFromSeq: asInt(o.resumeFromSeq, "resumeFromSeq") };
}

function decodePlaceLetter(o: Record<string, unknown>): PlaceLetterMessage {
  return {
    type: "placeLetter",
    commandId: asString(o.commandId, "commandId"),
    cell: asInt(o.cell, "cell"),
    value: asString(o.value, "value"),
  };
}

function decodeClearCell(o: Record<string, unknown>): ClearCellMessage {
  return {
    type: "clearCell",
    commandId: asString(o.commandId, "commandId"),
    cell: asInt(o.cell, "cell"),
  };
}

function decodeMoveCursor(o: Record<string, unknown>): MoveCursorMessage {
  return {
    type: "moveCursor",
    cell: asInt(o.cell, "cell"),
    direction: asDirection(o.direction, "direction"),
  };
}

function decodeReact(o: Record<string, unknown>): ReactMessage {
  return {
    type: "react",
    emoji: asEmoji(o.emoji, "emoji"),
    cell: asInt(o.cell, "cell"),
  };
}

function decodeCheckPuzzle(o: Record<string, unknown>): CheckPuzzleMessage {
  return {
    type: "checkPuzzle",
    commandId: asString(o.commandId, "commandId"),
  };
}

/**
 * Decode a client-to-server frame (PROTOCOL.md §5). An unrecognized `type` yields
 * `kind: "unknown_type"`, which the server maps to UNKNOWN_TYPE (§5). A structural problem yields
 * `kind: "malformed"`.
 */
export function decodeClientMessage(raw: unknown): Decoded<ClientMessage> {
  try {
    const o = asObject(raw, "message");
    const type = asString(o.type, "type");
    switch (type) {
      case "hello":
        return { ok: true, value: decodeHello(o) };
      case "placeLetter":
        return { ok: true, value: decodePlaceLetter(o) };
      case "clearCell":
        return { ok: true, value: decodeClearCell(o) };
      case "moveCursor":
        return { ok: true, value: decodeMoveCursor(o) };
      case "react":
        return { ok: true, value: decodeReact(o) };
      case "checkPuzzle":
        return { ok: true, value: decodeCheckPuzzle(o) };
      case "heartbeat":
        return { ok: true, value: { type: "heartbeat" } };
      case "requestSync":
        return { ok: true, value: { type: "requestSync" } };
      default:
        return {
          ok: false,
          error: {
            kind: "unknown_type",
            type,
            detail: `unknown client message type "${type}"`,
          },
        };
    }
  } catch (e) {
    if (e instanceof DecodeFail) {
      return { ok: false, error: { kind: "malformed", detail: e.message } };
    }
    throw e;
  }
}

// --- Server to client ---

function decodeWelcome(o: Record<string, unknown>): WelcomeMessage {
  const self = asObject(o.self, "self");
  return {
    type: "welcome",
    protocolVersion: asInt(o.protocolVersion, "protocolVersion"),
    self: {
      userId: asString(self.userId, "self.userId"),
      role: asRole(self.role, "self.role"),
    },
    board: decodeBoardOrThrow(o.board, "board"),
  };
}

function decodeSync(o: Record<string, unknown>): SyncMessage {
  return { type: "sync", board: decodeBoardOrThrow(o.board, "board") };
}

function decodeCellSet(o: Record<string, unknown>): CellSetMessage {
  const base = {
    type: "cellSet" as const,
    seq: asInt(o.seq, "seq"),
    cell: asInt(o.cell, "cell"),
    value: asNullableString(o.value, "value"),
    by: asString(o.by, "by"),
    commandId: asString(o.commandId, "commandId"),
    at: asString(o.at, "at"),
  };
  // firstFillAt rides only the first-fill cellSet (PROTOCOL.md §6); absent on every other.
  // Additive and optional (§3, §14): copy it when present, leave the field off otherwise.
  return o.firstFillAt === undefined
    ? base
    : { ...base, firstFillAt: asString(o.firstFillAt, "firstFillAt") };
}

function decodeGameCompleted(o: Record<string, unknown>): GameCompletedMessage {
  return {
    type: "gameCompleted",
    seq: asInt(o.seq, "seq"),
    at: asString(o.at, "at"),
    stats: decodeStats(o.stats, "stats"),
  };
}

function decodeGameAbandoned(o: Record<string, unknown>): GameAbandonedMessage {
  return {
    type: "gameAbandoned",
    seq: asInt(o.seq, "seq"),
    at: asString(o.at, "at"),
    by: asString(o.by, "by"),
  };
}

function decodePlayerConnected(
  o: Record<string, unknown>,
): PlayerConnectedMessage {
  return {
    type: "playerConnected",
    userId: asString(o.userId, "userId"),
    displayName: asString(o.displayName, "displayName"),
    avatarUrl: asNullableString(o.avatarUrl, "avatarUrl"),
    color: asString(o.color, "color"),
    role: asRole(o.role, "role"),
  };
}

function decodePlayerDisconnected(
  o: Record<string, unknown>,
): PlayerDisconnectedMessage {
  return {
    type: "playerDisconnected",
    userId: asString(o.userId, "userId"),
  };
}

function decodeCursorMessage(o: Record<string, unknown>): CursorMessage {
  return {
    type: "cursor",
    userId: asString(o.userId, "userId"),
    cell: asInt(o.cell, "cell"),
    direction: asDirection(o.direction, "direction"),
  };
}

function decodeReaction(o: Record<string, unknown>): ReactionNotice {
  return {
    type: "reaction",
    userId: asString(o.userId, "userId"),
    emoji: asEmoji(o.emoji, "emoji"),
    cell: asInt(o.cell, "cell"),
  };
}

function decodePuzzleChecked(o: Record<string, unknown>): PuzzleCheckedEvent {
  return {
    type: "puzzleChecked",
    seq: asInt(o.seq, "seq"),
    wrongCells: asNonNegativeIntArray(o.wrongCells, "wrongCells"),
    checkCount: asInt(o.checkCount, "checkCount"),
    commandId: asString(o.commandId, "commandId"),
    at: asString(o.at, "at"),
  };
}

function decodeKicked(o: Record<string, unknown>): KickedMessage {
  return { type: "kicked", reason: asString(o.reason, "reason") };
}

function decodeErrorMessage(o: Record<string, unknown>): ErrorMessage {
  const base = {
    type: "error" as const,
    code: asErrorCode(o.code, "code"),
    message: asString(o.message, "message"),
    fatal: asBoolean(o.fatal, "fatal"),
  };
  return o.commandId === undefined
    ? base
    : { ...base, commandId: asString(o.commandId, "commandId") };
}

/**
 * Decode a server-to-client frame (PROTOCOL.md §6). An unrecognized `type` yields
 * `kind: "unknown_type"`, which the client ignores and logs (§3). A structural problem yields
 * `kind: "malformed"`.
 */
export function decodeServerMessage(raw: unknown): Decoded<ServerMessage> {
  try {
    const o = asObject(raw, "message");
    const type = asString(o.type, "type");
    switch (type) {
      case "welcome":
        return { ok: true, value: decodeWelcome(o) };
      case "sync":
        return { ok: true, value: decodeSync(o) };
      case "cellSet":
        return { ok: true, value: decodeCellSet(o) };
      case "gameCompleted":
        return { ok: true, value: decodeGameCompleted(o) };
      case "gameAbandoned":
        return { ok: true, value: decodeGameAbandoned(o) };
      case "puzzleChecked":
        return { ok: true, value: decodePuzzleChecked(o) };
      case "playerConnected":
        return { ok: true, value: decodePlayerConnected(o) };
      case "playerDisconnected":
        return { ok: true, value: decodePlayerDisconnected(o) };
      case "cursor":
        return { ok: true, value: decodeCursorMessage(o) };
      case "reaction":
        return { ok: true, value: decodeReaction(o) };
      case "kicked":
        return { ok: true, value: decodeKicked(o) };
      case "error":
        return { ok: true, value: decodeErrorMessage(o) };
      default:
        return {
          ok: false,
          error: {
            kind: "unknown_type",
            type,
            detail: `unknown server message type "${type}"`,
          },
        };
    }
  } catch (e) {
    if (e instanceof DecodeFail) {
      return { ok: false, error: { kind: "malformed", detail: e.message } };
    }
    throw e;
  }
}

/** Serialize a message to a wire frame (PROTOCOL.md §2: one JSON object per text frame). */
export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
