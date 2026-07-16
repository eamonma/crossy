// INV-5 bounded-loss consistency, the one property that genuinely needs a real flush and
// rehydrate, so it runs against Testcontainers Postgres (the pattern from apps/session and
// packages/db). The in-process loops use an in-memory recorder; this one exercises the
// real write-behind transaction (writer.ts) and the real hydrate read path (repo.ts,
// hydrate.ts), because the "snapshot and log agree" guarantee is a property of that one
// transaction, not of a fake.
//
// No silent skip (repo rule, mirrored from apps/session and packages/db): if Docker is
// unreachable this suite FAILS with a clear message rather than skipping, because a skipped
// infrastructure test reads as a passing one.
//
// The shape of a run: drive a generated command stream, flush at a chosen point (seq S),
// drive MORE commands that stay in memory (the tail), then drop the actor (a hard crash).
// Rehydrate a fresh actor from the DB (seq S), assert the flushed snapshot equals a replay
// of the flushed log (internal consistency, INV-5), then reconnect every client and settle.
// Each client's welcome carries the lower seq S; it MUST roll back (PROTOCOL.md section 7)
// and re-send pending commands still inside the window, and all clients converge on the
// rehydrated state.

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { Pool } from "pg";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@crossy/db";
import { Sim, simUserId } from "./sim";
import type { SimClientSpec, SimPuzzle } from "./sim";
import { loadGameState, loadPuzzleSnapshot } from "../../apps/session/src/repo";
import { hydrateGame } from "../../apps/session/src/hydrate";
import { createPgPersistence } from "../../apps/session/src/writer";
import { assertConvergence } from "./asserts";
import { RUNS, simParams } from "./config";

const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;

// Grids too large for the bounded step count to fill, so no run accidentally completes and
// force-flushes the tail synchronously (which would defeat the "unflushed tail" premise).
const CRASH_PUZZLES: readonly SimPuzzle[] = [
  { rows: 5, cols: 5, blocks: [], solution: new Array<string>(25).fill("A") },
  {
    rows: 5,
    cols: 5,
    blocks: [0, 24],
    solution: makeSolution(25, [0, 24]),
  },
];

function makeSolution(n: number, blocks: number[]): (string | null)[] {
  const set = new Set(blocks);
  return Array.from({ length: n }, (_, i) => (set.has(i) ? null : "A"));
}

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
let adminPool: Pool;
let sessionPool: Pool;

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  } catch (cause) {
    throw new Error(
      "Testcontainers could not start Postgres. The INV-5 crash property requires a " +
        "running Docker daemon and does not skip when it is missing (repo rule: no silent " +
        "skips). Start Docker and re-run `pnpm test`.",
      { cause },
    );
  }
  const connectionString = container.getConnectionUri();
  await applyMigrations(connectionString);
  adminPool = new Pool({ connectionString });
  // Run as the least-privilege crossy_session role, exactly as the service does, so the
  // flush transaction is exercised against the real grants (INV-7).
  sessionPool = new Pool({
    connectionString,
    options: "-c role=crossy_session",
  });
  sessionPool.on("error", () => {
    // Swallow idle-client errors during teardown.
  });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await sessionPool?.end();
  await adminPool?.end();
  await container?.stop();
}, 60_000);

async function seedGame(
  puzzle: SimPuzzle,
  clientCount: number,
): Promise<string> {
  const gameId = randomUUID();
  const puzzleId = randomUUID();
  const hostId = randomUUID();
  await adminPool.query(
    "insert into users (user_id, display_name) values ($1, $2)",
    [hostId, "Host"],
  );
  for (let i = 0; i < clientCount; i++) {
    await adminPool.query(
      "insert into users (user_id, display_name) values ($1, $2) on conflict do nothing",
      [simUserId(i), `P${i}`],
    );
  }
  await adminPool.query(
    "insert into puzzles (puzzle_id, data) values ($1, $2::jsonb)",
    [puzzleId, JSON.stringify({ kind: "test" })],
  );
  await adminPool.query(
    `insert into games (game_id, puzzle_id, puzzle_snapshot, invite_code, created_by)
     values ($1, $2, $3::jsonb, $4, $5)`,
    [
      gameId,
      puzzleId,
      JSON.stringify({
        rows: puzzle.rows,
        cols: puzzle.cols,
        blocks: puzzle.blocks,
        solution: puzzle.solution,
      }),
      nextInviteCode(),
      hostId,
    ],
  );
  return gameId;
}

interface CrashStep {
  readonly kind: "place" | "clear" | "deliver";
  readonly client: number;
  readonly cell: number;
  readonly correct: boolean;
  readonly count: number;
}

function toAction(
  step: CrashStep,
  puzzle: SimPuzzle,
): import("./sim").RawAction {
  const solution = puzzle.solution[step.cell] ?? null;
  const value = step.correct && solution !== null ? solution : "Z";
  return {
    kind: step.kind,
    client: step.client,
    cell: step.cell,
    value,
    count: step.count,
  };
}

