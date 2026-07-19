// Session service integration tests (Wave 2.1c). Real `ws` client sockets drive the
// real server on an ephemeral port, the in-memory auth fake mints real ES256 tokens, and
// a Testcontainers Postgres backs the hydrate reads. Zero external network.
//
// No silent skips (repo rule, mirrored from packages/db): the container start is
// required. If Docker is unreachable the suite FAILS with a clear message rather than
// skipping, because a skipped infra test reads as a passing one.
//
// The four invariants this file defends, named so coverage is greppable:
//   INV-2  contiguous seq under concurrent senders through one mailbox
//   INV-3  exactly one gameCompleted with two racers
//   INV-4  mutations after a terminal state rejected GAME_NOT_ONGOING
//   INV-6  no solution field in any outbound frame (the welcome board)

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { WebSocket } from "ws";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@crossy/db";
import { createFakeAuthProvider } from "@crossy/auth";
import type { FakeAuthProvider } from "@crossy/auth";
import {
  decodeServerMessage,
  LIVE_ACTIVITY_MAX_AGE_MS,
  type Role,
  type ServerMessage,
  type SyncMessage,
} from "@crossy/protocol";
import type { CellSet } from "@crossy/engine";
import { createSessionServer } from "./server";
import type { SessionServer } from "./server";
import type { Analytics, AnalyticsEvent } from "./analytics/analytics";
import { createInertEmitter } from "./push/emitter";
import type { ActivityPushEmitter, BoardFacts } from "./push/emitter";
import { flushToPostgres, SnapshotRegressionError } from "./writer";
import type { StateSnapshot } from "./writer";
import { hydrateGame } from "./hydrate";
import { loadGameRow, loadGameState } from "./repo";
import { loadLiveTokens } from "./push/tokens";

const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;

// The static internal bearer the shared server verifies (DESIGN.md §6). Injected via config
// here exactly as the composition root injects INTERNAL_BEARER_TOKEN; never hardcoded in src.
const INTERNAL_BEARER = "test-internal-bearer-secret";

// 8-char invite codes from the unambiguous alphabet [2-9A-HJ-NP-Z] (games CHECK).
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
let codeCounter = 1;
function nextInviteCode(): string {
  let n = codeCounter++;
  let code = "";
  for (let i = 0; i < 8; i++) {
    code = CODE_ALPHABET[n % 32] + code;
    n = Math.floor(n / 32);
  }
  return code;
}

let container: StartedPostgreSqlContainer;
// The server runs as the least-privilege crossy_session role (the migration grants),
// exactly as the api suite runs as crossy_api: the grants are exercised for real, so a
// flush that strayed outside game_state/cell_events would fail at the grant layer (INV-7).
// A separate superuser pool seeds api-owned fixtures the session role cannot write.
let sessionPool: Pool;
let adminPool: Pool;
let auth: FakeAuthProvider;
let server: SessionServer;

interface RawCell {
  v: string | null;
  by: string | null;
}

interface PuzzleSnapshot {
  rows: number;
  cols: number;
  blocks: number[];
  circles: number[];
  clues: { across: []; down: [] };
  solution: (string | null)[];
}

/** A minimal ServerPuzzle snapshot; solution strings are server-only (INV-6). */
function puzzle(
  rows: number,
  cols: number,
  blocks: number[],
  solution: (string | null)[],
): PuzzleSnapshot {
  return {
    rows,
    cols,
    blocks,
    circles: [],
    clues: { across: [], down: [] },
    solution,
  };
}

async function insertUser(
  userId: string,
  displayName: string,
  avatar: string | null = null,
): Promise<void> {
  await adminPool.query(
    "insert into users (user_id, display_name, avatar) values ($1, $2, $3)",
    [userId, displayName, avatar],
  );
}

interface GameSpec {
  readonly snapshot: PuzzleSnapshot;
  readonly members: ReadonlyArray<{
    userId: string;
    role: Role;
    /** Optional resolved avatar URL to seed on the member's users row (PROTOCOL.md §4). */
    avatar?: string | null;
  }>;
  readonly denylist?: readonly string[];
  readonly gameState?: {
    board: RawCell[];
    lastSeq: number;
    firstFillAt: string | null;
    status?: "ongoing" | "completed" | "abandoned";
  };
}

/** Seed a game and its dependencies; returns the new gameId. */
async function seedGame(spec: GameSpec): Promise<string> {
  const gameId = randomUUID();
  const puzzleId = randomUUID();
  const hostId = randomUUID();
  await insertUser(hostId, "Host");
  await adminPool.query(
    "insert into puzzles (puzzle_id, data) values ($1, $2::jsonb)",
    [puzzleId, JSON.stringify({ kind: "test" })],
  );
  await adminPool.query(
    `insert into games (game_id, puzzle_id, puzzle_snapshot, invite_code, created_by)
     values ($1, $2, $3::jsonb, $4, $5)`,
    [gameId, puzzleId, JSON.stringify(spec.snapshot), nextInviteCode(), hostId],
  );
  for (const member of spec.members) {
    await insertUser(
      member.userId,
      `Player-${member.userId.slice(0, 4)}`,
      member.avatar ?? null,
    );
    await adminPool.query(
      "insert into memberships (game_id, user_id, role) values ($1, $2, $3)",
      [gameId, member.userId, member.role],
    );
  }
  for (const userId of spec.denylist ?? []) {
    // A denylisted user may not have a membership row (kick removes it).
    await adminPool.query(
      "insert into users (user_id, display_name) values ($1, $2) on conflict do nothing",
      [userId, "Kicked"],
    );
    await adminPool.query(
      "insert into game_denylist (game_id, user_id) values ($1, $2)",
      [gameId, userId],
    );
  }
  if (spec.gameState !== undefined) {
    await adminPool.query(
      `insert into game_state (game_id, status, board, last_seq, first_fill_at)
       values ($1, $2, $3::jsonb, $4, $5)`,
      [
        gameId,
        spec.gameState.status ?? "ongoing",
        JSON.stringify(spec.gameState.board),
        spec.gameState.lastSeq,
        spec.gameState.firstFillAt,
      ],
    );
  }
  return gameId;
}

type Frame = { raw: string; msg: ServerMessage };

