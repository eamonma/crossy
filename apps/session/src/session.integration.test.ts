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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { WebSocket } from "ws";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@crossy/db";
import { createFakeAuthProvider } from "@crossy/auth";
import type { FakeAuthProvider } from "@crossy/auth";
import {
  decodeServerMessage,
  type Role,
  type ServerMessage,
} from "@crossy/protocol";
import type { CellSet } from "@crossy/engine";
import { createSessionServer } from "./server";
import type { SessionServer } from "./server";
import { flushToPostgres } from "./writer";
import type { StateSnapshot } from "./writer";
import { hydrateGame } from "./hydrate";
import { loadGameState, loadPuzzleSnapshot } from "./repo";

const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;

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

async function insertUser(userId: string, displayName: string): Promise<void> {
  await adminPool.query(
    "insert into users (user_id, display_name) values ($1, $2)",
    [userId, displayName],
  );
}

interface GameSpec {
  readonly snapshot: PuzzleSnapshot;
  readonly members: ReadonlyArray<{ userId: string; role: Role }>;
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
    await insertUser(member.userId, `Player-${member.userId.slice(0, 4)}`);
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
      flushToPostgres(sessionPool, gameId, events, poisoned),
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
      board: [
        { v: "A", by: userId },
        { v: null, by: null },
        { v: "C", by: userId },
      ],
      lastSeq: 2,
      firstFillAt: "2026-07-08T00:00:00.000Z",
      completedAt: null,
      abandonedAt: null,
      stats: null,
      recentCommandIds: ["c-1", "c-2"],
    };
    await flushToPostgres(sessionPool, gameId, events, snap);

    // Rehydrate via the same read path the actor uses on first connect.
    const loadedPuzzle = await loadPuzzleSnapshot(adminPool, gameId);
    const loadedState = await loadGameState(adminPool, gameId);
    const hydrated = hydrateGame(loadedPuzzle!, loadedState);
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

      const hydrated = hydrateGame(
        (await loadPuzzleSnapshot(adminPool, gameId))!,
        await loadGameState(adminPool, gameId),
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
});