const crashArb = fc
  .tuple(fc.integer({ min: 2, max: 3 }), fc.constantFrom(...CRASH_PUZZLES))
  .chain(([clientCount, puzzle]) => {
    const numCells = puzzle.rows * puzzle.cols;
    const stepArb = fc.record({
      kind: fc.constantFrom<CrashStep["kind"]>(
        "place",
        "place",
        "place",
        "deliver",
        "clear",
      ),
      client: fc.integer({ min: 0, max: clientCount - 1 }),
      cell: fc.integer({ min: 0, max: numCells - 1 }),
      correct: fc.boolean(),
      count: fc.integer({ min: 1, max: 3 }),
    });
    return fc
      .record({
        first: fc.array(stepArb, { minLength: 1, maxLength: 10 }),
        second: fc.array(stepArb, { minLength: 1, maxLength: 6 }),
      })
      .map((program) => ({ clientCount, puzzle, ...program }));
  });

/** Replay the flushed log into a board and confirm it equals the flushed snapshot (INV-5). */
function assertSnapshotEqualsLogReplay(
  board: readonly { v: string | null; by: string | null }[],
  events: readonly {
    seq: number;
    cell: number;
    value: string | null;
    by: string;
  }[],
): void {
  const replay = new Map<number, { v: string | null; by: string }>();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    replay.set(event.cell, { v: event.value, by: event.by });
  }
  board.forEach((cell, index) => {
    const fromLog = replay.get(index);
    const expectedV = fromLog?.v ?? null;
    if (cell.v !== expectedV) {
      throw new Error(
        `INV-5 torn state: snapshot cell ${index} = ${JSON.stringify(
          cell.v,
        )} but log replay = ${JSON.stringify(expectedV)}`,
      );
    }
  });
}

describe("INV-5 bounded-loss consistency (Testcontainers Postgres)", () => {
  it("INV-5 rehydrates a consistent snapshot-plus-log pair and clients converge via the section 7 rollback", async () => {
    await fc.assert(
      fc.asyncProperty(
        crashArb,
        async ({ clientCount, puzzle, first, second }) => {
          const gameId = await seedGame(puzzle, clientCount);
          const clients: SimClientSpec[] = Array.from(
            { length: clientCount },
            () => ({ role: "solver" as const }),
          );
          const sim = new Sim({
            puzzle,
            clients,
            gameId,
            persistence: createPgPersistence(sessionPool),
            // Huge thresholds: only the explicit drain flushes, so the tail stays in memory.
            actorOptions: {
              flushEventThreshold: 100_000,
              flushIntervalMs: 6_000_000,
            },
          });
          await sim.init();

          for (const step of first) await sim.step(toAction(step, puzzle));

          // Flush the snapshot plus log in one transaction at the current seq (the restore
          // point). Then drive the tail, which stays unflushed in actor memory.
          await sim.actor.drain();
          const flushedSeq = sim.serverBoard().seq;
          for (const step of second) await sim.step(toAction(step, puzzle));

          // Deliver everything so clients are caught up past the restore point before the
          // crash: this is what makes the rollback real (they applied seq > flushedSeq).
          for (const client of sim.clients) sim.deliver(client.index, 100_000);
          await sim.pump();
          const preCrashSeq = sim.serverBoard().seq;
          expect(flushedSeq).toBeLessThanOrEqual(preCrashSeq);

          const puzzleSnap = await loadPuzzleSnapshot(adminPool, gameId);
          const state = await loadGameState(adminPool, gameId);

          if (state === null) {
            // Nothing was ever accepted (every command hit a block or was invalid), so the
            // flush wrote no row: the restore point is the empty game at seq 0. Clients roll
            // back to it and converge, which is still exactly the INV-5 guarantee.
            expect(flushedSeq).toBe(0);
            sim.rehydrate(hydrateGame(puzzleSnap!, null));
            await sim.settle();
            assertConvergence(sim);
            return;
          }

          // Internal consistency of the flushed pair (INV-5): snapshot == replay of the log.
          expect(state.lastSeq).toBe(flushedSeq);
          const eventRows = await adminPool.query<{
            seq: string;
            cell: number;
            value: string | null;
            user_id: string;
          }>(
            "select seq, cell, value, user_id from cell_events where game_id = $1 order by seq",
            [gameId],
          );
          const events = eventRows.rows.map((r) => ({
            seq: Number(r.seq),
            cell: r.cell,
            value: r.value,
            by: r.user_id,
          }));
          // Contiguous from 1: the flushed log has no gaps (INV-2 at rest).
          expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
          // The stored board is the writer's object shape (cells plus check state, D27);
          // the cell/log consistency claim is about the cells.
          const storedBoard = state.board;
          assertSnapshotEqualsLogReplay(
            "cells" in storedBoard ? storedBoard.cells : storedBoard,
            events,
          );

          // Rehydrate a fresh actor from the DB and roll clients forward from there.
          const hydrated = hydrateGame(puzzleSnap!, state);
          expect(hydrated.boardState.seq).toBe(flushedSeq);
          sim.rehydrate(hydrated);
          await sim.settle();

          // Every client converged on the rehydrated (post-resend) state (INV-5, INV-10).
          assertConvergence(sim);
          // The restored seq never exceeded what clients had seen: loss is bounded, not gained.
          expect(sim.serverBoard().seq).toBeGreaterThanOrEqual(flushedSeq);
        },
      ),
      simParams(RUNS.postgres),
    );
  }, 120_000);
});