/** A test WebSocket client that records decoded server frames and the close event. */
class TestClient {
  private readonly received: Frame[] = [];
  private readonly waiters: Array<{
    test: () => unknown;
    resolve: (value: unknown) => void;
  }> = [];
  private closeInfo: { code: number; reason: string } | null = null;
  private readonly closeWaiters: Array<
    (info: { code: number; reason: string }) => void
  > = [];

  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const raw = data.toString();
      const decoded = decodeServerMessage(JSON.parse(raw));
      if (!decoded.ok) {
        throw new Error(`server sent an undecodable frame: ${raw}`);
      }
      this.received.push({ raw, msg: decoded.value });
      this.pump();
    });
    ws.on("close", (code, reason) => {
      this.closeInfo = { code, reason: reason.toString() };
      for (const w of this.closeWaiters) w(this.closeInfo);
    });
  }

  static connect(base: string, gameId: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base}/games/${gameId}/ws`);
      ws.once("open", () => resolve(new TestClient(ws)));
      ws.once("error", reject);
    });
  }

  private pump(): void {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i]!;
      const result = waiter.test();
      if (result !== undefined) {
        waiter.resolve(result);
        this.waiters.splice(i, 1);
      }
    }
  }

  private waitUntil<T>(test: () => T | undefined): Promise<T> {
    const immediate = test();
    if (immediate !== undefined) return Promise.resolve(immediate);
    return new Promise<T>((resolve) => {
      this.waiters.push({ test, resolve: resolve as (v: unknown) => void });
    });
  }

  sendJson(value: unknown): void {
    this.ws.send(JSON.stringify(value));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  ofType(type: string): ServerMessage[] {
    return this.received.filter((f) => f.msg.type === type).map((f) => f.msg);
  }

  rawOfType(type: string): string[] {
    return this.received.filter((f) => f.msg.type === type).map((f) => f.raw);
  }

  /** The negotiated WebSocket extensions (e.g. permessage-deflate), for the SP4 check. */
  negotiatedExtensions(): string {
    return this.ws.extensions;
  }

  waitForType(type: string): Promise<ServerMessage> {
    return this.waitUntil(
      () => this.received.find((f) => f.msg.type === type)?.msg,
    );
  }

  waitForCount(type: string, n: number): Promise<ServerMessage[]> {
    return this.waitUntil(() => {
      const found = this.ofType(type);
      return found.length >= n ? found : undefined;
    });
  }

  /**
   * Resolve with the error frame carrying `commandId`. Non-fatal errors accumulate in the stream
   * (a §11 code per rejected command), so waiting on the type alone (`waitForType("error")`) returns
   * a stale earlier error; matching the commandId waits for the one this command produced (§8, §11).
   */
  waitForError(commandId: string): Promise<ServerMessage> {
    return this.waitUntil(
      () =>
        this.received.find(
          (f) =>
            f.msg.type === "error" &&
            (f.msg as { commandId?: string }).commandId === commandId,
        )?.msg,
    );
  }

  waitForClose(): Promise<{ code: number; reason: string }> {
    if (this.closeInfo !== null) return Promise.resolve(this.closeInfo);
    return new Promise((resolve) => this.closeWaiters.push(resolve));
  }

  close(): void {
    this.ws.close();
  }
}

/** Open a client and complete the handshake, returning the welcome frame. */
async function connectAndHello(
  gameId: string,
  userId: string,
  overrides: { protocolVersion?: number; token?: string } = {},
): Promise<{ client: TestClient; welcome: ServerMessage }> {
  const client = await TestClient.connect(server.url, gameId);
  const token = overrides.token ?? (await auth.mint({ sub: userId }));
  client.sendJson({
    type: "hello",
    protocolVersion: overrides.protocolVersion ?? 1,
    token,
  });
  const welcome = await client.waitForType("welcome");
  return { client, welcome };
}

function placeLetter(cell: number, value: string): Record<string, unknown> {
  return { type: "placeLetter", commandId: randomUUID(), cell, value };
}

function clearCell(cell: number): Record<string, unknown> {
  return { type: "clearCell", commandId: randomUUID(), cell };
}

/** Open a client and handshake against a specific server (the shared one has its own helper). */
async function connectAndHelloOn(
  srv: SessionServer,
  gameId: string,
  userId: string,
): Promise<{ client: TestClient; welcome: ServerMessage }> {
  const client = await TestClient.connect(srv.url, gameId);
  const token = await auth.mint({ sub: userId });
  client.sendJson({ type: "hello", protocolVersion: 1, token });
  const welcome = await client.waitForType("welcome");
  return { client, welcome };
}

/** Poll game_state until the flush advances last_seq to at least `target` (or fail). */
async function waitForLastSeq(gameId: string, target: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const state = await loadGameState(adminPool, gameId);
    if (state !== null && state.lastSeq >= target) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`game_state.last_seq for ${gameId} never reached ${target}`);
}

/** An engine cellSet event for the direct-writer tests. */
function makeCellSet(
  seq: number,
  cell: number,
  value: string | null,
  by: string,
): CellSet {
  return {
    type: "cellSet",
    seq,
    cell,
    value,
    by,
    commandId: randomUUID(),
    at: "2026-07-08T00:00:00.000Z",
  };
}

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  } catch (cause) {
    throw new Error(
      "Testcontainers could not start Postgres. This suite requires a running Docker " +
        "daemon and does not skip when it is missing (repo rule: no silent skips). " +
        "Start Docker and re-run `pnpm test`.",
      { cause },
    );
  }
  const connectionString = container.getConnectionUri();
  await applyMigrations(connectionString);
  adminPool = new Pool({ connectionString });
  // Assume crossy_session on every connection via the `role` GUC (equivalent to SET ROLE
  // for the session), mirroring the api suite's crossy_api pool.
  sessionPool = new Pool({
    connectionString,
    options: "-c role=crossy_session",
  });
  sessionPool.on("error", () => {
    // Swallow idle-client errors during teardown.
  });
  auth = await createFakeAuthProvider();
  // A long default interval so no background flush fires during unrelated tests; the
  // flush-behavior tests below spin up their own servers with tuned thresholds.
  server = await createSessionServer({
    authPort: auth,
    pool: sessionPool,
    actorOptions: { flushIntervalMs: 600_000 },
    internalBearer: INTERNAL_BEARER,
  });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await server?.close();
  await sessionPool?.end();
  await adminPool?.end();
  await container?.stop();
}, 60_000);

describe("handshake (PROTOCOL.md §2)", () => {
  it("replies welcome with self and a full board to a member", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const { client, welcome } = await connectAndHello(gameId, userId);
    expect(welcome).toMatchObject({
      type: "welcome",
      protocolVersion: 1,
      self: { userId, role: "solver" },
    });
    const board = (
      welcome as unknown as { board: { cells: unknown[]; status: string } }
    ).board;
    expect(board.cells).toHaveLength(3);
    expect(board.status).toBe("ongoing");
    client.close();
  });

  it("rejects a first frame that is not hello with UNAUTHORIZED and closes 1008 (§2)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const client = await TestClient.connect(server.url, gameId);
    client.sendJson(placeLetter(0, "A")); // not hello
    const error = (await client.waitForType("error")) as {
      code: string;
      fatal: boolean;
    };
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.fatal).toBe(true);
    expect((await client.waitForClose()).code).toBe(1008);
  });

  it("rejects a bad token with UNAUTHORIZED (§2, §11)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const client = await TestClient.connect(server.url, gameId);
    client.sendJson({ type: "hello", protocolVersion: 1, token: "not-a-jwt" });
    const error = (await client.waitForType("error")) as { code: string };
    expect(error.code).toBe("UNAUTHORIZED");
    expect((await client.waitForClose()).code).toBe(1008);
  });

  it("rejects an unsupported protocol version (§2, §11)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const client = await TestClient.connect(server.url, gameId);
    const token = await auth.mint({ sub: userId });
    client.sendJson({ type: "hello", protocolVersion: 2, token });
    const error = (await client.waitForType("error")) as { code: string };
    expect(error.code).toBe("PROTOCOL_VERSION_UNSUPPORTED");
    expect((await client.waitForClose()).code).toBe(1008);
  });

  it("rejects an unknown game with GAME_NOT_FOUND (§11)", async () => {
    const client = await TestClient.connect(server.url, randomUUID());
    const token = await auth.mint({ sub: randomUUID() });
    client.sendJson({ type: "hello", protocolVersion: 1, token });
    const error = (await client.waitForType("error")) as { code: string };
    expect(error.code).toBe("GAME_NOT_FOUND");
    expect((await client.waitForClose()).code).toBe(1008);
  });

  it("rejects a non-member with NOT_PARTICIPANT (§11)", async () => {
    const memberId = randomUUID();
    const strangerId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: memberId, role: "solver" }],
    });
    const client = await TestClient.connect(server.url, gameId);
    const token = await auth.mint({ sub: strangerId });
    client.sendJson({ type: "hello", protocolVersion: 1, token });
    const error = (await client.waitForType("error")) as { code: string };
    expect(error.code).toBe("NOT_PARTICIPANT");
    expect((await client.waitForClose()).code).toBe(1008);
  });

  it("rejects a denylisted user with DENIED, before the membership check (§7, §11)", async () => {
    const kickedId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: randomUUID(), role: "host" }],
      denylist: [kickedId], // kicked: on the denylist, no membership row
    });
    const client = await TestClient.connect(server.url, gameId);
    const token = await auth.mint({ sub: kickedId });
    client.sendJson({ type: "hello", protocolVersion: 1, token });
    const error = (await client.waitForType("error")) as { code: string };
    expect(error.code).toBe("DENIED");
    expect((await client.waitForClose()).code).toBe(1008);
  });
});

describe("placeLetter to cellSet broadcast (PROTOCOL.md §6)", () => {
  it("broadcasts one cellSet to every connection for an accepted placeLetter", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(5, 5, [], new Array<string | null>(25).fill("A")),
      members: [
        { userId: a, role: "solver" },
        { userId: b, role: "solver" },
      ],
    });
    const first = await connectAndHello(gameId, a);
    const second = await connectAndHello(gameId, b);

    first.client.sendJson(placeLetter(0, "A"));

    const seenByA = (await first.client.waitForType("cellSet")) as {
      seq: number;
      cell: number;
      value: string;
      by: string;
    };
    const seenByB = (await second.client.waitForType("cellSet")) as {
      seq: number;
      by: string;
    };
    expect(seenByA).toMatchObject({ seq: 1, cell: 0, value: "A", by: a });
    expect(seenByB.seq).toBe(1);
    expect(seenByB.by).toBe(a);

    first.client.close();
    second.client.close();
  });

  it("carries firstFillAt on the first fill's cellSet to already-connected clients; a later fill omits it and the snapshot agrees (§4, §6)", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["X", "Y", "Z"]),
      members: [
        { userId: a, role: "solver" },
        { userId: b, role: "solver" },
      ],
    });
    const first = await connectAndHello(gameId, a);
    const second = await connectAndHello(gameId, b);

    // First fill: both connections see firstFillAt on the delta, equal to the event's `at`.
    first.client.sendJson(placeLetter(0, "X"));
    const firstA = (await first.client.waitForType("cellSet")) as {
      seq: number;
      at: string;
      firstFillAt?: string;
    };
    const firstB = (await second.client.waitForType("cellSet")) as {
      seq: number;
      firstFillAt?: string;
    };
    expect(firstA.seq).toBe(1);
    expect(typeof firstA.firstFillAt).toBe("string");
    expect(firstA.firstFillAt).toBe(firstA.at);
    expect(firstB.firstFillAt).toBe(firstA.firstFillAt);

    // A later fill consumes a seq but never re-carries firstFillAt (set-once; §6).
    first.client.sendJson(placeLetter(1, "Y"));
    const cellSetsA = (await first.client.waitForCount("cellSet", 2)) as Array<{
      seq: number;
      firstFillAt?: string;
    }>;
    expect(cellSetsA[1]?.seq).toBe(2);
    expect(cellSetsA[1]?.firstFillAt).toBeUndefined();

    // The snapshot stays authoritative and agrees with the delta's firstFillAt (§4).
    first.client.sendJson({ type: "requestSync" });
    const snap = (await first.client.waitForType("sync")) as {
      board: { firstFillAt: string | null };
    };
    expect(snap.board.firstFillAt).toBe(firstA.firstFillAt);

    first.client.close();
    second.client.close();
  });

  it("maps a spectator mutation to ROLE_FORBIDDEN and a bad value to INVALID_VALUE (§5, §11)", async () => {
    const spectatorId = randomUUID();
    const solverId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: spectatorId, role: "spectator" },
        { userId: solverId, role: "solver" },
      ],
    });
    const spectator = await connectAndHello(gameId, spectatorId);
    const spectatorCmd = placeLetter(0, "A");
    spectator.client.sendJson(spectatorCmd);
    const forbidden = (await spectator.client.waitForType("error")) as {
      code: string;
      fatal: boolean;
      commandId: string;
    };
    expect(forbidden.code).toBe("ROLE_FORBIDDEN");
    expect(forbidden.fatal).toBe(false);
    expect(forbidden.commandId).toBe(spectatorCmd.commandId);

    const solver = await connectAndHello(gameId, solverId);
    solver.client.sendJson({
      type: "placeLetter",
      commandId: randomUUID(),
      cell: 0,
      value: "A B", // fails ^[A-Z0-9]{1,10}$ after normalization
    });
    const invalid = (await solver.client.waitForType("error")) as {
      code: string;
    };
    expect(invalid.code).toBe("INVALID_VALUE");

    spectator.client.close();
    solver.client.close();
  });

  it("refuses a spectator's clearCell with ROLE_FORBIDDEN, same gate as placeLetter (§5, §11)", async () => {
    // Guests seat as spectators (owner decision 2026-07-10, PROTOCOL.md §12); the server is
    // the real guard, so every mutation type a spectator can send must hit the same role gate
    // (actor.ts handleMutation), not just placeLetter. checkPuzzle rides the same gate; its
    // spectator rejection is asserted in the room-check suite below (PROTOCOL.md §10, D27).
    const spectatorId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: spectatorId, role: "spectator" },
        { userId: randomUUID(), role: "host" },
      ],
    });
    const { client } = await connectAndHello(gameId, spectatorId);
    const cmd = clearCell(0);
    client.sendJson(cmd);
    const forbidden = (await client.waitForType("error")) as {
      code: string;
      fatal: boolean;
      commandId: string;
    };
    expect(forbidden.code).toBe("ROLE_FORBIDDEN");
    expect(forbidden.fatal).toBe(false);
    expect(forbidden.commandId).toBe(cmd.commandId);

    client.close();
  });

  it("drops a duplicate commandId silently: no second cellSet (§5, §6)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["X", "Y", "Z"]),
      members: [{ userId, role: "solver" }],
    });
    const { client } = await connectAndHello(gameId, userId);
    const dup = {
      type: "placeLetter",
      commandId: randomUUID(),
      cell: 0,
      value: "X",
    };
    client.sendJson(dup);
    await client.waitForCount("cellSet", 1);
    client.sendJson(dup); // duplicate: dropped, no event
    client.sendJson(placeLetter(1, "Y")); // a distinct command to bound the wait
    const cellSets = await client.waitForCount("cellSet", 2);
    expect(cellSets).toHaveLength(2);
    expect(cellSets.map((m) => (m as { cell: number }).cell)).toEqual([0, 1]);
    client.close();
  });
});

describe("INV-2: contiguous seq under concurrent senders through one mailbox", () => {
  it("assigns a single contiguous total order to interleaved commands from two sockets (INV-2)", async () => {
    const a = randomUUID();
    const b = randomUUID();
    // 5x5 empty grid; each socket writes 10 distinct cells (20 < 25, so never full).
    const gameId = await seedGame({
      snapshot: puzzle(5, 5, [], new Array<string | null>(25).fill("A")),
      members: [
        { userId: a, role: "solver" },
        { userId: b, role: "solver" },
      ],
    });
    const first = await connectAndHello(gameId, a);
    const second = await connectAndHello(gameId, b);

    const N = 10;
    // Fire both sockets' commands interleaved with no awaits, so they arrive racing.
    for (let i = 0; i < N; i++) {
      first.client.sendJson(placeLetter(i, "A"));
      second.client.sendJson(placeLetter(N + i, "A"));
    }

    const fromA = (await first.client.waitForCount("cellSet", 2 * N)) as Array<{
      seq: number;
      commandId: string;
    }>;
    const fromB = (await second.client.waitForCount(
      "cellSet",
      2 * N,
    )) as Array<{
      seq: number;
      commandId: string;
    }>;

    // Contiguous 1..2N with no gaps and no duplicates: the mailbox serialized them.
    const seqs = fromA.map((m) => m.seq);
    expect(seqs).toEqual(Array.from({ length: 2 * N }, (_, i) => i + 1));

    // Every observer sees the identical total order (same seq -> commandId mapping and
    // the same ascending arrival order). Two sockets cannot disagree on the order.
    expect(fromA.map((m) => [m.seq, m.commandId])).toEqual(
      fromB.map((m) => [m.seq, m.commandId]),
    );

    first.client.close();
    second.client.close();
  });
});

describe("INV-3: exactly one gameCompleted with two racers", () => {
  it("yields exactly one completion when two sockets fill the last two cells (INV-3)", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const filler = randomUUID();
    // 1x3, cell 0 pre-filled correctly; cells 1 and 2 remain.
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: a, role: "solver" },
        { userId: b, role: "solver" },
      ],
      gameState: {
        board: [
          { v: "A", by: filler },
          { v: null, by: null },
          { v: null, by: null },
        ],
        lastSeq: 1,
        firstFillAt: "2026-07-08T00:00:00.000Z",
      },
    });
    const first = await connectAndHello(gameId, a);
    const second = await connectAndHello(gameId, b);

    // Two racers fill the last two cells at once.
    first.client.sendJson(placeLetter(1, "B"));
    second.client.sendJson(placeLetter(2, "C"));

    await first.client.waitForType("gameCompleted");
    await second.client.waitForType("gameCompleted");

    // Exactly one gameCompleted reaches each socket, and it is the same event.
    const onA = first.client.ofType("gameCompleted") as Array<{ seq: number }>;
    const onB = second.client.ofType("gameCompleted") as Array<{ seq: number }>;
    expect(onA).toHaveLength(1);
    expect(onB).toHaveLength(1);
    expect(onA[0]!.seq).toBe(onB[0]!.seq);

    first.client.close();
    second.client.close();
  });
});

describe("INV-4: mutations after a terminal state are rejected", () => {
  it("rejects a placeLetter after live completion with GAME_NOT_ONGOING (INV-4)", async () => {
    const userId = randomUUID();
    const filler = randomUUID();
    // 1x2, cell 0 pre-filled correctly; one cell left to complete.
    const gameId = await seedGame({
      snapshot: puzzle(1, 2, [], ["A", "B"]),
      members: [{ userId, role: "solver" }],
      gameState: {
        board: [
          { v: "A", by: filler },
          { v: null, by: null },
        ],
        lastSeq: 1,
        firstFillAt: "2026-07-08T00:00:00.000Z",
      },
    });
    const { client } = await connectAndHello(gameId, userId);

    client.sendJson(placeLetter(1, "B")); // completes the game
    await client.waitForType("gameCompleted");

    const afterCmd = placeLetter(0, "Z"); // a mutation after the terminal state
    client.sendJson(afterCmd);
    const error = (await client.waitForType("error")) as {
      code: string;
      fatal: boolean;
      commandId: string;
    };
    expect(error.code).toBe("GAME_NOT_ONGOING");
    expect(error.fatal).toBe(false);
    expect(error.commandId).toBe(afterCmd.commandId);
    expect(client.ofType("gameCompleted")).toHaveLength(1);
    client.close();
  });
});

describe("INV-6: solutions never leave the server", () => {
  it("carries no solution field in the serialized welcome board (INV-6)", async () => {
    const userId = randomUUID();
    // A distinctive marker embedded in every solution cell; it must not appear on the wire.
    const marker = "ZZSOLUTIONZZ";
    const gameId = await seedGame({
      snapshot: puzzle(2, 2, [], [marker, marker, marker, marker]),
      members: [{ userId, role: "host" }],
    });
    const { client } = await connectAndHello(gameId, userId);
    const rawWelcome = client.rawOfType("welcome");
    expect(rawWelcome).toHaveLength(1);
    // The solution marker is nowhere in the serialized frame.
    expect(rawWelcome[0]).not.toContain(marker);
    expect(rawWelcome[0]!.toLowerCase()).not.toContain("solution");
    // The board's cells carry only {v, by}, and every cell is empty at seq 0.
    const board = (
      client.ofType("welcome")[0] as unknown as {
        board: { cells: Array<Record<string, unknown>> };
      }
    ).board;
    for (const cell of board.cells) {
      expect(Object.keys(cell).sort()).toEqual(["by", "v"]);
      expect(cell).toEqual({ v: null, by: null });
    }
    client.close();
  });
});

describe("write-behind flush atomicity and rehydrate (INV-5; DESIGN.md §6)", () => {
  it("rolls back both the events and the snapshot when the flush fails mid-transaction (INV-5)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const events = [makeCellSet(1, 0, "A", userId)];
    // A snapshot whose status is not a valid enum makes the game_state upsert throw AFTER
    // the cell_events insert, inside the same transaction: rollback must undo BOTH writes.
    const poisoned = {
      status: "not-a-real-status",
      board: [
        { v: "A", by: userId },
        { v: null, by: null },
        { v: null, by: null },
      ],
      lastSeq: 1,
      firstFillAt: "2026-07-08T00:00:00.000Z",
      completedAt: null,
      abandonedAt: null,
      stats: null,
      recentCommandIds: [],
    } as unknown as StateSnapshot;

    await expect(
      flushToPostgres(sessionPool, gameId, events, [], [], poisoned),
    ).rejects.toThrow();

    // Neither the event nor the snapshot landed: the transaction was all-or-nothing.
    const ev = await adminPool.query(
      "select 1 from cell_events where game_id = $1",
      [gameId],
    );
    expect(ev.rows).toHaveLength(0);
    const gs = await adminPool.query(
      "select 1 from game_state where game_id = $1",
      [gameId],
    );
    expect(gs.rows).toHaveLength(0);
  });

  it("rehydrates the exact board from a committed snapshot-plus-log pair (INV-5 no divergence)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const events = [
      makeCellSet(1, 0, "A", userId),
      makeCellSet(2, 2, "C", userId),
    ];
    const snap: StateSnapshot = {
      status: "ongoing",
      board: {
        cells: [
          { v: "A", by: userId },
          { v: null, by: null },
          { v: "C", by: userId },
        ],
        checkedWrongCells: [],
        checkCount: 0,
      },
      lastSeq: 2,
      firstFillAt: "2026-07-08T00:00:00.000Z",
      completedAt: null,
      abandonedAt: null,
      stats: null,
      recentCommandIds: ["c-1", "c-2"],
    };
    await flushToPostgres(sessionPool, gameId, events, [], [], snap);

    // Rehydrate via the same read path the actor uses on first connect.
    const loadedRow = await loadGameRow(adminPool, gameId);
    const loadedState = await loadGameState(adminPool, gameId);
    const hydrated = hydrateGame(
      loadedRow!.snapshot,
      loadedState,
      loadedRow!.roomName,
    );
    expect(hydrated.boardState.seq).toBe(2);
    expect(hydrated.boardState.filledCount).toBe(2);
    expect(hydrated.boardState.cells.get(0)).toEqual({ v: "A", by: userId });
    expect(hydrated.boardState.cells.get(2)).toEqual({ v: "C", by: userId });
    expect(hydrated.recentCommandIds).toEqual(["c-1", "c-2"]);

    // The log is contiguous and its max seq matches the snapshot last_seq: consistent.
    const seqs = await adminPool.query<{ seq: string }>(
      "select seq from cell_events where game_id = $1 order by seq",
      [gameId],
    );
    expect(seqs.rows.map((r) => Number(r.seq))).toEqual([1, 2]);
  });

  it("buffers keystrokes and flushes at the event threshold, rehydrating exactly (INV-5)", async () => {
    const flushServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushEventThreshold: 5, flushIntervalMs: 600_000 },
    });
    try {
      const userId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(5, 5, [], new Array<string | null>(25).fill("A")),
        members: [{ userId, role: "solver" }],
      });
      const { client } = await connectAndHelloOn(flushServer, gameId, userId);
      for (let i = 0; i < 5; i++) client.sendJson(placeLetter(i, "A"));
      await client.waitForCount("cellSet", 5);

      // The 5th accepted event trips the threshold; the flush lands inside the mailbox.
      await waitForLastSeq(gameId, 5);
      const ev = await adminPool.query<{ seq: string }>(
        "select seq from cell_events where game_id = $1 order by seq",
        [gameId],
      );
      expect(ev.rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5]);

      const loadedRow = await loadGameRow(adminPool, gameId);
      const hydrated = hydrateGame(
        loadedRow!.snapshot,
        await loadGameState(adminPool, gameId),
        loadedRow!.roomName,
      );
      expect(hydrated.boardState.filledCount).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(hydrated.boardState.cells.get(i)).toMatchObject({
          v: "A",
          by: userId,
        });
      }
      client.close();
    } finally {
      await flushServer.close();
    }
  });

  it("loses only the unflushed tail on a hard crash; the restored pair stays consistent (INV-5)", async () => {
    // High thresholds so nothing auto-flushes; close() terminates without draining, the
    // proxy for a hard kill (SIGKILL). The accepted-but-unflushed tail is lost, but the
    // snapshot and log agree (both empty here), never a torn state.
    const crashServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushEventThreshold: 1000, flushIntervalMs: 600_000 },
    });
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(5, 5, [], new Array<string | null>(25).fill("A")),
      members: [{ userId, role: "solver" }],
    });
    const { client } = await connectAndHelloOn(crashServer, gameId, userId);
    for (let i = 0; i < 3; i++) client.sendJson(placeLetter(i, "A"));
    await client.waitForCount("cellSet", 3); // all three accepted in memory

    await crashServer.close(); // hard kill: no drain, no flush

    const ev = await adminPool.query(
      "select 1 from cell_events where game_id = $1",
      [gameId],
    );
    expect(ev.rows).toHaveLength(0);
    expect(await loadGameState(adminPool, gameId)).toBeNull();
  });

  it("serves the persisted completion stats after a restart rehydrates the actor (PROTOCOL.md §4; INV-5)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });

    // Complete the game on the shared server; the terminal flush commits the stats
    // before this broadcast arrives (INV-3).
    const { client } = await connectAndHello(gameId, userId);
    client.sendJson(placeLetter(0, "A"));
    client.sendJson(placeLetter(1, "B"));
    client.sendJson(placeLetter(2, "C"));
    const completed = (await client.waitForType(
      "gameCompleted",
    )) as unknown as {
      stats: Record<string, unknown>;
    };
    client.close();

    // A fresh server over the same pool is the deploy/passivation case: its registry
    // holds no live actor, so this welcome comes from a rehydrated one. PROTOCOL.md §4:
    // a completed snapshot's stats are non-null, and they must be the flushed ones.
    const restarted = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
    });
    try {
      const revisit = await connectAndHelloOn(restarted, gameId, userId);
      const board = (
        revisit.welcome as unknown as {
          board: { status: string; stats: Record<string, unknown> | null };
        }
      ).board;
      expect(board.status).toBe("completed");
      expect(board.stats).toEqual(completed.stats);
      revisit.client.close();
    } finally {
      await restarted.close();
    }
  });
});

describe("passivation: idle actors drain and evict (DESIGN.md §6)", () => {
  /** Poll until the server's cached actor count reaches `target` (or fail loudly). */
  async function waitForActorCount(
    srv: SessionServer,
    target: number,
  ): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (srv.liveActorCount() === target) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `liveActorCount never reached ${target} (at ${srv.liveActorCount()})`,
    );
  }

  it("drains the unflushed tail on eviction, and a reconnect rehydrates the exact board (INV-5, DESIGN.md §6)", async () => {
    // Flush thresholds set unreachably high, so ONLY the passivation drain can persist
    // the typed letters: an eviction that skipped the drain would lose them (INV-5).
    const idleServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushEventThreshold: 1000, flushIntervalMs: 600_000 },
      passivateAfterMs: 50,
      passivateSweepIntervalMs: 25,
    });
    try {
      const userId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [{ userId, role: "solver" }],
      });
      const { client } = await connectAndHelloOn(idleServer, gameId, userId);
      client.sendJson(placeLetter(0, "A"));
      client.sendJson(placeLetter(1, "B"));
      await client.waitForCount("cellSet", 2);
      client.close();

      // The sweep drains then evicts once the idle window passes (map goes empty).
      await waitForActorCount(idleServer, 0);
      const state = await loadGameState(adminPool, gameId);
      expect(state?.lastSeq).toBe(2);

      // The same server rehydrates on the next connect: the board is exact (INV-5).
      const revisit = await connectAndHelloOn(idleServer, gameId, userId);
      const board = (
        revisit.welcome as unknown as {
          board: { seq: number; cells: { v: string | null }[] };
        }
      ).board;
      expect(board.seq).toBe(2);
      expect(board.cells[0]?.v).toBe("A");
      expect(board.cells[1]?.v).toBe("B");
      revisit.client.close();
    } finally {
      await idleServer.close();
    }
  });

  it("never evicts an actor holding a live socket (DESIGN.md §6)", async () => {
    const idleServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      passivateAfterMs: 50,
      passivateSweepIntervalMs: 25,
    });
    try {
      const userId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [{ userId, role: "solver" }],
      });
      const { client } = await connectAndHelloOn(idleServer, gameId, userId);
      // Many sweep ticks and idle windows pass; the attached socket pins the actor.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(idleServer.liveActorCount()).toBe(1);
      client.close();
    } finally {
      await idleServer.close();
    }
  });

  it("a passivated completed game still serves its stats on the next visit (PROTOCOL.md §4; INV-5)", async () => {
    const idleServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      passivateAfterMs: 50,
      passivateSweepIntervalMs: 25,
    });
    try {
      const userId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [{ userId, role: "solver" }],
      });
      const { client } = await connectAndHelloOn(idleServer, gameId, userId);
      client.sendJson(placeLetter(0, "A"));
      client.sendJson(placeLetter(1, "B"));
      client.sendJson(placeLetter(2, "C"));
      const completed = (await client.waitForType(
        "gameCompleted",
      )) as unknown as { stats: Record<string, unknown> };
      client.close();

      // Same server, no restart: the sweep evicts the terminal actor, and the next
      // visit's rehydrated welcome still carries the flushed stats (PROTOCOL.md §4).
      await waitForActorCount(idleServer, 0);
      const revisit = await connectAndHelloOn(idleServer, gameId, userId);
      const board = (
        revisit.welcome as unknown as {
          board: { status: string; stats: Record<string, unknown> | null };
        }
      ).board;
      expect(board.status).toBe("completed");
      expect(board.stats).toEqual(completed.stats);
      revisit.client.close();
    } finally {
      await idleServer.close();
    }
  });
});

describe("snapshot guard: a stale writer cannot clobber a newer game_state (INV-7, INV-4)", () => {
  // Read the stored game_state row exactly as Postgres holds it, so a test can assert the
  // guarded fields (board, status, last_seq) are byte-identical after a rejected flush.
  interface StoredRow {
    status: string;
    /** Either board generation: the writer's object shape, or a seeded legacy array. */
    board: unknown;
    last_seq: string;
  }
  async function storedRow(gameId: string): Promise<StoredRow> {
    const { rows } = await adminPool.query<StoredRow>(
      "select status, board, last_seq::text as last_seq from game_state where game_id = $1",
      [gameId],
    );
    if (rows.length !== 1)
      throw new Error(`expected one game_state row for ${gameId}`);
    return rows[0]!;
  }

  function snapshot(
    status: "ongoing" | "completed" | "abandoned",
    board: RawCell[],
    lastSeq: number,
    stats: Record<string, unknown> | null = null,
  ): StateSnapshot {
    return {
      status,
      board: { cells: board, checkedWrongCells: [], checkCount: 0 },
      lastSeq,
      firstFillAt: "2026-07-08T00:00:00.000Z",
      completedAt: status === "completed" ? "2026-07-08T00:10:00.000Z" : null,
      abandonedAt: status === "abandoned" ? "2026-07-08T00:10:00.000Z" : null,
      stats,
      recentCommandIds: [],
    };
  }

  it("INV-7: a lower-last_seq flush throws SnapshotRegressionError and leaves the row intact", async () => {
    const userId = randomUUID();
    // Seed a stored row already at seq 5 with a specific board and events log.
    const stored: RawCell[] = [
      { v: "A", by: userId },
      { v: "B", by: userId },
      { v: "C", by: userId },
    ];
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
      gameState: {
        board: stored,
        lastSeq: 5,
        firstFillAt: "2026-07-08T00:00:00.000Z",
      },
    });
    const before = await storedRow(gameId);

    // A stale writer flushes an OLDER snapshot (seq 3): seq must never regress (INV-7).
    const stale = snapshot(
      "ongoing",
      [
        { v: "X", by: userId },
        { v: null, by: null },
        { v: null, by: null },
      ],
      3,
    );
    const events = [makeCellSet(3, 0, "X", userId)];

    await expect(
      flushToPostgres(sessionPool, gameId, events, [], [], stale),
    ).rejects.toBeInstanceOf(SnapshotRegressionError);

    // The stored row is byte-identical: the stale board, status, and seq never landed.
    expect(await storedRow(gameId)).toEqual(before);
  });

  it("INV-5: the rejected flush's cell_events inserts roll back with it (atomicity of the reject)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
      gameState: {
        board: [
          { v: "A", by: userId },
          { v: "B", by: userId },
          { v: "C", by: userId },
        ],
        lastSeq: 5,
        firstFillAt: "2026-07-08T00:00:00.000Z",
      },
    });

    // The rejected flush carries a fresh cell_events row at seq 3. The guard throws on the
    // snapshot, which rolls back the whole transaction, so that event must not survive (INV-5).
    const stale = snapshot(
      "ongoing",
      [
        { v: "X", by: userId },
        { v: null, by: null },
        { v: null, by: null },
      ],
      3,
    );
    const events = [makeCellSet(3, 0, "X", userId)];

    await expect(
      flushToPostgres(sessionPool, gameId, events, [], [], stale),
    ).rejects.toBeInstanceOf(SnapshotRegressionError);

    const ev = await adminPool.query(
      "select 1 from cell_events where game_id = $1",
      [gameId],
    );
    expect(ev.rows).toHaveLength(0);
  });

  it("INV-4: a higher-seq ongoing snapshot cannot overwrite a stored terminal row (abandoned)", async () => {
    const userId = randomUUID();
    const stored: RawCell[] = [
      { v: "A", by: userId },
      { v: "B", by: userId },
      { v: "C", by: userId },
    ];
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
      gameState: {
        board: stored,
        lastSeq: 5,
        firstFillAt: "2026-07-08T00:00:00.000Z",
        status: "abandoned",
      },
    });
    const before = await storedRow(gameId);
    expect(before.status).toBe("abandoned");

    // An ongoing snapshot with a HIGHER seq must still be refused: a terminal state is
    // final and never regresses back to ongoing (INV-4), even carrying a newer seq.
    const regressing = snapshot(
      "ongoing",
      [
        { v: "Z", by: userId },
        { v: null, by: null },
        { v: null, by: null },
      ],
      9,
    );
    const events = [makeCellSet(9, 0, "Z", userId)];

    await expect(
      flushToPostgres(sessionPool, gameId, events, [], [], regressing),
    ).rejects.toBeInstanceOf(SnapshotRegressionError);

    expect(await storedRow(gameId)).toEqual(before);
  });

  it("INV-4: a higher-seq ongoing snapshot cannot overwrite a stored terminal row (completed)", async () => {
    const userId = randomUUID();
    const stored: RawCell[] = [
      { v: "A", by: userId },
      { v: "B", by: userId },
      { v: "C", by: userId },
    ];
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
      gameState: {
        board: stored,
        lastSeq: 5,
        firstFillAt: "2026-07-08T00:00:00.000Z",
        status: "completed",
      },
    });
    const before = await storedRow(gameId);
    expect(before.status).toBe("completed");

    const regressing = snapshot(
      "ongoing",
      [
        { v: "Z", by: userId },
        { v: null, by: null },
        { v: null, by: null },
      ],
      9,
    );
    const events = [makeCellSet(9, 0, "Z", userId)];

    await expect(
      flushToPostgres(sessionPool, gameId, events, [], [], regressing),
    ).rejects.toBeInstanceOf(SnapshotRegressionError);

    expect(await storedRow(gameId)).toEqual(before);
  });

  it("INV-4: a higher-seq terminal snapshot cannot switch a stored terminal row to a different terminal status (completed to abandoned)", async () => {
    const userId = randomUUID();
    const stored: RawCell[] = [
      { v: "A", by: userId },
      { v: "B", by: userId },
      { v: "C", by: userId },
    ];
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
      gameState: {
        board: stored,
        lastSeq: 5,
        firstFillAt: "2026-07-08T00:00:00.000Z",
        status: "completed",
      },
    });
    const before = await storedRow(gameId);
    expect(before.status).toBe("completed");

    // A second writer flushes an abandoned snapshot with a HIGHER seq. Terminal is final
    // (INV-4): completed never becomes abandoned, so the guard refuses even the newer seq.
    // Only a same-status reflush is allowed, so this must trip the tripwire.
    const switching = snapshot(
      "abandoned",
      [
        { v: "Z", by: userId },
        { v: null, by: null },
        { v: null, by: null },
      ],
      9,
    );

    await expect(
      flushToPostgres(sessionPool, gameId, [], [], [], switching),
    ).rejects.toBeInstanceOf(SnapshotRegressionError);

    expect(await storedRow(gameId)).toEqual(before);
  });

  it("re-flushing an identical terminal snapshot at equal last_seq succeeds without throwing (idempotent retry)", async () => {
    const userId = randomUUID();
    const stored: RawCell[] = [
      { v: "A", by: userId },
      { v: "B", by: userId },
      { v: "C", by: userId },
    ];
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
      gameState: {
        board: stored,
        lastSeq: 6,
        firstFillAt: "2026-07-08T00:00:00.000Z",
        status: "completed",
      },
    });
    const before = await storedRow(gameId);

    // The retry after a partially-observed terminal flush re-sends the same terminal
    // snapshot at the same seq. >= (not >) keeps this from being refused (INV-4 still holds:
    // completed stays completed). No events (the terminal seq is never appended, §9).
    const retry = snapshot("completed", stored, 6, {
      solveTimeSeconds: 42,
      totalEvents: 5,
      participantCount: 1,
    });

    await expect(
      flushToPostgres(sessionPool, gameId, [], [], [], retry),
    ).resolves.toBeUndefined();

    const after = await storedRow(gameId);
    expect(after.status).toBe("completed");
    expect(after.last_seq).toBe(before.last_seq);
    expect(after.board).toEqual({
      cells: stored,
      checkedWrongCells: [],
      checkCount: 0,
    });
  });

  it("a normal monotonic flush (higher last_seq, ongoing over ongoing) still applies", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
      gameState: {
        board: [
          { v: "A", by: userId },
          { v: null, by: null },
          { v: null, by: null },
        ],
        lastSeq: 1,
        firstFillAt: "2026-07-08T00:00:00.000Z",
      },
    });

    // The everyday write-behind case: a newer ongoing snapshot advances the row.
    const advanced = snapshot(
      "ongoing",
      [
        { v: "A", by: userId },
        { v: "B", by: userId },
        { v: null, by: null },
      ],
      2,
    );
    const events = [makeCellSet(2, 1, "B", userId)];

    await expect(
      flushToPostgres(sessionPool, gameId, events, [], [], advanced),
    ).resolves.toBeUndefined();

    const after = await storedRow(gameId);
    expect(after.status).toBe("ongoing");
    expect(after.last_seq).toBe("2");
    expect(after.board).toEqual({
      cells: [
        { v: "A", by: userId },
        { v: "B", by: userId },
        { v: null, by: null },
      ],
      checkedWrongCells: [],
      checkCount: 0,
    });
    // The advancing event landed too: the pair is consistent.
    const ev = await adminPool.query<{ seq: string }>(
      "select seq from cell_events where game_id = $1 order by seq",
      [gameId],
    );
    expect(ev.rows.map((r) => Number(r.seq))).toEqual([2]);
  });
});

describe("participantCount authoritative over cell_events (PROTOCOL.md §4)", () => {
  it("counts DISTINCT writers, not joiners, on the completion path (PROTOCOL.md §4)", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID(); // a member who never writes: must not be counted
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: a, role: "solver" },
        { userId: b, role: "solver" },
        { userId: c, role: "solver" },
      ],
    });
    const first = await connectAndHello(gameId, a);
    const second = await connectAndHello(gameId, b);

    // a writes two cells, b writes the completing third. Await each echo so the order is
    // deterministic: seqs 1,2 by a; seq 3 by b; gameCompleted at seq 4.
    first.client.sendJson(placeLetter(0, "A"));
    await first.client.waitForCount("cellSet", 1);
    first.client.sendJson(placeLetter(1, "B"));
    await first.client.waitForCount("cellSet", 2);
    second.client.sendJson(placeLetter(2, "C"));
    const completed = (await second.client.waitForType("gameCompleted")) as {
      stats: {
        participantCount: number;
        totalEvents: number;
        solveTimeSeconds: number;
      };
    };

    // Two distinct writers (a, b); c joined but never wrote.
    expect(completed.stats.participantCount).toBe(2);
    expect(completed.stats.totalEvents).toBe(3);

    // The stats persisted before broadcast (INV-3): the row is already committed.
    const gs = await adminPool.query<{
      status: string;
      stats: { participantCount: number };
    }>("select status, stats from game_state where game_id = $1", [gameId]);
    expect(gs.rows[0]?.status).toBe("completed");
    expect(gs.rows[0]?.stats.participantCount).toBe(2);

    // The log itself: three rows, two distinct user_ids.
    const ev = await adminPool.query<{ user_id: string }>(
      "select user_id from cell_events where game_id = $1",
      [gameId],
    );
    expect(ev.rows).toHaveLength(3);
    expect(new Set(ev.rows.map((r) => r.user_id)).size).toBe(2);

    first.client.close();
    second.client.close();
  });
});

describe("sittings stats authoritative over cell_events (PROTOCOL.md §4; D29)", () => {
  it("a gapless solve is one sitting and activeSolveSeconds equals solveTimeSeconds exactly (D29 identity)", async () => {
    const a = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: a, role: "solver" }],
    });
    const first = await connectAndHello(gameId, a);

    // Three live fills milliseconds apart: no gap anywhere near SITTING_GAP_MS.
    first.client.sendJson(placeLetter(0, "A"));
    await first.client.waitForCount("cellSet", 1);
    first.client.sendJson(placeLetter(1, "B"));
    await first.client.waitForCount("cellSet", 2);
    first.client.sendJson(placeLetter(2, "C"));
    const completed = (await first.client.waitForType("gameCompleted")) as {
      stats: {
        solveTimeSeconds: number;
        activeSolveSeconds: number;
        sittingCount: number;
      };
    };

    expect(completed.stats.sittingCount).toBe(1);
    expect(completed.stats.activeSolveSeconds).toBe(
      completed.stats.solveTimeSeconds,
    );

    // Persisted before broadcast (INV-3): the frozen stats row carries both fields.
    const gs = await adminPool.query<{
      stats: { activeSolveSeconds: number; sittingCount: number };
    }>("select stats from game_state where game_id = $1", [gameId]);
    expect(gs.rows[0]?.stats.sittingCount).toBe(1);
    expect(gs.rows[0]?.stats.activeSolveSeconds).toBe(
      completed.stats.activeSolveSeconds,
    );

    first.client.close();
  });

  it("a solve resumed after a long-dead first fill counts two sittings and collapses the idle from activeSolveSeconds (D29)", async () => {
    const a = randomUUID();
    // The first sitting happened long ago: one seeded fill (cell 0) whose cell_events row and
    // firstFillAt are a fixed past instant, far more than SITTING_GAP_MS before the live
    // completion below. The actor's memory never held it (hydrated from the snapshot), so the
    // partition MUST come from the log read inside the terminal flush, like participantCount.
    const longAgo = "2026-07-08T00:00:00.000Z";
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: a, role: "solver" }],
      gameState: {
        board: [
          { v: "A", by: a },
          { v: null, by: null },
          { v: null, by: null },
        ],
        lastSeq: 1,
        firstFillAt: longAgo,
      },
    });
    await adminPool.query(
      `insert into cell_events (game_id, seq, cell, user_id, value, at)
         values ($1, 1, 0, $2, 'A', $3)`,
      [gameId, a, longAgo],
    );

    const first = await connectAndHello(gameId, a);
    first.client.sendJson(placeLetter(1, "B"));
    await first.client.waitForCount("cellSet", 1);
    first.client.sendJson(placeLetter(2, "C"));
    const completed = (await first.client.waitForType("gameCompleted")) as {
      stats: {
        solveTimeSeconds: number;
        activeSolveSeconds: number;
        sittingCount: number;
      };
    };

    // Two sittings: the seeded fill, then the live pair after the giant gap.
    expect(completed.stats.sittingCount).toBe(2);
    // The wall clock spans the whole dead stretch (>= 30 minutes by construction) …
    expect(completed.stats.solveTimeSeconds).toBeGreaterThanOrEqual(1800);
    // … while active time collapses it: the seeded fill IS firstFillAt and the live pair
    // lands within seconds, so nearly nothing remains after the collapse.
    expect(completed.stats.activeSolveSeconds).toBeLessThanOrEqual(5);

    first.client.close();
  });
});

describe("room check vote: the proposer proposes, the room decides (PROTOCOL.md §10; D32)", () => {
  const checkPuzzle = (): Record<string, unknown> => ({
    type: "checkPuzzle",
    commandId: randomUUID(),
  });
  const castCheckVote = (
    voteSeq: number,
    approve: boolean,
  ): Record<string, unknown> => ({
    type: "castCheckVote",
    commandId: randomUUID(),
    voteSeq,
    approve,
  });

  it("opens an attributed vote, a decisive approval passes it, and the check lands with by, marks, and persistence (INV-5, INV-6; D32)", async () => {
    // A dedicated server that flushes after every accepted command, so the persistence assertions
    // below see the vote lifecycle in Postgres without waiting on the default ~25-event threshold
    // (the vote passes but never completes the game, so no terminal flush fires).
    const voteServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushEventThreshold: 1, flushIntervalMs: 600_000 },
      internalBearer: INTERNAL_BEARER,
    });
    try {
      const checker = randomUUID();
      const watcher = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [
          { userId: checker, role: "solver" },
          { userId: watcher, role: "solver" },
        ],
      });
      const first = await connectAndHelloOn(voteServer, gameId, checker);
      const second = await connectAndHelloOn(voteServer, gameId, watcher);

      // Fill the grid with one wrong letter: A, X, C (seqs 1-3).
      first.client.sendJson(placeLetter(0, "A"));
      first.client.sendJson(placeLetter(1, "X"));
      first.client.sendJson(placeLetter(2, "C"));
      await first.client.waitForCount("cellSet", 3);

      // The proposal opens a vote at seq 4, broadcast to the WHOLE room; no immediate check (D32).
      const propose = checkPuzzle();
      first.client.sendJson(propose);
      const opened = (await second.client.waitForType(
        "checkVoteOpened",
      )) as unknown as {
        seq: number;
        by: string;
        electorate: string[];
        needed: number;
        expiresAt: string;
        commandId: string;
      };
      expect(opened).toMatchObject({
        seq: 4,
        by: checker,
        electorate: [checker, watcher].sort(),
        needed: 2,
        commandId: propose.commandId,
      });
      expect(typeof opened.expiresAt).toBe("string");
      // No puzzleChecked yet: the vote is still open (needed 2, only the proposer's approval).
      expect(first.client.ofType("puzzleChecked")).toHaveLength(0);

      // The snapshot heals a reconnecting client mid-vote with the whole §4 checkVote (no delta replay).
      second.client.sendJson({ type: "requestSync" });
      const midVote = (await second.client.waitForType("sync")) as SyncMessage;
      expect(midVote.board.checkVote).toMatchObject({
        openedSeq: 4,
        by: checker,
        approvals: [checker],
        rejections: [],
        needed: 2,
      });

      // A decisive approval closes the vote passed and fires the check, attributed to the proposer.
      second.client.sendJson(castCheckVote(4, true));
      const checkedFrames = await Promise.all([
        first.client.waitForType("puzzleChecked"),
        second.client.waitForType("puzzleChecked"),
      ]);
      for (const frame of checkedFrames) {
        expect(frame).toMatchObject({
          type: "puzzleChecked",
          wrongCells: [1],
          checkCount: 1,
          by: checker,
          commandId: propose.commandId,
        });
      }
      // Attribution is now on the wire (D32 overturns the D27 neutrality): the RAW frame carries by.
      const rawChecked = first.client.rawOfType("puzzleChecked")[0]!;
      expect(Object.keys(JSON.parse(rawChecked) as object)).toContain("by");

      // The close preceded the check: checkVoteClosed(passed) at seq 6, puzzleChecked at seq 7.
      const closed = (await first.client.waitForType(
        "checkVoteClosed",
      )) as unknown as {
        seq: number;
        outcome: string;
      };
      expect(closed).toMatchObject({ seq: 6, outcome: "passed" });
      const checked = first.client.ofType("puzzleChecked")[0] as {
        seq: number;
      };
      expect(checked.seq).toBe(7);

      // The snapshot heals the marks and clears the vote (PROTOCOL.md §4). This is the SECOND sync
      // (the first was the mid-vote heal above), so read the latest rather than the stale first frame.
      second.client.sendJson({ type: "requestSync" });
      const syncs = (await second.client.waitForCount(
        "sync",
        2,
      )) as SyncMessage[];
      const sync = syncs[syncs.length - 1]!;
      expect(sync.board.checkedWrongCells).toEqual([1]);
      expect(sync.board.checkCount).toBe(1);
      expect(sync.board.checkVote).toBeNull();
      expect(sync.board.seq).toBe(7);

      await waitForLastSeq(gameId, 7);
      // check_events keeps the proposer whose vote passed (DESIGN.md §9); check_vote_events keeps the
      // whole lifecycle, one row per consumed seq (opened, cast, closed).
      const checkRows = await adminPool.query<{ seq: string; user_id: string }>(
        "select seq, user_id from check_events where game_id = $1",
        [gameId],
      );
      expect(checkRows.rows).toEqual([{ seq: "7", user_id: checker }]);
      const voteRows = await adminPool.query<{
        seq: string;
        kind: string;
        user_id: string | null;
        approve: boolean | null;
        vote_seq: string;
        electorate: string[] | null;
        outcome: string | null;
      }>(
        "select seq, kind, user_id, approve, vote_seq, electorate, outcome from check_vote_events where game_id = $1 order by seq",
        [gameId],
      );
      expect(
        voteRows.rows.map((r) => [r.kind, Number(r.seq), r.outcome]),
      ).toEqual([
        ["opened", 4, null],
        ["cast", 5, null],
        ["closed", 6, "passed"],
      ]);
      expect(voteRows.rows[0]).toMatchObject({
        user_id: checker,
        vote_seq: "4",
        electorate: [checker, watcher].sort(),
      });
      expect(voteRows.rows[1]).toMatchObject({
        user_id: watcher,
        approve: true,
      });

      first.client.close();
      second.client.close();
    } finally {
      await voteServer.close();
    }
  });

  it("a solo electorate passes at open: the checkVoteOpened/closed/puzzleChecked triple in one command (§10)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const { client } = await connectAndHello(gameId, userId);
    client.sendJson(placeLetter(0, "A"));
    client.sendJson(placeLetter(1, "X"));
    client.sendJson(placeLetter(2, "C"));
    await client.waitForCount("cellSet", 3);

    client.sendJson(checkPuzzle());
    const opened = (await client.waitForType("checkVoteOpened")) as unknown as {
      needed: number;
      electorate: string[];
    };
    expect(opened).toMatchObject({ needed: 1, electorate: [userId] });
    const closed = (await client.waitForType("checkVoteClosed")) as unknown as {
      outcome: string;
    };
    expect(closed.outcome).toBe("passed");
    const checked = (await client.waitForType("puzzleChecked")) as unknown as {
      by: string;
      wrongCells: number[];
    };
    expect(checked).toMatchObject({ by: userId, wrongCells: [1] });
    client.close();
  });

  it("a decisive rejection closes the vote failed REJECTED, marking and counting nothing (§10)", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: a, role: "host" },
        { userId: b, role: "solver" },
        { userId: c, role: "solver" },
      ],
    });
    const ca = await connectAndHello(gameId, a);
    const cb = await connectAndHello(gameId, b);
    const cc = await connectAndHello(gameId, c);
    ca.client.sendJson(placeLetter(0, "A"));
    ca.client.sendJson(placeLetter(1, "X"));
    ca.client.sendJson(placeLetter(2, "C"));
    await ca.client.waitForCount("cellSet", 3);

    ca.client.sendJson(checkPuzzle()); // needed 2, approvals [a]
    await cb.client.waitForType("checkVoteOpened");
    cb.client.sendJson(castCheckVote(4, false)); // 3 - 1 = 2: still open
    await cb.client.waitForType("checkVoteCast");
    cc.client.sendJson(castCheckVote(4, false)); // 3 - 2 = 1 < 2: majority unreachable
    const closed = (await cc.client.waitForType(
      "checkVoteClosed",
    )) as unknown as {
      outcome: string;
      reason: string;
    };
    expect(closed).toMatchObject({ outcome: "failed", reason: "REJECTED" });

    ca.client.sendJson({ type: "requestSync" });
    const sync = (await ca.client.waitForType("sync")) as SyncMessage;
    expect(sync.board.checkVote).toBeNull();
    expect(sync.board.checkCount).toBe(0);
    expect(sync.board.checkedWrongCells).toEqual([]);
    expect(ca.client.ofType("puzzleChecked")).toHaveLength(0);

    ca.client.close();
    cb.client.close();
    cc.client.close();
  });

  it("the timebox closes an open vote failed EXPIRED when the timer fires (§10)", async () => {
    const ttlServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushIntervalMs: 600_000, checkVoteTtlMs: 250 },
      internalBearer: INTERNAL_BEARER,
    });
    try {
      const a = randomUUID();
      const b = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [
          { userId: a, role: "solver" },
          { userId: b, role: "solver" },
        ],
      });
      const ca = await connectAndHelloOn(ttlServer, gameId, a);
      const cb = await connectAndHelloOn(ttlServer, gameId, b);
      ca.client.sendJson(placeLetter(0, "A"));
      ca.client.sendJson(placeLetter(1, "X"));
      ca.client.sendJson(placeLetter(2, "C"));
      await ca.client.waitForCount("cellSet", 3);

      ca.client.sendJson(checkPuzzle()); // needed 2, opens and stays open
      await cb.client.waitForType("checkVoteOpened");
      // No ballot: the timebox elapses and the session feeds the engine expireCheckVote.
      const closed = (await cb.client.waitForType(
        "checkVoteClosed",
      )) as unknown as {
        outcome: string;
        reason: string;
      };
      expect(closed).toMatchObject({ outcome: "failed", reason: "EXPIRED" });
      expect(cb.client.ofType("puzzleChecked")).toHaveLength(0);

      ca.client.close();
      cb.client.close();
    } finally {
      await ttlServer.close();
    }
  });

  it("a clear mid-vote cancels it GRID_BROKEN; an in-place correction cancels it TERMINAL before completion (§10)", async () => {
    // Case 1: a clear that empties a cell breaks the full grid.
    const a = randomUUID();
    const b = randomUUID();
    const gid1 = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: a, role: "solver" },
        { userId: b, role: "solver" },
      ],
    });
    const c1a = await connectAndHello(gid1, a);
    await connectAndHello(gid1, b);
    c1a.client.sendJson(placeLetter(0, "A"));
    c1a.client.sendJson(placeLetter(1, "X"));
    c1a.client.sendJson(placeLetter(2, "C"));
    await c1a.client.waitForCount("cellSet", 3);
    c1a.client.sendJson(checkPuzzle());
    await c1a.client.waitForType("checkVoteOpened");
    c1a.client.sendJson(clearCell(0));
    const broken = (await c1a.client.waitForType(
      "checkVoteClosed",
    )) as unknown as {
      outcome: string;
      reason: string;
    };
    expect(broken).toMatchObject({
      outcome: "cancelled",
      reason: "GRID_BROKEN",
    });
    c1a.client.close();

    // Case 2: an in-place correction makes the grid full and correct: it completes the game.
    const c = randomUUID();
    const d = randomUUID();
    const gid2 = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: c, role: "solver" },
        { userId: d, role: "solver" },
      ],
    });
    const c2 = await connectAndHello(gid2, c);
    await connectAndHello(gid2, d);
    c2.client.sendJson(placeLetter(0, "A"));
    c2.client.sendJson(placeLetter(1, "X"));
    c2.client.sendJson(placeLetter(2, "C"));
    await c2.client.waitForCount("cellSet", 3);
    c2.client.sendJson(checkPuzzle());
    await c2.client.waitForType("checkVoteOpened");
    c2.client.sendJson(placeLetter(1, "B")); // corrects the last wrong cell: full and correct
    const cancelled = (await c2.client.waitForType(
      "checkVoteClosed",
    )) as unknown as {
      seq: number;
      outcome: string;
      reason: string;
    };
    expect(cancelled).toMatchObject({
      outcome: "cancelled",
      reason: "TERMINAL",
    });
    const completed = (await c2.client.waitForType(
      "gameCompleted",
    )) as unknown as {
      seq: number;
    };
    // Ordering: cellSet, checkVoteClosed(TERMINAL), gameCompleted (the terminal event stays last).
    expect(completed.seq).toBeGreaterThan(cancelled.seq);
    c2.client.close();
  });

  it("an abandon mid-vote closes the vote TERMINAL before gameAbandoned (§10; INV-4)", async () => {
    const hostId = randomUUID();
    const other = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: hostId, role: "host" },
        { userId: other, role: "solver" },
      ],
    });
    const host = await connectAndHello(gameId, hostId);
    await connectAndHello(gameId, other);
    host.client.sendJson(placeLetter(0, "A"));
    host.client.sendJson(placeLetter(1, "X"));
    host.client.sendJson(placeLetter(2, "C"));
    await host.client.waitForCount("cellSet", 3);
    host.client.sendJson(checkPuzzle()); // opens (needed 2), stays open
    await host.client.waitForType("checkVoteOpened");

    const res = await postMembershipChanged(gameId, {
      change: "abandon",
      by: hostId,
    });
    expect(res.status).toBe(200);

    const closed = (await host.client.waitForType(
      "checkVoteClosed",
    )) as unknown as {
      seq: number;
      outcome: string;
      reason: string;
    };
    expect(closed).toMatchObject({ outcome: "cancelled", reason: "TERMINAL" });
    const abandoned = (await host.client.waitForType(
      "gameAbandoned",
    )) as unknown as {
      seq: number;
      by: string;
    };
    expect(abandoned.by).toBe(hostId);
    // The vote close precedes gameAbandoned, mirroring the completion ordering (D32).
    expect(abandoned.seq).toBeGreaterThan(closed.seq);
    host.client.close();
  });

  it("crash rehydrate closes an already-expired vote EXPIRED, healing the reconnect (§10; INV-5)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    // Seed a persisted game_state carrying an open vote whose deadline already passed (a crash
    // between the open and the timer). The board object shape matches what the actor flushes (D32).
    const board = {
      cells: [
        { v: "X", by: userId },
        { v: "B", by: userId },
        { v: "C", by: userId },
      ],
      checkedWrongCells: [],
      checkCount: 0,
      checkVote: {
        openedSeq: 4,
        by: userId,
        commandId: randomUUID(),
        electorate: [userId, randomUUID()].sort(),
        approvals: [userId],
        rejections: [],
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    };
    await adminPool.query(
      `insert into game_state (game_id, status, board, last_seq, first_fill_at)
       values ($1, 'ongoing', $2::jsonb, 4, '2026-07-08T00:00:00.000Z')`,
      [gameId, JSON.stringify(board)],
    );

    // The first connection hydrates the actor, which reconciles the stale vote against the clock:
    // the welcome snapshot already heals to no open vote at the advanced seq.
    const { welcome } = await connectAndHello(gameId, userId);
    const w = welcome as unknown as { board: SyncMessage["board"] };
    expect(w.board.checkVote).toBeNull();
    expect(w.board.seq).toBe(5);

    // The close consumed a seq and persisted an EXPIRED check_vote_events row.
    await waitForLastSeq(gameId, 5);
    const voteRows = await adminPool.query<{
      kind: string;
      reason: string | null;
    }>(
      "select kind, reason from check_vote_events where game_id = $1 order by seq",
      [gameId],
    );
    expect(voteRows.rows).toEqual([{ kind: "closed", reason: "EXPIRED" }]);
  });

  it("rejects a proposal below a full grid with GRID_NOT_FULL, consuming no seq (§10, §11; INV-2)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const { client } = await connectAndHello(gameId, userId);
    client.sendJson(placeLetter(0, "A"));
    await client.waitForCount("cellSet", 1);

    const early = { type: "checkPuzzle", commandId: randomUUID() };
    client.sendJson(early);
    const refused = (await client.waitForType("error")) as unknown as {
      code: string;
      fatal: boolean;
      commandId: string;
    };
    expect(refused).toMatchObject({
      code: "GRID_NOT_FULL",
      fatal: false,
      commandId: early.commandId,
    });
    // A rejection consumes no seq (INV-2): the next accepted mutation takes seq 2.
    client.sendJson(placeLetter(1, "X"));
    const sets = (await client.waitForCount("cellSet", 2)) as Array<{
      seq: number;
    }>;
    expect(sets[1]?.seq).toBe(2);
    client.close();
  });

  it("surfaces the four vote error codes as non-fatal errors with the commandId (§11; D32)", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: a, role: "host" },
        { userId: b, role: "solver" },
      ],
    });
    const ca = await connectAndHello(gameId, a);
    const cb = await connectAndHello(gameId, b);
    ca.client.sendJson(placeLetter(0, "A"));
    ca.client.sendJson(placeLetter(1, "X"));
    ca.client.sendJson(placeLetter(2, "C"));
    await ca.client.waitForCount("cellSet", 3);

    // NO_VOTE_OPEN: a ballot before any vote is open. Errors accumulate in the stream, so each
    // assertion below waits on the error carrying ITS commandId, not merely the first error (§8).
    const early = castCheckVote(4, true);
    ca.client.sendJson(early);
    expect(
      await ca.client.waitForError(early.commandId as string),
    ).toMatchObject({ code: "NO_VOTE_OPEN", fatal: false });

    // Open a vote (needed 2, electorate [a, b]).
    ca.client.sendJson(checkPuzzle());
    await cb.client.waitForType("checkVoteOpened");

    // VOTE_PENDING: a second proposal while one is open.
    const second = checkPuzzle();
    ca.client.sendJson(second);
    expect(
      await ca.client.waitForError(second.commandId as string),
    ).toMatchObject({ code: "VOTE_PENDING" });

    // ALREADY_VOTED: the proposer casting a ballot (already approved at proposal time).
    const dup = castCheckVote(4, true);
    ca.client.sendJson(dup);
    expect(await ca.client.waitForError(dup.commandId as string)).toMatchObject(
      {
        code: "ALREADY_VOTED",
      },
    );

    // NO_VOTE_OPEN also covers a stale voteSeq naming a vote that is not open.
    const stale = castCheckVote(999, true);
    cb.client.sendJson(stale);
    expect(
      await cb.client.waitForError(stale.commandId as string),
    ).toMatchObject({ code: "NO_VOTE_OPEN" });

    // NOT_ELECTOR: a host/solver who joined after the electorate froze. Seed the user row before
    // the membership row (memberships.user_id references users, §8).
    const late = randomUUID();
    await insertUser(late, "Latecomer");
    await adminPool.query(
      "insert into memberships (game_id, user_id, role) values ($1, $2, 'solver')",
      [gameId, late],
    );
    const cl = await connectAndHello(gameId, late);
    const notElector = castCheckVote(4, true);
    cl.client.sendJson(notElector);
    expect(
      await cl.client.waitForError(notElector.commandId as string),
    ).toMatchObject({ code: "NOT_ELECTOR" });

    ca.client.close();
    cb.client.close();
    cl.client.close();
  });

  it("refuses a spectator's proposal and ballot with ROLE_FORBIDDEN, the same gate as the cell mutations (§5, §11)", async () => {
    const spectatorId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: spectatorId, role: "spectator" },
        { userId: randomUUID(), role: "host" },
      ],
    });
    const { client } = await connectAndHello(gameId, spectatorId);

    const propose = { type: "checkPuzzle", commandId: randomUUID() };
    client.sendJson(propose);
    expect(await client.waitForType("error")).toMatchObject({
      code: "ROLE_FORBIDDEN",
      fatal: false,
      commandId: propose.commandId,
    });

    const ballot = {
      type: "castCheckVote",
      commandId: randomUUID(),
      voteSeq: 4,
      approve: true,
    };
    client.sendJson(ballot);
    // Await the ballot's own error frame (the propose error already sits in the stream), so the
    // read is not racing the async reply (§8): the spectator ballot hits the same role gate.
    expect(await client.waitForError(ballot.commandId)).toMatchObject({
      code: "ROLE_FORBIDDEN",
      fatal: false,
    });
    client.close();
  });
});

describe("reconnect resync (PROTOCOL.md §7, §8)", () => {
  it("replies to requestSync with a full sync snapshot carrying recentCommandIds (§7, §8)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const { client } = await connectAndHello(gameId, userId);
    const cmd = placeLetter(0, "A");
    client.sendJson(cmd);
    await client.waitForCount("cellSet", 1);

    client.sendJson({ type: "requestSync" });
    const sync = (await client.waitForType("sync")) as unknown as {
      board: {
        seq: number;
        cells: { v: string | null; by: string | null }[];
        recentCommandIds: string[];
      };
    };
    expect(sync.board.seq).toBe(1);
    expect(sync.board.cells[0]).toMatchObject({ v: "A", by: userId });
    expect(sync.board.recentCommandIds).toContain(cmd.commandId);
    client.close();
  });

  it("carries applied recentCommandIds in the reconnect welcome (§2, §8)", async () => {
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    const first = await connectAndHello(gameId, userId);
    const cmd = placeLetter(0, "A");
    first.client.sendJson(cmd);
    await first.client.waitForCount("cellSet", 1);
    first.client.close();

    // A fresh hello (reconnect) to the same, still-live actor sees the applied command.
    const second = await connectAndHello(gameId, userId);
    const board = (
      second.welcome as unknown as { board: { recentCommandIds: string[] } }
    ).board;
    expect(board.recentCommandIds).toContain(cmd.commandId);
    second.client.close();
  });

  it("negotiates permessage-deflate and round-trips a large welcome snapshot (SP4)", async () => {
    const userId = randomUUID();
    // A 15x15 board: the welcome snapshot is well over the 1 KB compression threshold.
    const gameId = await seedGame({
      snapshot: puzzle(15, 15, [], new Array<string | null>(225).fill("A")),
      members: [{ userId, role: "solver" }],
    });
    const { client, welcome } = await connectAndHello(gameId, userId);
    // The extension is negotiated, so the snapshot frame traversed deflate; SP4 measured
    // the actual wire compression, this proves it decodes correctly end to end.
    expect(client.negotiatedExtensions()).toContain("permessage-deflate");
    const board = (welcome as unknown as { board: { cells: unknown[] } }).board;
    expect(board.cells).toHaveLength(225);
    client.close();
  });
});

describe("SIGTERM drain loses nothing accepted (INV-5; DESIGN.md §6)", () => {
  it("flushes every live actor and closes sockets 1001 on drain (INV-5)", async () => {
    // Thresholds high so nothing flushes before the drain; the drain is the only writer.
    const drainServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushEventThreshold: 1000, flushIntervalMs: 600_000 },
    });
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(5, 5, [], new Array<string | null>(25).fill("A")),
      members: [{ userId, role: "solver" }],
    });
    const { client } = await connectAndHelloOn(drainServer, gameId, userId);
    const N = 10;
    for (let i = 0; i < N; i++) client.sendJson(placeLetter(i, "A"));
    await client.waitForCount("cellSet", N); // all N accepted in memory

    // Nothing durable yet: the drain must be what saves them.
    expect(await loadGameState(adminPool, gameId)).toBeNull();

    await drainServer.drain();

    const ev = await adminPool.query<{ seq: string }>(
      "select seq from cell_events where game_id = $1 order by seq",
      [gameId],
    );
    expect(ev.rows.map((r) => Number(r.seq))).toEqual(
      Array.from({ length: N }, (_, i) => i + 1),
    );
    const gs = await loadGameState(adminPool, gameId);
    expect(gs?.lastSeq).toBe(N);

    // Clients reconnect on a 1001 shutdown close (PROTOCOL.md §2).
    expect((await client.waitForClose()).code).toBe(1001);
  });
});

describe("session role single-writer boundary (INV-7, INV-8)", () => {
  it("cannot write an api-owned table under the crossy_session role (INV-7, INV-8)", async () => {
    // The server's own pool proves the negative: the session role may write game_state
    // and cell_events (exercised throughout this suite) but never an api-owned table.
    await expect(
      sessionPool.query("insert into users (user_id) values ($1)", [
        randomUUID(),
      ]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      sessionPool.query(
        "insert into memberships (game_id, user_id, role) values ($1, $2, 'solver')",
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot write the denylist under the crossy_session role: it verifies, never mutates (INV-8)", async () => {
    // The session reads the denylist at connect and on membership-changed but never writes it;
    // the API is the single writer (INV-7, INV-8). The grant layer enforces that: the session
    // role holds SELECT on game_denylist, not INSERT.
    await expect(
      sessionPool.query(
        "insert into game_denylist (game_id, user_id) values ($1, $2)",
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

// The membership-changed internal endpoint (DESIGN.md §6, INV-8). These drive the real HTTP
// endpoint on the shared server with the injected bearer, exactly as the API would, so the
// cross-service contract is exercised end to end from the session's side.
const HTTP_BASE = (): string => server.url.replace(/^ws:/, "http:");

/** POST the membership-changed hint. `bearer: null` omits the header (unauthenticated). */
async function postMembershipChanged(
  gameId: string,
  body: unknown,
  bearer: string | null = INTERNAL_BEARER,
): Promise<Response> {
  return fetch(`${HTTP_BASE()}/internal/games/${gameId}/membership-changed`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer !== null ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("membership-changed internal endpoint auth (DESIGN.md §6)", () => {
  it("refuses a request with no bearer as 401 (DESIGN.md §6)", async () => {
    const res = await postMembershipChanged(
      randomUUID(),
      { change: "kick", userId: randomUUID() },
      null,
    );
    expect(res.status).toBe(401);
  });

  it("refuses a wrong bearer as 403 (DESIGN.md §6)", async () => {
    const res = await postMembershipChanged(
      randomUUID(),
      { change: "kick", userId: randomUUID() },
      "not-the-secret",
    );
    expect(res.status).toBe(403);
  });

  it("rejects a malformed body as 400 with a valid bearer", async () => {
    const res = await postMembershipChanged(randomUUID(), {
      change: "not-a-change",
    });
    expect(res.status).toBe(400);
  });

  it("disables the endpoint (503) on a server with no bearer configured (fail closed)", async () => {
    const bare = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
    });
    try {
      const res = await fetch(
        `${bare.url.replace(/^ws:/, "http:")}/internal/games/${randomUUID()}/membership-changed`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ change: "kick", userId: randomUUID() }),
        },
      );
      expect(res.status).toBe(503);
    } finally {
      await bare.close();
    }
  });
});

// The live-activity welcome internal endpoint (PROTOCOL.md 12a). A recording fake emitter proves
// the notice routes through the same shared internal listener and bearer as membership-changed, and
// that the emitter's onWelcome is fed the game's current facts even for a passivated game (no live
// actor), via the registry's SELECT-only hydration read. No APNs, no socket to APNs.
interface WelcomeCall {
  gameId: string;
  userId: string;
  facts: BoardFacts;
}

/** A recording emitter: onWelcome records its call; every other hook is inert. */
function recordingEmitter(): {
  emitter: ActivityPushEmitter;
  welcomes: WelcomeCall[];
} {
  const welcomes: WelcomeCall[] = [];
  const emitter: ActivityPushEmitter = {
    ...createInertEmitter(),
    onWelcome(gameId, userId, facts) {
      welcomes.push({ gameId, userId, facts });
    },
  };
  return { emitter, welcomes };
}

async function postLiveActivityRegistered(
  base: string,
  gameId: string,
  body: unknown,
  bearer: string | null = INTERNAL_BEARER,
): Promise<Response> {
  return fetch(`${base}/internal/games/${gameId}/live-activity-registered`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer !== null ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("live-activity welcome internal endpoint (PROTOCOL.md 12a; INV-7)", () => {
  it("feeds onWelcome the game's current facts for a passivated game, no actor resurrection", async () => {
    const { emitter, welcomes } = recordingEmitter();
    const wServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      internalBearer: INTERNAL_BEARER,
      pushEmitter: emitter,
    });
    try {
      const memberId = randomUUID();
      // A 2x2 all-playable grid with two filled cells; no live actor is ever hydrated here.
      const gameId = await seedGame({
        snapshot: puzzle(2, 2, [], ["A", "B", "C", "D"]),
        members: [{ userId: memberId, role: "solver" }],
        gameState: {
          board: [
            { v: "A", by: memberId },
            { v: "B", by: memberId },
            { v: null, by: null },
            { v: null, by: null },
          ],
          lastSeq: 2,
          firstFillAt: "2026-07-11T00:00:00Z",
          status: "ongoing",
        },
      });

      const base = wServer.url.replace(/^ws:/, "http:");
      const res = await postLiveActivityRegistered(base, gameId, {
        userId: memberId,
      });
      expect(res.status).toBe(200);
      // The emitter received the welcome with the game's current facts, read without a live actor.
      expect(welcomes).toHaveLength(1);
      expect(welcomes[0]!.gameId).toBe(gameId);
      expect(welcomes[0]!.userId).toBe(memberId);
      expect(welcomes[0]!.facts.filled).toBe(2);
      expect(welcomes[0]!.facts.total).toBe(4);
      expect(welcomes[0]!.facts.status).toBe("ongoing");
      // Passivated: nobody holds a socket, so the connected set is empty (honest away-dimming).
      expect(welcomes[0]!.facts.connectedUserIds.size).toBe(0);
    } finally {
      await wServer.close();
    }
  });

  it("drops the welcome for a game that does not exist (cheapest honest behavior)", async () => {
    const { emitter, welcomes } = recordingEmitter();
    const wServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      internalBearer: INTERNAL_BEARER,
      pushEmitter: emitter,
    });
    try {
      const base = wServer.url.replace(/^ws:/, "http:");
      const res = await postLiveActivityRegistered(base, randomUUID(), {
        userId: randomUUID(),
      });
      // The endpoint acknowledges (the API notice is fire-and-forget), but no welcome is emitted.
      expect(res.status).toBe(200);
      expect(welcomes).toHaveLength(0);
    } finally {
      await wServer.close();
    }
  });

  it("refuses no bearer (401) and a wrong bearer (403), same auth as membership-changed", async () => {
    const noBearer = await postLiveActivityRegistered(
      HTTP_BASE(),
      randomUUID(),
      { userId: randomUUID() },
      null,
    );
    expect(noBearer.status).toBe(401);
    const wrongBearer = await postLiveActivityRegistered(
      HTTP_BASE(),
      randomUUID(),
      { userId: randomUUID() },
      "not-the-secret",
    );
    expect(wrongBearer.status).toBe(403);
  });

  it("rejects a malformed body (400) with a valid bearer", async () => {
    const res = await postLiveActivityRegistered(HTTP_BASE(), randomUUID(), {
      notUserId: "x",
    });
    expect(res.status).toBe(400);
  });
});

describe("kicked account is disconnected and refused at reconnect (INV-8; PROTOCOL.md §2)", () => {
  it("disconnects a live socket on membership-changed, then DENIES the reconnect (M3 exit line)", async () => {
    const kickedId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: kickedId, role: "solver" },
        { userId: randomUUID(), role: "host" },
      ],
    });
    const { client } = await connectAndHello(gameId, kickedId);

    // Simulate the API's kick transaction (single writer, INV-7): drop the membership row and
    // write the denylist. The session only verifies this authoritative state (INV-8).
    await adminPool.query(
      "delete from memberships where game_id=$1 and user_id=$2",
      [gameId, kickedId],
    );
    await adminPool.query(
      "insert into game_denylist (game_id, user_id) values ($1, $2)",
      [gameId, kickedId],
    );

    const res = await postMembershipChanged(gameId, {
      change: "kick",
      userId: kickedId,
    });
    expect(res.status).toBe(200);

    // The live socket receives the terminal kicked notice and closes 1008 (PROTOCOL.md §6).
    const kicked = (await client.waitForType("kicked")) as { reason: string };
    expect(typeof kicked.reason).toBe("string");
    expect((await client.waitForClose()).code).toBe(1008);

    // The reconnect is refused DENIED at the handshake, not NOT_PARTICIPANT: the denylist is
    // checked strictly before membership (PROTOCOL.md §2), which is why DENIED is reachable for
    // exactly the kicked user whose membership row is already gone.
    const reconnect = await TestClient.connect(server.url, gameId);
    reconnect.sendJson({
      type: "hello",
      protocolVersion: 1,
      token: await auth.mint({ sub: kickedId }),
    });
    const error = (await reconnect.waitForType("error")) as { code: string };
    expect(error.code).toBe("DENIED");
    expect((await reconnect.waitForClose()).code).toBe(1008);
  });

  it("is a no-op with a 200 on a passivated game (no live actor; denylist enforces at connect)", async () => {
    // A game nobody is connected to has no live actor. A kick needs no actor: the denylist plus
    // connect-time re-verify enforce it at the next connect (DESIGN.md §6). The endpoint must
    // not hydrate one just to do nothing.
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: randomUUID(), role: "host" }],
    });
    const res = await postMembershipChanged(gameId, {
      change: "kick",
      userId: randomUUID(),
    });
    expect(res.status).toBe(200);
    // No actor was hydrated, so no game_state row was written.
    expect(await loadGameState(adminPool, gameId)).toBeNull();
  });
});

describe("role change re-verifies the live connection (INV-8)", () => {
  it("upgrades a live spectator to solver so its next mutation is accepted (INV-8)", async () => {
    const specId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: specId, role: "spectator" },
        { userId: randomUUID(), role: "host" },
      ],
    });
    const { client } = await connectAndHello(gameId, specId);

    // As a spectator, a mutation is refused ROLE_FORBIDDEN (PROTOCOL.md §5).
    const before = placeLetter(0, "A");
    client.sendJson(before);
    const forbidden = (await client.waitForType("error")) as { code: string };
    expect(forbidden.code).toBe("ROLE_FORBIDDEN");

    // The API upgrades the role (single writer, INV-7); the session re-reads and updates the
    // cached role on the live connection (INV-8: it verifies, it does not decide).
    await adminPool.query(
      "update memberships set role='solver' where game_id=$1 and user_id=$2",
      [gameId, specId],
    );
    const res = await postMembershipChanged(gameId, {
      change: "role",
      userId: specId,
    });
    expect(res.status).toBe(200);

    // The next mutation is now accepted and broadcast as a cellSet.
    client.sendJson(placeLetter(0, "A"));
    const cellSet = (await client.waitForType("cellSet")) as { cell: number };
    expect(cellSet.cell).toBe(0);
    client.close();
  });
});

describe("abandon via membership-changed (INV-4; DESIGN.md §6, §7)", () => {
  it("abandons a live actor: gameAbandoned broadcast and flushed before broadcast (INV-3-style)", async () => {
    const hostId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: hostId, role: "host" }],
    });
    const { client } = await connectAndHello(gameId, hostId);

    const res = await postMembershipChanged(gameId, {
      change: "abandon",
      by: hostId,
    });
    expect(res.status).toBe(200);

    const abandoned = (await client.waitForType("gameAbandoned")) as {
      by: string;
      seq: number;
      at: string;
    };
    expect(abandoned.by).toBe(hostId);
    expect(abandoned.seq).toBeGreaterThanOrEqual(1);

    // Persisted before broadcast: the game_state row is already abandoned (DESIGN.md §6).
    const gs = await loadGameState(adminPool, gameId);
    expect(gs?.status).toBe("abandoned");
    expect(gs?.abandonedAt).not.toBeNull();
    client.close();
  });

  it("hydrates a passivated game on demand to abandon it (DESIGN.md §6)", async () => {
    // No connection was ever made, so no actor is live. Abandon must hydrate one on demand,
    // since only the actor may write game_state (DESIGN.md §6).
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: randomUUID(), role: "host" }],
    });
    expect(await loadGameState(adminPool, gameId)).toBeNull();

    const res = await postMembershipChanged(gameId, {
      change: "abandon",
      by: randomUUID(),
    });
    expect(res.status).toBe(200);

    const gs = await loadGameState(adminPool, gameId);
    expect(gs?.status).toBe("abandoned");
    expect(gs?.lastSeq).toBe(1);
  });

  it("is a no-op on an already-terminal game (INV-4)", async () => {
    // A game already abandoned at seq 5 must not consume a new terminal seq or re-flush.
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: randomUUID(), role: "host" }],
      gameState: {
        board: [
          { v: null, by: null },
          { v: null, by: null },
          { v: null, by: null },
        ],
        lastSeq: 5,
        firstFillAt: "2026-07-08T00:00:00.000Z",
        status: "abandoned",
      },
    });

    const res = await postMembershipChanged(gameId, {
      change: "abandon",
      by: randomUUID(),
    });
    expect(res.status).toBe(200);

    const gs = await loadGameState(adminPool, gameId);
    expect(gs?.status).toBe("abandoned");
    expect(gs?.lastSeq).toBe(5); // no new terminal seq: the terminal state is final (INV-4)
  });
});

// Presence, cursors, and liveness (PROTOCOL.md §6, §9; DESIGN.md §8). The section 9 slice
// implemented server-side: playerConnected/playerDisconnected keyed on the user's first/last
// socket, cursor relay with a 10/s cap, and the 45 s idle reap (exercised with a small injected
// livenessTimeoutMs, never a real sleep).
describe("presence and liveness (PROTOCOL.md §6, §9)", () => {
  it("carries each participant's resolved avatarUrl on the welcome, null a first-class value (§4)", async () => {
    const withAvatarId = randomUUID();
    const noAvatarId = randomUUID();
    const avatar = "https://www.gravatar.com/avatar/deadbeef?d=404";
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: withAvatarId, role: "host", avatar },
        { userId: noAvatarId, role: "solver", avatar: null },
      ],
    });
    const conn = await connectAndHello(gameId, withAvatarId);
    const welcome = conn.welcome as unknown as {
      board: {
        participants: {
          userId: string;
          avatarUrl: string | null;
        }[];
      };
    };
    const byId = new Map(
      welcome.board.participants.map((p) => [p.userId, p.avatarUrl]),
    );
    expect(byId.get(withAvatarId)).toBe(avatar);
    // A member with no avatar surfaces null, not a missing field: the clients render their initial.
    expect(byId.get(noAvatarId)).toBeNull();
    conn.client.close();
  });

  it("broadcasts playerConnected to the other connections, not to the joiner (§6, §9)", async () => {
    const hostId = randomUUID();
    const joinerId = randomUUID();
    const joinerAvatar = "https://cdn.discordapp.com/avatars/joiner.png";
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: hostId, role: "host" },
        { userId: joinerId, role: "solver", avatar: joinerAvatar },
      ],
    });
    const host = await connectAndHello(gameId, hostId);
    const joiner = await connectAndHello(gameId, joinerId);

    // The already-connected host learns the joiner arrived, with the display-name-and-avatar grant,
    // the deterministic color, and the joiner's role. avatarUrl is the resolved URL the API mirrored
    // into users.avatar; the session relays it opaquely (PROTOCOL.md §4, §6).
    const connected = (await host.client.waitForType("playerConnected")) as {
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      color: string;
      role: string;
    };
    expect(connected.userId).toBe(joinerId);
    expect(connected.role).toBe("solver");
    expect(typeof connected.displayName).toBe("string");
    expect(connected.avatarUrl).toBe(joinerAvatar);
    expect(connected.color).toMatch(/^#[0-9A-F]{6}$/);

    // The joiner is never told about itself: its participant list came in its own welcome. A
    // requestSync round-trip is a happens-after barrier; by the time sync lands, any (buggy)
    // self-directed playerConnected would already have arrived.
    joiner.client.sendJson({ type: "requestSync" });
    await joiner.client.waitForType("sync");
    expect(joiner.client.ofType("playerConnected")).toHaveLength(0);

    host.client.close();
    joiner.client.close();
  });

  it("broadcasts playerDisconnected when the user's last socket closes (§6, §9)", async () => {
    const hostId = randomUUID();
    const joinerId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: hostId, role: "host" },
        { userId: joinerId, role: "solver" },
      ],
    });
    const host = await connectAndHello(gameId, hostId);
    const joiner = await connectAndHello(gameId, joinerId);
    await host.client.waitForType("playerConnected");

    joiner.client.close();
    const gone = (await host.client.waitForType("playerDisconnected")) as {
      userId: string;
    };
    expect(gone.userId).toBe(joinerId);
    host.client.close();
  });

  it("a second socket for the same user broadcasts neither connect nor disconnect (§9 first/last socket)", async () => {
    const observerId = randomUUID();
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: observerId, role: "host" },
        { userId, role: "solver" },
      ],
    });
    const observer = await connectAndHello(gameId, observerId);
    const first = await connectAndHello(gameId, userId);
    await observer.client.waitForType("playerConnected"); // exactly one connect so far

    // A second socket for the same user announces nothing (it is not the first socket)...
    const second = await connectAndHello(gameId, userId);
    // ...and closing it disconnects nothing (the first socket still holds the user live).
    second.client.close();
    await second.client.waitForClose();

    // Barrier: the user's first socket writes a cell; when the observer sees the cellSet, every
    // prior presence broadcast (if any escaped) has already been delivered in order.
    first.client.sendJson(placeLetter(0, "A"));
    await observer.client.waitForType("cellSet");
    expect(observer.client.ofType("playerConnected")).toHaveLength(1);
    expect(observer.client.ofType("playerDisconnected")).toHaveLength(0);

    observer.client.close();
    first.client.close();
  });

  it("relays a cursor to the other connections and drops beyond 10 per second (§9)", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);

    // Fire 15 cursors in one tight window; at most 10 relay to the other socket (§9).
    for (let i = 0; i < 15; i++) {
      a.client.sendJson({
        type: "moveCursor",
        cell: i % 3,
        direction: "across",
      });
    }
    // Barrier: once b sees a's cellSet, all of a's earlier frames have been processed in order.
    a.client.sendJson(placeLetter(0, "A"));
    await b.client.waitForType("cellSet");

    const cursors = b.client.ofType("cursor");
    expect(cursors).toHaveLength(10);
    expect(cursors[0]).toMatchObject({ userId: aId, direction: "across" });
    // The sender never receives its own cursor back (broadcastExcept the origin).
    expect(a.client.ofType("cursor")).toHaveLength(0);

    a.client.close();
    b.client.close();
  });

  it("records a connected user's cursor so the next snapshot carries it (§4, §9)", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);
    await a.client.waitForType("playerConnected");

    // A moves; the relay to b is a happens-after barrier that the actor has recorded the cursor.
    a.client.sendJson({ type: "moveCursor", cell: 2, direction: "across" });
    const relayed = (await b.client.waitForType("cursor")) as {
      userId: string;
      cell: number;
      direction: string;
    };
    expect(relayed).toMatchObject({
      userId: aId,
      cell: 2,
      direction: "across",
    });

    // A fresh resync snapshot to b carries a's current cursor, not an empty array (§4, §9).
    b.client.sendJson({ type: "requestSync" });
    const sync = (await b.client.waitForType("sync")) as SyncMessage;
    expect(sync.board.cursors).toContainEqual({
      userId: aId,
      cell: 2,
      direction: "across",
    });

    a.client.close();
    b.client.close();
  });

  it("drops a moveCursor whose cell is out of range or a black square, silently (§9)", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      // Cell 1 is a black square; the grid has 3 cells (indices 0..2).
      snapshot: puzzle(1, 3, [1], ["A", null, "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);
    await a.client.waitForType("playerConnected");

    a.client.sendJson({ type: "moveCursor", cell: 99, direction: "across" }); // out of range
    a.client.sendJson({ type: "moveCursor", cell: 1, direction: "across" }); // black square
    a.client.sendJson({ type: "moveCursor", cell: 2, direction: "across" }); // the one valid target
    // Barrier: once b sees a's cellSet, all of a's earlier frames have been processed in order.
    a.client.sendJson(placeLetter(0, "A"));
    await b.client.waitForType("cellSet");

    // Only the in-bounds, non-block cursor relayed; the two invalid ones were dropped silently.
    const cursors = b.client.ofType("cursor");
    expect(cursors).toHaveLength(1);
    expect(cursors[0]).toMatchObject({
      userId: aId,
      cell: 2,
      direction: "across",
    });

    // And no invalid cursor lingers in a snapshot.
    b.client.sendJson({ type: "requestSync" });
    const sync = (await b.client.waitForType("sync")) as SyncMessage;
    expect(sync.board.cursors).toEqual([
      { userId: aId, cell: 2, direction: "across" },
    ]);

    a.client.close();
    b.client.close();
  });

  it("clears a user's cursor from the snapshot when their last socket closes (§9)", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);
    await a.client.waitForType("playerConnected");

    a.client.sendJson({ type: "moveCursor", cell: 1, direction: "across" });
    await b.client.waitForType("cursor"); // a's cursor is recorded

    // A leaves; b learns via playerDisconnected, and the following snapshot carries no cursor for a.
    a.client.close();
    const gone = (await b.client.waitForType("playerDisconnected")) as {
      userId: string;
    };
    expect(gone.userId).toBe(aId);

    b.client.sendJson({ type: "requestSync" });
    const sync = (await b.client.waitForType("sync")) as SyncMessage;
    expect(sync.board.cursors).toEqual([]);

    b.client.close();
  });

  it("terminates an idle connection after the liveness window, broadcasting playerDisconnected (§9)", async () => {
    // A small injected liveness window exercises the 45 s reap without a real sleep in CI.
    const liveServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushIntervalMs: 600_000 },
      livenessTimeoutMs: 200,
    });
    try {
      const observerId = randomUUID();
      const idleId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [
          { userId: observerId, role: "host" },
          { userId: idleId, role: "solver" },
        ],
      });
      const observer = await connectAndHelloOn(liveServer, gameId, observerId);
      const idle = await connectAndHelloOn(liveServer, gameId, idleId);
      await observer.client.waitForType("playerConnected");

      // Keep the observer alive with heartbeats; the idle client sends nothing and is reaped,
      // and the reaped socket's close broadcasts the disconnect (§9).
      const beat = setInterval(
        () => observer.client.sendJson({ type: "heartbeat" }),
        60,
      );
      try {
        const gone = (await observer.client.waitForType(
          "playerDisconnected",
        )) as { userId: string };
        expect(gone.userId).toBe(idleId);
        await idle.client.waitForClose(); // the server terminated the idle socket
      } finally {
        clearInterval(beat);
      }
      observer.client.close();
    } finally {
      await liveServer.close();
    }
  });

  it("a heartbeat resets liveness, so an actively pinging client is not reaped (§9)", async () => {
    const liveServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushIntervalMs: 600_000 },
      livenessTimeoutMs: 200,
    });
    try {
      const observerId = randomUUID();
      const beaterId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [
          { userId: observerId, role: "host" },
          { userId: beaterId, role: "solver" },
        ],
      });
      const observer = await connectAndHelloOn(liveServer, gameId, observerId);
      const beater = await connectAndHelloOn(liveServer, gameId, beaterId);
      await observer.client.waitForType("playerConnected");

      // Both clients beat well inside the 200 ms window for ~600 ms (three windows). Every beat
      // resets the timer, so neither is reaped and no disconnect is seen.
      const obeat = setInterval(
        () => observer.client.sendJson({ type: "heartbeat" }),
        60,
      );
      const bbeat = setInterval(
        () => beater.client.sendJson({ type: "heartbeat" }),
        60,
      );
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(observer.client.ofType("playerDisconnected")).toHaveLength(0);
      clearInterval(bbeat);

      // The beater goes silent; the next idle window reaps it and the close path broadcasts.
      const gone = (await observer.client.waitForType(
        "playerDisconnected",
      )) as { userId: string };
      expect(gone.userId).toBe(beaterId);
      clearInterval(obeat);
      observer.client.close();
      beater.client.close();
    } finally {
      await liveServer.close();
    }
  });
});

// Ephemeral emoji reactions (PROTOCOL.md §9), the presence-family sibling of cursor relay: any
// role including spectators, best-effort with silent drops (unpublished emoji, bad cell, over-rate),
// fanned out to the others, never echoed to the sender, and recorded nowhere (no board.reactions).
describe("reactions relay (PROTOCOL.md §9)", () => {
  it("§9/D25: relays any single emoji grapheme, the new defaults and the retired-but-valid 🎉, and never echoes to the sender", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);

    // The allowlist is retired (D25): the gate takes any one emoji grapheme. Two new defaults (🔥
    // 🐐) relay, and so does 🎉, which was dropped from the defaults yet is still a valid emoji, so
    // it is sendable too. Any emoji is sendable; the personal set is a pure client preference.
    a.client.sendJson({ type: "react", emoji: "🔥", cell: 0 });
    a.client.sendJson({ type: "react", emoji: "🐐", cell: 1 });
    a.client.sendJson({ type: "react", emoji: "🎉", cell: 2 });
    const relayed = (await b.client.waitForCount("reaction", 3)) as Array<{
      userId: string;
      emoji: string;
      cell: number;
    }>;
    expect(
      relayed.map((r) => ({ userId: r.userId, emoji: r.emoji, cell: r.cell })),
    ).toEqual([
      { userId: aId, emoji: "🔥", cell: 0 },
      { userId: aId, emoji: "🐐", cell: 1 },
      { userId: aId, emoji: "🎉", cell: 2 },
    ]);

    // Barrier: once b sees a's cellSet, all of a's earlier frames (the reacts included) have been
    // processed in order, so any echo back to the sender would already have arrived.
    a.client.sendJson(placeLetter(0, "A"));
    await b.client.waitForType("cellSet");
    expect(a.client.ofType("reaction")).toHaveLength(0);

    a.client.close();
    b.client.close();
  });

  it("§9/D25: relays a multi-codepoint single grapheme within the byte bound (flag, skin tone, ZWJ sequence)", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);

    // Each `emoji` is ONE RGI grapheme spanning several code points, all within the 32-UTF-8-byte
    // bound: a regional-indicator flag (🇨🇦, 8 bytes), a skin-tone modifier sequence (👍🏽, 8 bytes),
    // and a ZWJ sequence (👨‍🌾, 11 bytes). `\p{RGI_Emoji}` matches the whole cluster, so each relays.
    a.client.sendJson({ type: "react", emoji: "🇨🇦", cell: 0 });
    a.client.sendJson({ type: "react", emoji: "👍🏽", cell: 1 });
    a.client.sendJson({ type: "react", emoji: "👨‍🌾", cell: 2 });
    const relayed = (await b.client.waitForCount("reaction", 3)) as Array<{
      userId: string;
      emoji: string;
      cell: number;
    }>;
    expect(relayed.map((r) => ({ emoji: r.emoji, cell: r.cell }))).toEqual([
      { emoji: "🇨🇦", cell: 0 },
      { emoji: "👍🏽", cell: 1 },
      { emoji: "👨‍🌾", cell: 2 },
    ]);

    a.client.close();
    b.client.close();
  });

  it("§9/D25: drops a non-emoji, a multi-grapheme send, a bad cell, and the codec-rejected shapes, each silently", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      // Cell 1 is a black square; the grid has 3 cells (indices 0..2).
      snapshot: puzzle(1, 3, [1], ["A", null, "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);
    await a.client.waitForType("playerConnected");

    // Send-gate drops (isSendableReaction: not exactly one RGI emoji grapheme), each on a VALID
    // cell so the emoji is the sole reason it fails:
    a.client.sendJson({ type: "react", emoji: "A", cell: 2 }); // a letter
    a.client.sendJson({ type: "react", emoji: "lol", cell: 2 }); // a word
    a.client.sendJson({ type: "react", emoji: "7", cell: 2 }); // a digit
    a.client.sendJson({ type: "react", emoji: "🔥🔥", cell: 2 }); // two graphemes, not one
    // ♥ (U+2665) is a text-presentation character with NO emoji variation selector, so
    // `\p{RGI_Emoji}` rejects it (verified against the toolchain; ♥️ = U+2665 U+FE0F WOULD pass).
    // The send gate drops it; it never relays.
    a.client.sendJson({ type: "react", emoji: "♥", cell: 2 });
    // These two die one layer earlier, at the codec (decodeClientMessage → asEmoji), never reaching
    // the send gate: an empty string fails the non-empty shape rule and a >32-UTF-8-byte string
    // fails the byte bound (PROTOCOL.md §9). The frame decodes as malformed and is dropped, no error.
    a.client.sendJson({ type: "react", emoji: "", cell: 2 }); // empty: codec rejects
    a.client.sendJson({ type: "react", emoji: "🔥".repeat(9), cell: 2 }); // 36 bytes > 32: codec rejects

    // Cell-gate drops (isCursorTarget): a valid emoji on an out-of-range and on a black-square cell.
    a.client.sendJson({ type: "react", emoji: "🎉", cell: 99 }); // cell out of range
    a.client.sendJson({ type: "react", emoji: "🎉", cell: 1 }); // black square

    a.client.sendJson({ type: "react", emoji: "🎉", cell: 2 }); // the one fully valid react
    // Barrier: once b sees a's cellSet, all of a's earlier frames have been processed in order.
    a.client.sendJson(placeLetter(0, "A"));
    await b.client.waitForType("cellSet");

    // Only the valid react relayed; every drop above (send gate, codec, cell gate) vanished.
    const reactions = b.client.ofType("reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0]).toMatchObject({ userId: aId, emoji: "🎉", cell: 2 });
    // Every rejection is a silent drop: no error frame reaches the sender or the peer
    // (INVALID_CELL stays a mutation-only mapping; §9 defines no reaction error).
    expect(a.client.ofType("error")).toHaveLength(0);
    expect(b.client.ofType("error")).toHaveLength(0);

    a.client.close();
    b.client.close();
  });

  it("§9: drops the 6th react inside one second, relaying only the first 5", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);

    // Fire 6 valid reacts in one tight window; at most 5 relay to the other socket (§9).
    for (let i = 0; i < 6; i++) {
      a.client.sendJson({ type: "react", emoji: "🎉", cell: 2 });
    }
    // Barrier: once b sees a's cellSet, all of a's earlier frames have been processed in order.
    a.client.sendJson(placeLetter(0, "A"));
    await b.client.waitForType("cellSet");

    const reactions = b.client.ofType("reaction");
    expect(reactions).toHaveLength(5);
    expect(reactions[0]).toMatchObject({ userId: aId, emoji: "🎉", cell: 2 });
    // The sender never receives its own reaction back (broadcastExcept the origin).
    expect(a.client.ofType("reaction")).toHaveLength(0);

    a.client.close();
    b.client.close();
  });

  it("§9: relays a spectator's react (no role gate; spectators react by design)", async () => {
    const spectatorId = randomUUID();
    const observerId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: observerId, role: "solver" },
        { userId: spectatorId, role: "spectator" },
      ],
    });
    const observer = await connectAndHello(gameId, observerId);
    const spectator = await connectAndHello(gameId, spectatorId);
    // The observer learns the spectator arrived; a happens-before for the react that follows.
    await observer.client.waitForType("playerConnected");

    spectator.client.sendJson({ type: "react", emoji: "🤔", cell: 1 });
    const relayed = (await observer.client.waitForType("reaction")) as {
      userId: string;
      emoji: string;
      cell: number;
    };
    expect(relayed).toMatchObject({
      userId: spectatorId,
      emoji: "🤔",
      cell: 1,
    });

    observer.client.close();
    spectator.client.close();
  });

  it("§9: still relays a react after gameCompleted (no GAME_NOT_ONGOING gate)", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    // 1x2, cell 0 pre-filled correctly; one cell left to complete (mirrors the INV-4 setup).
    const gameId = await seedGame({
      snapshot: puzzle(1, 2, [], ["A", "B"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
      gameState: {
        board: [
          { v: "A", by: aId },
          { v: null, by: null },
        ],
        lastSeq: 1,
        firstFillAt: "2026-07-08T00:00:00.000Z",
      },
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);

    a.client.sendJson(placeLetter(1, "B")); // completes the game
    await a.client.waitForType("gameCompleted");
    await b.client.waitForType("gameCompleted");

    // A mutation here would draw GAME_NOT_ONGOING (INV-4); a react must not, so it still relays.
    a.client.sendJson({ type: "react", emoji: "💀", cell: 0 });
    const relayed = (await b.client.waitForType("reaction")) as {
      userId: string;
      emoji: string;
      cell: number;
    };
    expect(relayed).toMatchObject({ userId: aId, emoji: "💀", cell: 0 });

    // Barrier: a sync round-trip to b flushes any (buggy) error the react might have produced.
    b.client.sendJson({ type: "requestSync" });
    await b.client.waitForType("sync");
    expect(a.client.ofType("error")).toHaveLength(0);

    a.client.close();
    b.client.close();
  });

  it("§9: a snapshot after reactions carries no reaction trace (there is no board.reactions)", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: aId, role: "solver" },
        { userId: bId, role: "solver" },
      ],
    });
    const a = await connectAndHello(gameId, aId);
    const b = await connectAndHello(gameId, bId);
    await a.client.waitForType("playerConnected");

    // A baseline snapshot before any reaction.
    b.client.sendJson({ type: "requestSync" });
    const before = (await b.client.waitForType("sync")) as SyncMessage;
    const beforeKeys = Object.keys(before.board).sort();

    // A burst of valid reactions both ways; the cross-relays are a barrier that both were handled.
    a.client.sendJson({ type: "react", emoji: "🎉", cell: 0 });
    b.client.sendJson({ type: "react", emoji: "🫡", cell: 2 });
    await a.client.waitForType("reaction");
    await b.client.waitForType("reaction");

    // A fresh snapshot afterward is byte-identical in shape: same board keys, no reactions field,
    // and the whole board deep-equals the baseline (reactions record nothing, unlike cursors).
    b.client.sendJson({ type: "requestSync" });
    const syncs = (await b.client.waitForCount("sync", 2)) as SyncMessage[];
    const after = syncs[1]!;
    expect(Object.keys(after.board).sort()).toEqual(beforeKeys);
    expect(after.board).not.toHaveProperty("reactions");
    expect(after.board).toEqual(before.board);
    // And no reaction leaks into the serialized frame at all.
    expect(b.client.rawOfType("sync")[1]).not.toContain("reaction");

    a.client.close();
    b.client.close();
  });
});

// The Live Activity token-read path (PROTOCOL.md "Live Activity push"; migration 0007). Folded into
// this suite so there is still ONE Testcontainers boot per package: two container suites in one
// vitest run race the Testcontainers reaper. The emitter reads live_activity_tokens under the
// crossy_session SELECT grant, filtered by the created_at TTL window; the API is the single writer
// (INV-7), so the session role must not be able to write it.
describe("live_activity_tokens read under the session SELECT grant (0007, §12a)", () => {
  /** Insert a token row as the API would (admin pool), with an explicit created_at for the TTL test. */
  async function seedToken(
    gameId: string,
    userId: string,
    token: string,
    environment: "sandbox" | "production",
    createdAt: Date,
  ): Promise<void> {
    await adminPool.query(
      "insert into users (user_id, display_name) values ($1, $2) on conflict do nothing",
      [userId, "Member"],
    );
    await adminPool.query(
      `insert into live_activity_tokens (token, user_id, game_id, apns_environment, created_at)
       values ($1, $2, $3, $4, $5)`,
      [token, userId, gameId, environment, createdAt.toISOString()],
    );
  }

  it("reads all fresh tokens for a game, in insertion order, under crossy_session (§12a)", async () => {
    const u1 = randomUUID();
    const u2 = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: u1, role: "solver" },
        { userId: u2, role: "solver" },
      ],
    });
    const nowMs = Date.now();
    await seedToken(gameId, u1, "tok-a", "sandbox", new Date(nowMs - 1000));
    await seedToken(gameId, u2, "tok-b", "production", new Date(nowMs - 500));
    const tokens = await loadLiveTokens(sessionPool, gameId, nowMs);
    expect(tokens).toEqual([
      { token: "tok-a", userId: u1, environment: "sandbox" },
      { token: "tok-b", userId: u2, environment: "production" },
    ]);
  });

  it("excludes a token older than the 12h TTL window (§12a lock-screen cap)", async () => {
    const uFresh = randomUUID();
    const uStale = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [
        { userId: uFresh, role: "solver" },
        { userId: uStale, role: "solver" },
      ],
    });
    const nowMs = Date.now();
    await seedToken(
      gameId,
      uFresh,
      "fresh",
      "sandbox",
      new Date(nowMs - 60_000),
    );
    // One second past the window: dead, must not be read (the reader filters, no sweeper needed).
    await seedToken(
      gameId,
      uStale,
      "stale",
      "sandbox",
      new Date(nowMs - LIVE_ACTIVITY_MAX_AGE_MS - 1000),
    );
    const tokens = await loadLiveTokens(sessionPool, gameId, nowMs);
    expect(tokens.map((t) => t.token)).toEqual(["fresh"]);
  });

  it("scopes the read to the game: another game's tokens never leak in (§12a)", async () => {
    const uA = randomUUID();
    const uB = randomUUID();
    const gameA = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: uA, role: "solver" }],
    });
    const gameB = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId: uB, role: "solver" }],
    });
    const nowMs = Date.now();
    await seedToken(gameA, uA, "a-tok", "sandbox", new Date(nowMs));
    await seedToken(gameB, uB, "b-tok", "sandbox", new Date(nowMs));
    const tokens = await loadLiveTokens(sessionPool, gameA, nowMs);
    expect(tokens.map((t) => t.token)).toEqual(["a-tok"]);
  });

  it("the session role cannot write live_activity_tokens: it reads, never mutates (INV-7)", async () => {
    // The registry is api-owned (single writer crossy_api). The session holds SELECT only, so an
    // INSERT under the session role is refused at the grant layer, the same shape this suite proves
    // for the other api-owned tables.
    const userId = randomUUID();
    const gameId = await seedGame({
      snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
      members: [{ userId, role: "solver" }],
    });
    await expect(
      sessionPool.query(
        `insert into live_activity_tokens (token, user_id, game_id, apns_environment)
         values ($1, $2, $3, $4)`,
        ["nope", userId, gameId, "sandbox"],
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Track D observability: socket closes are logged and a flush fault never crashes the actor", () => {
  /** A recording analytics port: captures every event without a network (the noop shape). */
  function recordingAnalytics(): {
    analytics: Analytics;
    events: AnalyticsEvent[];
  } {
    const events: AnalyticsEvent[] = [];
    return {
      analytics: {
        capture: (event) => events.push(event),
        shutdown: () => Promise.resolve(),
      },
      events,
    };
  }

  /** Poll a spy until one of its calls' first arg contains `substr`, or fail loudly. */
  async function waitForLog(
    spy: ReturnType<typeof vi.spyOn>,
    substr: string,
  ): Promise<string> {
    for (let i = 0; i < 200; i++) {
      const hit = spy.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes(substr),
      );
      if (hit !== undefined) return hit[0] as string;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `no log line containing ${JSON.stringify(substr)} was emitted`,
    );
  }

  it("logs a submit fault and keeps the actor and socket alive when a mutation's flush rejects", async () => {
    // Threshold 1 makes every mutation flush inline, awaited inside the mailbox task, so a flush
    // rejection propagates out of actor.submit exactly as the Postgres-fault path does in
    // production. Before the server-side .catch this was an unhandled rejection that exits Node.
    const faultServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      actorOptions: { flushEventThreshold: 1, flushIntervalMs: 600_000 },
    });
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const userId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [{ userId, role: "solver" }],
      });
      // Connect first, so the actor hydrates at seq 0 (no game_state row yet).
      const { client } = await connectAndHelloOn(faultServer, gameId, userId);

      // Now plant a NEWER game_state row (last_seq 100). The actor's flush of seq 1 will trip the
      // single-writer guard (SnapshotRegressionError), the same shape as a stale-writer fault.
      await adminPool.query(
        `insert into game_state (game_id, status, board, last_seq, first_fill_at)
         values ($1, 'ongoing', $2::jsonb, 100, $3)`,
        [
          gameId,
          JSON.stringify({
            cells: [
              { v: null, by: null },
              { v: null, by: null },
              { v: null, by: null },
            ],
            checkedWrongCells: [],
            checkCount: 0,
          }),
          "2026-07-08T00:00:00.000Z",
        ],
      );

      // First mutation: applied and broadcast, then its flush rejects behind the broadcast.
      client.sendJson(placeLetter(0, "A"));
      const first = (await client.waitForType("cellSet")) as { seq: number };
      expect(first.seq).toBe(1);

      // The fault is logged with ids only (INV-6: no cell value in the line), and it names submit.
      const line = await waitForLog(errSpy, "submit fault");
      expect(line).toContain(gameId);
      expect(line).toContain("placeLetter");

      // The socket and actor survive: a second mutation still applies and broadcasts (the frame
      // handler never rejected, the actor was never killed), and the actor is still cached.
      client.sendJson(placeLetter(1, "B"));
      const both = (await client.waitForCount("cellSet", 2)) as Array<{
        seq: number;
      }>;
      expect(both.map((m) => m.seq)).toEqual([1, 2]);
      expect(faultServer.liveActorCount()).toBe(1);

      client.close();
    } finally {
      errSpy.mockRestore();
      await faultServer.close();
    }
  });

  it("logs one structured close line with the code and captures socket_closed on socket close", async () => {
    const { analytics, events } = recordingAnalytics();
    const closeServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      analytics,
    });
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    try {
      const userId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [{ userId, role: "solver" }],
      });
      const { client } = await connectAndHelloOn(closeServer, gameId, userId);
      client.close();

      const line = await waitForLog(infoSpy, "session: socket closed");
      expect(line).toContain(gameId);
      expect(line).toContain(`user=${userId}`);
      expect(line).toMatch(/code=\d+/);
      expect(line).toContain("wasLast=true");
      expect(line).toContain("livenessFired=false");

      // socket_closed rides beside the close line: flat scalars, ids and counts only (INV-6).
      const closed = events.find((e) => e.event === "socket_closed");
      expect(closed).toBeDefined();
      expect(closed!.distinctId).toBe(userId);
      expect(closed!.properties).toMatchObject({
        roomId: gameId,
        wasLast: true,
        livenessFired: false,
      });
      expect(typeof closed!.properties!["closeCode"]).toBe("number");
      expect(typeof closed!.properties!["socketAgeMs"]).toBe("number");
    } finally {
      infoSpy.mockRestore();
      await closeServer.close();
    }
  });

  it("marks a liveness reap distinctly and reports livenessFired on the close line", async () => {
    const { analytics, events } = recordingAnalytics();
    const reapServer = await createSessionServer({
      authPort: auth,
      pool: sessionPool,
      analytics,
      livenessTimeoutMs: 60,
    });
    const infoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    try {
      const userId = randomUUID();
      const gameId = await seedGame({
        snapshot: puzzle(1, 3, [], ["A", "B", "C"]),
        members: [{ userId, role: "solver" }],
      });
      const { client } = await connectAndHelloOn(reapServer, gameId, userId);

      // Send nothing: the liveness timer terminates the socket (the 1006 edge-reap shape). The
      // reap is greppable apart from a client close, and the close line reports the flag.
      const reap = await waitForLog(infoSpy, "session: liveness reap");
      expect(reap).toContain(gameId);
      const closeLine = await waitForLog(infoSpy, "session: socket closed");
      expect(closeLine).toContain("livenessFired=true");

      const closed = events.find((e) => e.event === "socket_closed");
      expect(closed?.properties).toMatchObject({ livenessFired: true });

      client.close();
    } finally {
      infoSpy.mockRestore();
      await reapServer.close();
    }
  });
});
