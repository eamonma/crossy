/**
 * Core API walking-skeleton integration suite (ROADMAP Wave 2.1b; PROTOCOL.md §12;
 * DESIGN.md §7, §8, §9).
 *
 * Every endpoint is driven in-process through Hono's `app.request(...)`, so the suite opens
 * no socket and makes zero network calls: auth is the in-memory fake (real ES256 tokens, no
 * Supabase), and the database is a throwaway Testcontainers Postgres with the committed
 * migrations applied. The app's own connections run under the least-privilege `crossy_api`
 * role, so the migration grants are exercised for real: the API writes its five owned tables
 * and structurally cannot touch the session-owned ones (INV-7). A separate superuser
 * connection is used only for fixtures and inspection.
 *
 * No silent skips (repo rule): if Docker is unreachable the suite FAILS loudly.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@crossy/db";
import { createFakeAuthProvider } from "@crossy/auth";
import type { FakeAuthProvider } from "@crossy/auth";
import type { Hono } from "hono";
import { buildApp } from "./app";
import { createDb } from "./db/client";
import type { ApiEnv } from "./context";

const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;
const SESSION_WS_BASE = "wss://session.crossy.test";

// A minimal well-formed ServerPuzzle fixture: a 2x2 all-playable grid. Solutions are real
// A-Z letters so the stored (server-side) model is valid; the client view must drop them.
const FIXTURE = {
  rows: 2,
  cols: 2,
  blocks: [] as number[],
  circles: [] as number[],
  clues: {
    across: [
      { number: 1, text: "friendly opener", cellIndices: [0, 1] },
      { number: 3, text: "keyboard basics", cellIndices: [2, 3] },
    ],
    down: [
      { number: 1, text: "up top", cellIndices: [0, 2] },
      { number: 2, text: "and beside", cellIndices: [1, 3] },
    ],
  },
  solution: ["H", "I", "O", "N"],
};

let container: StartedPostgreSqlContainer;
let apiPool: Pool; // runs every query as the crossy_api role
let adminPool: Pool; // superuser: fixtures and inspection only
let auth: FakeAuthProvider;
let app: Hono<ApiEnv>;

/** True if `value` transitively contains `key`, at any depth. Used to prove INV-6. */
function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => k === key || hasKeyDeep(v, key),
    );
  }
  return false;
}

function bearer(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function postJson(
  path: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: bearer(token),
    body: JSON.stringify(body),
  });
}

/** Assert the JSON error body carries `code` (Fetch `Response.json()` is typed unknown). */
async function expectError(res: Response, code: string): Promise<void> {
  expect(((await res.json()) as { error: string }).error).toBe(code);
}

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  } catch (cause) {
    throw new Error(
      "Testcontainers could not start Postgres. This suite requires a running Docker " +
        "daemon and does not skip when it is missing (repo rule: no silent skips).",
      { cause },
    );
  }
  const connectionString = container.getConnectionUri();
  await applyMigrations(connectionString);

  // The app's pool: every connection assumes the crossy_api role at startup (the `role`
  // GUC, set via the connection options, is equivalent to SET ROLE for the session), so all
  // handler queries run under the least-privilege grants the migration created. This mirrors
  // production, where the login role already carries crossy_api's privileges.
  apiPool = new Pool({ connectionString, options: "-c role=crossy_api" });
  apiPool.on("error", () => {
    // Swallow idle-client errors during teardown.
  });

  adminPool = new Pool({ connectionString });

  auth = await createFakeAuthProvider();
  app = buildApp({
    db: createDb(apiPool),
    authPort: auth,
    sessionWsBase: SESSION_WS_BASE,
  });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await apiPool?.end();
  await adminPool?.end();
  await container?.stop();
}, 60_000);

describe("auth + JIT upsert (DESIGN.md §8; INV-7 users single writer)", () => {
  it("rejects a request with no bearer token as UNAUTHORIZED (PROTOCOL.md §12)", async () => {
    const res = await app.request("/puzzles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    await expectError(res, "UNAUTHORIZED");
  });

  it("rejects a token the AuthPort refuses as UNAUTHORIZED", async () => {
    const res = await postJson("/puzzles", await auth.mintExpired(), FIXTURE);
    expect(res.status).toBe(401);
    await expectError(res, "UNAUTHORIZED");
  });

  it("mirrors an authenticated identity into users on the first request (JIT upsert)", async () => {
    const sub = randomUUID();
    // The upsert runs in the middleware, before the handler; a successful ingest confirms it.
    await postJson("/puzzles", await auth.mintUpgraded({ sub }), FIXTURE);
    const { rows } = await adminPool.query(
      "select is_anonymous from users where user_id = $1",
      [sub],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_anonymous).toBe(false);
  });

  it("upgrades a guest to a full account in place, keeping the same user_id (DESIGN.md §8)", async () => {
    const sub = randomUUID();
    // A guest request is upserted (is_anonymous true) even though the handler forbids it.
    await postJson("/puzzles", await auth.mintAnonymous({ sub }), FIXTURE);
    let { rows } = await adminPool.query(
      "select is_anonymous from users where user_id = $1",
      [sub],
    );
    expect(rows[0].is_anonymous).toBe(true);
    // A later permanent token flips the mirror to false, in place.
    await postJson("/puzzles", await auth.mintUpgraded({ sub }), FIXTURE);
    ({ rows } = await adminPool.query(
      "select is_anonymous from users where user_id = $1",
      [sub],
    ));
    expect(rows[0].is_anonymous).toBe(false);
  });

  it("never reverts a permanent user to a guest on a stale pre-upgrade token (SP1 lag, monotonic)", async () => {
    const sub = randomUUID();
    await postJson("/puzzles", await auth.mintUpgraded({ sub }), FIXTURE);
    // The one-token-lifetime lag: a still-valid pre-upgrade token reads is_anonymous:true.
    await postJson(
      "/puzzles",
      await auth.mintUnrefreshedUpgrade({ sub }),
      FIXTURE,
    );
    const { rows } = await adminPool.query(
      "select is_anonymous from users where user_id = $1",
      [sub],
    );
    expect(rows[0].is_anonymous).toBe(false);
  });
});

describe("POST /puzzles (PROTOCOL.md §12; INV-6)", () => {
  it("ingests a fixture for a full account and stores the solution server-side", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, FIXTURE);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { puzzleId: string; puzzle: unknown };
    expect(body.puzzleId).toMatch(/^[0-9a-f-]{36}$/);
    // The stored ServerPuzzle carries the solution (server-side only).
    const { rows } = await adminPool.query(
      "select data from puzzles where puzzle_id = $1",
      [body.puzzleId],
    );
    expect(rows[0].data.solution).toEqual(["H", "I", "O", "N"]);
  });

  it("returns a ClientPuzzle view with no solution field anywhere (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, FIXTURE);
    const body = (await res.json()) as { puzzle: Record<string, unknown> };
    expect(hasKeyDeep(body.puzzle, "solution")).toBe(false);
    // The client-safe facts are present: geometry and clues survive the projection.
    expect(body.puzzle.rows).toBe(2);
    expect(body.puzzle.cols).toBe(2);
    expect(body.puzzle).toHaveProperty("clues");
  });

  it("forbids a guest from ingesting a puzzle (full account only, DESIGN.md §8)", async () => {
    const token = await auth.mintAnonymous();
    const res = await postJson("/puzzles", token, FIXTURE);
    expect(res.status).toBe(403);
    await expectError(res, "FULL_ACCOUNT_REQUIRED");
  });

  it("rejects a malformed fixture as VALIDATION", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, { rows: 2, cols: 2 });
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION");
  });
});
