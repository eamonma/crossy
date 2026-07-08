// The game actor (DESIGN.md §3, §6): one per live game, the single writer for its state.
// Every mutation runs through the mailbox, so a game's state changes are serialized into
// one total order (INV-2) no matter how many sockets send concurrently. The actor owns
// the context gates it alone can enforce (role, terminal state via the reducer) and the
// completion driver, so completion is exactly-once and level-triggered (INV-3, INV-4).
// It holds the solution for the comparator; the solution never reaches an outbound frame
// (INV-6). Persistence is out of this slice: state lives in memory until Wave 2.2's
// write-behind flush.

import {
  applyWithCompletion,
  reduce,
  type BoardState,
  type Command,
  type RejectionCode,
} from "@crossy/engine";
import type {
  ClearCellMessage,
  PlaceLetterMessage,
  Role,
  ServerMessage,
  Stats,
} from "@crossy/protocol";
import { buildBoard, cellSetToWire, toEngineCommand } from "./adapt";
import { errorFrame } from "./frames";
import type { EngineSolution, HydratedGame } from "./hydrate";
import { Mailbox } from "./mailbox";

/** The last K applied commandIds kept for idempotency and the board payload (DESIGN.md §6). */
const RECENT_COMMAND_LIMIT = 64;

/** Human-readable text for each reducer rejection (PROTOCOL.md §11). */
const REJECTION_MESSAGE: Record<RejectionCode, string> = {
  GAME_NOT_ONGOING: "the game is no longer ongoing",
  INVALID_CELL: "cell is out of range or a black square",
  INVALID_VALUE: "value must match ^[A-Z0-9]{1,10}$ after normalization",
};

/** A live socket the actor can address. The concrete socket wrapper lives in server.ts. */
export interface Connection {
  readonly userId: string;
  readonly role: Role;
  send(frame: ServerMessage): void;
}

export class GameActor {
  private state: BoardState;
  private readonly solution: EngineSolution;
  private completedAt: string | null;
  private abandonedAt: string | null;
  private stats: Stats | null;
  private recentCommandIds: string[];
  private readonly connections = new Set<Connection>();
  private readonly mailbox = new Mailbox();

  constructor(
    hydrated: HydratedGame,
    private readonly now: () => Date,
  ) {
    this.state = hydrated.boardState;
    this.solution = hydrated.solution;
    this.completedAt = hydrated.completedAt;
    this.abandonedAt = hydrated.abandonedAt;
    this.recentCommandIds = [...hydrated.recentCommandIds];
    this.stats = null;
  }

  addConnection(connection: Connection): void {
    this.connections.add(connection);
  }

  removeConnection(connection: Connection): void {
    this.connections.delete(connection);
  }

  /** The userIds with a live connection, for the `connected` flag on participants. */
  connectedUserIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const c of this.connections) ids.add(c.userId);
    return ids;
  }

  /**
   * Enqueue a mutation on the mailbox. Every mutation for this game runs through this one
   * queue, so however many sockets send concurrently, the commands take one total order
   * and seq stays contiguous (INV-2). The returned promise settles when the command has
   * been applied and broadcast.
   */
  submit(
    connection: Connection,
    message: PlaceLetterMessage | ClearCellMessage,
  ): Promise<void> {
    return this.mailbox.post(() => {
      this.handleMutation(connection, message);
    });
  }

  /**
   * Apply one mutation. Runs inside the mailbox (see `submit`), so it is the single
   * writer of this game's state. Broadcasts one `cellSet` per accepted command, a
   * `gameCompleted` on the completing move (INV-3), and unicasts a §11 error on a
   * rejection.
   */
  private handleMutation(
    connection: Connection,
    message: PlaceLetterMessage | ClearCellMessage,
  ): void {
    // Role gate (DESIGN.md §3 step 2): spectators send nothing that mutates the board.
    if (connection.role === "spectator") {
      connection.send(
        errorFrame("ROLE_FORBIDDEN", "spectators cannot mutate the board", {
          commandId: message.commandId,
        }),
      );
      return;
    }

    // Idempotent commands (PROTOCOL.md §5, §6): a duplicate commandId is dropped
    // silently, no event and no error.
    if (this.recentCommandIds.includes(message.commandId)) return;

    const at = this.now().toISOString();
    const command = toEngineCommand(message, connection.userId, at);

    const result = applyWithCompletion(this.state, command, this.solution);

    // An accepted command always emits at least one cellSet, even a no-op (PROTOCOL.md
    // §6). Empty events therefore means a rejection; recover its code from the reducer.
    if (result.events.length === 0) {
      this.rejectCommand(connection, command, message.commandId);
      return;
    }

    this.state = result.state;
    this.recordCommandId(message.commandId);

    for (const event of result.events) {
      if (event.type === "cellSet") {
        this.broadcast(cellSetToWire(event));
        continue;
      }
      // gameCompleted: the engine emits {type, seq}; the actor stamps the server clock
      // and computes stats, then broadcasts (INV-3).
      this.completedAt = at;
      this.stats = this.computeStats(event.seq, at);
      this.broadcast({
        type: "gameCompleted",
        seq: event.seq,
        at,
        stats: this.stats,
      });
    }
  }

  /** Build the current board snapshot for `welcome`/`sync` (PROTOCOL.md §4). */
  snapshotBoard(
    participants: Parameters<typeof buildBoard>[1]["participants"],
  ): ReturnType<typeof buildBoard> {
    return buildBoard(this.state, {
      participants,
      completedAt: this.completedAt,
      abandonedAt: this.abandonedAt,
      stats: this.stats,
      recentCommandIds: this.recentCommandIds,
    });
  }

  private rejectCommand(
    connection: Connection,
    command: Command,
    commandId: string,
  ): void {
    const { error } = reduce(this.state, command);
    if (error === undefined) return; // unreachable: no events implies a rejection
    connection.send(errorFrame(error, REJECTION_MESSAGE[error], { commandId }));
  }

  private recordCommandId(commandId: string): void {
    this.recentCommandIds.push(commandId);
    if (this.recentCommandIds.length > RECENT_COMMAND_LIMIT) {
      this.recentCommandIds =
        this.recentCommandIds.slice(-RECENT_COMMAND_LIMIT);
    }
  }

  /**
   * Completion stats (PROTOCOL.md §4). solveTimeSeconds and totalEvents are exact.
   * participantCount is best-effort from the current board's distinct writers this
   * slice; the authoritative DISTINCT over cell_events lands with persistence in Wave
   * 2.2 (see the wave report).
   */
  private computeStats(terminalSeq: number, completedAt: string): Stats {
    const firstFill = this.state.firstFillAt;
    const solveTimeSeconds =
      firstFill === null
        ? 0
        : Math.max(
            0,
            Math.round(
              (Date.parse(completedAt) - Date.parse(firstFill)) / 1000,
            ),
          );
    const writers = new Set<string>();
    for (const cell of this.state.cells.values()) {
      if (cell.by !== null) writers.add(cell.by);
    }
    return {
      solveTimeSeconds,
      totalEvents: terminalSeq - 1,
      participantCount: writers.size,
    };
  }

  private broadcast(frame: ServerMessage): void {
    for (const connection of this.connections) connection.send(frame);
  }
}
