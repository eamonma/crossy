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
import type {
  ApiEnv,
  MembershipChange,
  MembershipNotifier,
  VendorIdentityPort,
} from "./context";

const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;
const SESSION_WS_BASE = "wss://session.crossy.test";

// A minimal well-formed XWord Info JSON fixture: a 2x2 all-playable grid. The grid holds the
// real A-Z solutions, so the stored (server-side) model is valid; the client view must drop them.
// Ingestion translates this into the internal ServerPuzzle (blocks, grid-derived clues with
// cellIndices, solution ["H","I","O","N"]); the numbering comes from the grid, not the file.
const FIXTURE = {
  size: { rows: 2, cols: 2 },
  grid: ["H", "I", "O", "N"],
  clues: {
    across: ["1. friendly opener", "3. keyboard basics"],
    down: ["1. up top", "2. and beside"],
  },
};

let container: StartedPostgreSqlContainer;
let apiPool: Pool; // runs every query as the crossy_api role
let adminPool: Pool; // superuser: fixtures and inspection only
let auth: FakeAuthProvider;
let app: Hono<ApiEnv>;

// Recording fakes for the injected ports (DESIGN.md §6, §8): the membership notifier and the
// vendor identity admin. They record calls in memory so the M3a suite proves the API's
// cross-service and vendor calls without a socket or a network hop. `notifyShouldFail` and
// `vendorShouldFail` model a downstream fault to exercise the degraded and error paths.
let notifyCalls: { gameId: string; change: MembershipChange }[] = [];
let notifyShouldFail = false;
let vendorDeletions: string[] = [];
let vendorShouldFail = false;

const membershipNotifier: MembershipNotifier = {
  async membershipChanged(gameId, change) {
    notifyCalls.push({ gameId, change });
    if (notifyShouldFail) throw new Error("session unreachable (test)");
  },
};
const vendorIdentity: VendorIdentityPort = {
  async deleteUser(userId) {
    if (vendorShouldFail) throw new Error("vendor delete failed (test)");
    vendorDeletions.push(userId);
  },
};

/** Reset the recording fakes to a clean, non-failing state before a membership-lifecycle test. */
function resetRecorders(): void {
  notifyCalls = [];
  notifyShouldFail = false;
  vendorDeletions = [];
  vendorShouldFail = false;
}

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

async function get(path: string, token: string): Promise<Response> {
  return app.request(path, { method: "GET", headers: bearer(token) });
}

/** Assert the JSON error body carries `code` (Fetch `Response.json()` is typed unknown). */
async function expectError(res: Response, code: string): Promise<void> {
  expect(((await res.json()) as { error: string }).error).toBe(code);
}

/**
 * Assert a rejection response carries `status` and `code` and never leaks solution content
 * (INV-6): the body must have no `solution` key at any depth, and its raw text must not contain
 * the fixture's planted solution `marker`. Reads the body once as text, then parses it.
 */
async function expectRejectionNoLeak(
  res: Response,
  status: number,
  code: string,
  marker?: string,
): Promise<void> {
  expect(res.status).toBe(status);
  const text = await res.text();
  const body = JSON.parse(text) as Record<string, unknown>;
  expect(body["error"]).toBe(code);
  expect(hasKeyDeep(body, "solution")).toBe(false);
  if (marker !== undefined) expect(text).not.toContain(marker);
}

/** Read the `role` field from a JSON body. */
async function roleOf(res: Response): Promise<string> {
  return ((await res.json()) as { role: string }).role;
}

/** Ingest the fixture puzzle as `token`'s owner; return its id. */
async function ingestFixture(token: string): Promise<string> {
  const res = await postJson("/puzzles", token, FIXTURE);
  expect(res.status).toBe(201);
  return ((await res.json()) as { puzzleId: string }).puzzleId;
}

/** Create a game from `puzzleId` as `token`'s owner; return its id, invite code, and name. */
async function createGame(
  token: string,
  puzzleId: string,
): Promise<{ gameId: string; inviteCode: string; name: string | null }> {
  const res = await postJson("/games", token, { puzzleId });
  expect(res.status).toBe(201);
  return (await res.json()) as {
    gameId: string;
    inviteCode: string;
    name: string | null;
  };
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
    membershipNotifier,
    vendorIdentity,
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

  it("mirrors the token's display name into users.display_name (DESIGN.md §8; INV-7)", async () => {
    const sub = randomUUID();
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada" } }),
      FIXTURE,
    );
    const { rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    );
    expect(rows[0].display_name).toBe("Ada");
  });

  it("mirrors an anonymous user with no name as the Guest default (DESIGN.md §8; INV-7)", async () => {
    const sub = randomUUID();
    await postJson("/puzzles", await auth.mintAnonymous({ sub }), FIXTURE);
    const { rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    );
    expect(rows[0].display_name).toBe("Guest");
  });

  it("never clobbers a known display name with a token that omits metadata (coalesce; INV-7)", async () => {
    const sub = randomUUID();
    // First request carries a Discord name.
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada" } }),
      FIXTURE,
    );
    // A later request from the same user with no metadata (e.g. the `?token=` dogfood path).
    await postJson("/puzzles", await auth.mintUpgraded({ sub }), FIXTURE);
    const { rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    );
    expect(rows[0].display_name).toBe("Ada");
  });

  it("propagates a changed provider display name on the next request (INV-7)", async () => {
    const sub = randomUUID();
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada" } }),
      FIXTURE,
    );
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada L." } }),
      FIXTURE,
    );
    const { rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    );
    expect(rows[0].display_name).toBe("Ada L.");
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

  it("rejects a malformed body as VALIDATION (not a well-formed XWord Info document)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, { rows: 2, cols: 2 });
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION");
  });
});

describe("POST /puzzles ingestion ACL (ROADMAP Phase 3 Track C, G1; SP5; INV-6)", () => {
  // The named rejections run through the real endpoint as the crossy_api role, so the wiring
  // from the ACL's stable code to its HTTP status is exercised, and every rejection path is
  // checked to never echo solution content (INV-6). The planted marker `MARKERWORD` is a valid
  // solution token; if any handler stringified the grid into the error it would surface here.
  const MARKER = "MARKERWORD";

  it("translates XWord Info with a block, a rebus, and circles, storing the server model and features", async () => {
    const token = await auth.mintUpgraded();
    const doc = {
      size: { rows: 3, cols: 3 },
      grid: ["STAR", "B", "C", "D", ".", "E", "F", "G", "H"],
      circles: [1, 0, 0, 0, 0, 0, 0, 0, 1],
      clues: {
        across: ["1. top", "3. bottom"],
        down: ["1. left", "2. right"],
      },
    };
    const res = await postJson("/puzzles", token, doc);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      puzzleId: string;
      puzzle: Record<string, unknown>;
    };
    // The client view is solution-stripped (INV-6) yet keeps geometry, circles, structured clues.
    expect(hasKeyDeep(body.puzzle, "solution")).toBe(false);
    expect(body.puzzle.blocks).toEqual([4]);
    expect(body.puzzle.circles).toEqual([0, 8]);
    expect(body.puzzle).toHaveProperty("clues");
    // The stored server model carries the solution and the grid-derived clue cellIndices.
    const { rows } = await adminPool.query(
      "select data, features from puzzles where puzzle_id = $1",
      [body.puzzleId],
    );
    expect(rows[0].data.solution).toEqual([
      "STAR",
      "B",
      "C",
      "D",
      null,
      "E",
      "F",
      "G",
      "H",
    ]);
    expect(rows[0].data.clues.across).toEqual([
      { number: 1, text: "top", cellIndices: [0, 1, 2] },
      { number: 3, text: "bottom", cellIndices: [6, 7, 8] },
    ]);
    expect(rows[0].features).toEqual({
      rebus: true,
      circles: true,
      shadedCircles: false,
    });
  });

  it("rejects an oversize grid as OVERSIZE_GRID (SP5 25x25 cap; INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      size: { rows: 26, cols: 26 },
      grid: [],
      clues: { across: [], down: [] },
    });
    await expectRejectionNoLeak(res, 422, "OVERSIZE_GRID");
  });

  it("rejects a zero-playable grid as DEGENERATE_GRID (DESIGN §7; INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      size: { rows: 2, cols: 2 },
      grid: [".", ".", ".", "."],
      clues: { across: [], down: [] },
    });
    await expectRejectionNoLeak(res, 422, "DEGENERATE_GRID");
  });

  it("rejects an over-cap rebus as REBUS_TOO_LONG with no solution leak (SP5; INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      size: { rows: 2, cols: 2 },
      grid: ["ABCDEFGHIJKLMNOP", MARKER, "O", "N"],
      clues: {
        across: ["1. friendly opener", "3. keyboard basics"],
        down: ["1. up top", "2. and beside"],
      },
    });
    await expectRejectionNoLeak(res, 422, "REBUS_TOO_LONG", MARKER);
  });

  it("rejects a whole-symbol cell as UNSOLVABLE_CELL with no solution leak (SP5; INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      size: { rows: 2, cols: 2 },
      grid: [MARKER, "/", "O", "N"],
      clues: {
        across: ["1. friendly opener", "3. keyboard basics"],
        down: ["1. up top", "2. and beside"],
      },
    });
    await expectRejectionNoLeak(res, 422, "UNSOLVABLE_CELL", MARKER);
  });

  it("rejects two clues for one slot as AMBIGUOUS_SOLUTION with no leak (SP5; INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      size: { rows: 2, cols: 2 },
      grid: [MARKER, "I", "O", "N"],
      clues: {
        across: ["1. clue a", "1. clue b"],
        down: ["1. up top", "2. and beside"],
      },
    });
    await expectRejectionNoLeak(res, 422, "AMBIGUOUS_SOLUTION", MARKER);
  });

  it("rejects a diagramless document as DIAGRAMLESS with no leak (D13; INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      size: { rows: 2, cols: 2 },
      grid: [MARKER, "I", "O", "N"],
      type: "diagramless",
      clues: {
        across: ["1. friendly opener", "3. keyboard basics"],
        down: ["1. up top", "2. and beside"],
      },
    });
    await expectRejectionNoLeak(res, 422, "DIAGRAMLESS", MARKER);
  });
});

describe("POST /games (PROTOCOL.md §12; DESIGN.md §7, §8; INV-7)", () => {
  it("creates a game, seats the creator as host, and denormalizes the snapshot", async () => {
    const token = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(token);
    const res = await postJson("/games", token, { puzzleId });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      gameId: string;
      inviteCode: string;
      role: string;
    };
    expect(body.role).toBe("host");
    expect(body.inviteCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    // Host membership row exists.
    const membership = await adminPool.query(
      "select role from memberships where game_id = $1",
      [body.gameId],
    );
    expect(membership.rows).toEqual([{ role: "host" }]);
    // The snapshot is the full ServerPuzzle, solution included (server-side, §9).
    const snap = await adminPool.query(
      "select puzzle_snapshot from games where game_id = $1",
      [body.gameId],
    );
    expect(snap.rows[0].puzzle_snapshot.solution).toEqual(["H", "I", "O", "N"]);
  });

  it("forbids a guest from creating a game (guests are join-only, DESIGN.md §8)", async () => {
    const token = await auth.mintAnonymous();
    const res = await postJson("/games", token, { puzzleId: randomUUID() });
    expect(res.status).toBe(403);
    await expectError(res, "FULL_ACCOUNT_REQUIRED");
  });

  it("returns PUZZLE_NOT_FOUND for an unknown puzzleId", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/games", token, { puzzleId: randomUUID() });
    expect(res.status).toBe(404);
    await expectError(res, "PUZZLE_NOT_FOUND");
  });

  it("does not create the session-owned game_state row (INV-7 single writer)", async () => {
    const token = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(token);
    const { gameId } = await createGame(token, puzzleId);
    // The API never writes game_state; the actor materializes it on first connect (§6).
    const state = await adminPool.query(
      "select 1 from game_state where game_id = $1",
      [gameId],
    );
    expect(state.rows).toHaveLength(0);
    // And the boundary is real at the grant layer: the api role cannot write game_state.
    await expect(
      apiPool.query("insert into game_state (game_id) values ($1)", [gameId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("accepts an optional trimmed name, persists it, and returns it in the response", async () => {
    const token = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(token);
    const res = await postJson("/games", token, {
      puzzleId,
      name: "  Sunday themeless  ",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { gameId: string; name: string | null };
    expect(body.name).toBe("Sunday themeless");
    const row = await adminPool.query(
      "select name from games where game_id = $1",
      [body.gameId],
    );
    expect(row.rows[0].name).toBe("Sunday themeless");
  });

  it("preserves a display name verbatim: INV-1 ASCII casing does not apply to names", async () => {
    // A game name is user content, never normalized or compared, so mixed case and
    // locale-sensitive letters survive exactly as typed (contrast the cell-value charset,
    // which INV-1 normalizes). This test defends that non-normalization.
    const token = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(token);
    const res = await postJson("/games", token, {
      puzzleId,
      name: "İstanbul Grid MiXeD",
    });
    const body = (await res.json()) as { name: string | null };
    expect(body.name).toBe("İstanbul Grid MiXeD");
  });

  it("treats an absent, null, or empty name as unnamed (null)", async () => {
    const token = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(token);
    for (const name of [undefined, null, "", "   "]) {
      const res = await postJson("/games", token, { puzzleId, name });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { name: string | null };
      expect(body.name).toBeNull();
    }
  });

  it("caps an over-long name rather than rejecting it (80-character bound)", async () => {
    const token = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(token);
    const res = await postJson("/games", token, {
      puzzleId,
      name: "x".repeat(200),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string | null };
    expect(body.name).toHaveLength(80);
  });

  it("rejects a non-string name as VALIDATION (the only name rejection)", async () => {
    const token = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(token);
    const res = await postJson("/games", token, { puzzleId, name: 42 });
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION");
  });
});

describe("POST /games/{id}/join (PROTOCOL.md §12; DESIGN.md §7, §8)", () => {
  it("lets a guest join by invite code, seated as spectator", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const guest = await auth.mintAnonymous();
    const res = await postJson(`/games/${gameId}/join`, guest, {
      code: inviteCode,
    });
    expect(res.status).toBe(200);
    expect(await roleOf(res)).toBe("spectator");
  });

  it("seats a new full account directly as solver, so a joiner plays at once (owner decision 2026-07-10; DESIGN.md §7, §8)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const joinerSub = randomUUID();
    const joiner = await auth.mintUpgraded({ sub: joinerSub });
    const res = await postJson(`/games/${gameId}/join`, joiner, {
      code: inviteCode,
    });
    expect(res.status).toBe(200);
    expect(await roleOf(res)).toBe("solver");
    // The seat is a real solver membership row, not a spectator awaiting an upgrade tap.
    const m = await adminPool.query(
      "select role from memberships where game_id=$1 and user_id=$2",
      [gameId, joinerSub],
    );
    expect(m.rows[0].role).toBe("solver");
  });

  it("rejects a wrong invite code as DENIED without leaking game existence", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const guest = await auth.mintAnonymous();
    const res = await postJson(`/games/${gameId}/join`, guest, {
      code: "WRONGXYZ",
    });
    expect(res.status).toBe(403);
    await expectError(res, "DENIED");
  });

  it("rejects a denylisted user even with the correct code (DESIGN.md §7)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const kickedSub = randomUUID();
    await adminPool.query(
      "insert into users (user_id, is_anonymous) values ($1, true)",
      [kickedSub],
    );
    await adminPool.query(
      "insert into game_denylist (game_id, user_id) values ($1, $2)",
      [gameId, kickedSub],
    );

    const res = await postJson(
      `/games/${gameId}/join`,
      await auth.mintAnonymous({ sub: kickedSub }),
      { code: inviteCode },
    );
    expect(res.status).toBe(403);
    await expectError(res, "DENIED");
  });

  it("returns GAME_NOT_FOUND for an unknown game", async () => {
    const res = await postJson(
      `/games/${randomUUID()}/join`,
      await auth.mintUpgraded(),
      { code: "ABCDEFGH" },
    );
    expect(res.status).toBe(404);
    await expectError(res, "GAME_NOT_FOUND");
  });

  it("is non-demoting: a host re-joining their own game keeps the host role", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const res = await postJson(`/games/${gameId}/join`, host, {
      code: inviteCode,
    });
    expect(res.status).toBe(200);
    expect(await roleOf(res)).toBe("host");
  });
});

describe("POST /games/join (join by invite code alone) (PROTOCOL.md §12; DESIGN.md §7, §8)", () => {
  it("seats a guest as spectator and returns the resolved gameId (the phone caller had only the code)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const guest = await auth.mintAnonymous({ sub: randomUUID() });
    const res = await postJson("/games/join", guest, { code: inviteCode });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gameId: string;
      userId: string;
      role: string;
    };
    // The caller did not know the gameId; the endpoint resolves and returns it.
    expect(body.gameId).toBe(gameId);
    expect(body.role).toBe("spectator");
    // The seat is real: a spectator membership row exists.
    const m = await adminPool.query(
      "select role from memberships where game_id=$1 and user_id=$2",
      [gameId, body.userId],
    );
    expect(m.rows[0].role).toBe("spectator");
  });

  it("seats a new full account as solver, not spectator (owner decision 2026-07-10)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const joiner = await auth.mintUpgraded({ sub: randomUUID() });
    const res = await postJson("/games/join", joiner, { code: inviteCode });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gameId: string; role: string };
    expect(body.gameId).toBe(gameId);
    expect(body.role).toBe("solver");
  });

  it("resolves a hand-typed lowercase code by ASCII-uppercasing the lookup (INV-1)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const guest = await auth.mintAnonymous({ sub: randomUUID() });
    const res = await postJson("/games/join", guest, {
      code: `  ${inviteCode.toLowerCase()}  `,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { gameId: string }).gameId).toBe(gameId);
  });

  it("refuses a denylisted user holding the correct code as DENIED, seating no one (order preserved; DESIGN.md §7)", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const kickedSub = randomUUID();
    await adminPool.query(
      "insert into users (user_id, is_anonymous) values ($1, true)",
      [kickedSub],
    );
    await adminPool.query(
      "insert into game_denylist (game_id, user_id) values ($1, $2)",
      [gameId, kickedSub],
    );

    const res = await postJson(
      "/games/join",
      await auth.mintAnonymous({ sub: kickedSub }),
      { code: inviteCode },
    );
    expect(res.status).toBe(403);
    await expectError(res, "DENIED");
    // Denylist refusal wins over the seat: no membership row was written.
    const m = await adminPool.query(
      "select 1 from memberships where game_id=$1 and user_id=$2",
      [gameId, kickedSub],
    );
    expect(m.rows).toHaveLength(0);
  });

  it("returns GAME_NOT_FOUND for a code that resolves to no game (the code is the lookup key)", async () => {
    const res = await postJson("/games/join", await auth.mintUpgraded(), {
      code: "ZZZZZZZZ",
    });
    expect(res.status).toBe(404);
    await expectError(res, "GAME_NOT_FOUND");
  });

  it("is idempotent and non-demoting: a host re-joining by code keeps the host role", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const res = await postJson("/games/join", host, { code: inviteCode });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { gameId: string; role: string };
    expect(body.gameId).toBe(gameId);
    expect(body.role).toBe("host");
  });

  it("rejects a missing or non-string code as VALIDATION", async () => {
    const token = await auth.mintUpgraded();
    const missing = await postJson("/games/join", token, {});
    expect(missing.status).toBe(400);
    await expectError(missing, "VALIDATION");
    const nonString = await postJson("/games/join", token, { code: 42 });
    expect(nonString.status).toBe(400);
    await expectError(nonString, "VALIDATION");
  });
});

describe("GET /games/{id} (PROTOCOL.md §12; INV-6)", () => {
  it("returns the game view to a member: puzzle, membership, and session endpoint", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const res = await get(`/games/${gameId}`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      gameId: string;
      puzzle: Record<string, unknown>;
      members: { role: string }[];
      session: { ws: string };
    };
    expect(body.gameId).toBe(gameId);
    expect(body.members.map((m) => m.role)).toContain("host");
    expect(body.session.ws).toBe(`${SESSION_WS_BASE}/games/${gameId}/ws`);
  });

  it("surfaces each member's resolved avatarUrl on the view (PROTOCOL.md §4, §12)", async () => {
    const hostSub = randomUUID();
    // A Discord avatar in metadata: the JIT upsert mirrors what the port resolved into users.avatar.
    const host = await auth.mintUpgraded({
      sub: hostSub,
      userMetadata: { avatar_url: "https://cdn.discordapp.com/avatars/h.png" },
    });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const res = await get(`/games/${gameId}`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: { userId: string; avatarUrl: string | null }[];
    };
    const hostMember = body.members.find((m) => m.userId === hostSub);
    expect(hostMember?.avatarUrl).toBe(
      "https://cdn.discordapp.com/avatars/h.png",
    );
  });

  it("resolves an email-only member to a Gravatar avatarUrl and never leaks the email (INV-6 spirit)", async () => {
    const hostSub = randomUUID();
    // No provider avatar, only an email: the port derives a Gravatar URL server-side and the API
    // mirrors it. The email must appear nowhere in the response body.
    const host = await auth.mintUpgraded({
      sub: hostSub,
      email: "ada@example.com",
    });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const res = await get(`/games/${gameId}`, host);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("ada@example.com");
    const body = JSON.parse(raw) as {
      members: { userId: string; avatarUrl: string | null }[];
    };
    const hostMember = body.members.find((m) => m.userId === hostSub);
    expect(hostMember?.avatarUrl).toMatch(
      /^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}\?d=404$/,
    );
  });

  it("resolves a member with no avatar and no email to a null avatarUrl (first-class null)", async () => {
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const res = await get(`/games/${gameId}`, host);
    const body = (await res.json()) as {
      members: { userId: string; avatarUrl: string | null }[];
    };
    expect(
      body.members.find((m) => m.userId === hostSub)?.avatarUrl,
    ).toBeNull();
  });

  it("never carries a solution field in the response (INV-6, structural)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const res = await get(`/games/${gameId}`, host);
    const body = (await res.json()) as { puzzle: Record<string, unknown> };
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(body.puzzle.rows).toBe(2);
    expect(body.puzzle).toHaveProperty("clues");
  });

  it("forbids a non-member authenticated user as NOT_PARTICIPANT", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const stranger = await auth.mintUpgraded({ sub: randomUUID() });
    const res = await get(`/games/${gameId}`, stranger);
    expect(res.status).toBe(403);
    await expectError(res, "NOT_PARTICIPANT");
  });

  it("shows a joined guest the view once they are a member", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const guestSub = randomUUID();
    const guest = await auth.mintAnonymous({ sub: guestSub });
    await postJson(`/games/${gameId}/join`, guest, { code: inviteCode });

    const res = await get(`/games/${gameId}`, guest);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: { userId: string }[] };
    expect(body.members.some((m) => m.userId === guestSub)).toBe(true);
  });

  it("returns GAME_NOT_FOUND for an unknown game", async () => {
    const res = await get(`/games/${randomUUID()}`, await auth.mintUpgraded());
    expect(res.status).toBe(404);
    await expectError(res, "GAME_NOT_FOUND");
  });

  it("returns the game name to a member (null when unnamed)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const named = await postJson("/games", host, {
      puzzleId,
      name: "Friday night",
    });
    const { gameId } = (await named.json()) as { gameId: string };
    const res = await get(`/games/${gameId}`, host);
    const body = (await res.json()) as { name: string | null };
    expect(body.name).toBe("Friday night");

    const { gameId: unnamedId } = await createGame(host, puzzleId);
    const unnamed = await get(`/games/${unnamedId}`, host);
    expect(((await unnamed.json()) as { name: string | null }).name).toBeNull();
  });

  it("returns the invite code to the host member, matching the created code", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const res = await get(`/games/${gameId}`, host);
    const body = (await res.json()) as { inviteCode?: string };
    expect(body.inviteCode).toBe(inviteCode);
  });

  it("returns the invite code to a spectator member: every member joined via it (DESIGN.md §7)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const guest = await auth.mintAnonymous({ sub: randomUUID() });
    const joinRes = await postJson(`/games/${gameId}/join`, guest, {
      code: inviteCode,
    });
    expect(await roleOf(joinRes)).toBe("spectator");

    const res = await get(`/games/${gameId}`, guest);
    const body = (await res.json()) as { inviteCode?: string };
    expect(body.inviteCode).toBe(inviteCode);
  });

  it("never returns the invite code to a non-member (NOT_PARTICIPANT, no code leak)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const stranger = await auth.mintUpgraded({ sub: randomUUID() });
    const res = await get(`/games/${gameId}`, stranger);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text)).not.toHaveProperty("inviteCode");
  });

  it("never returns the invite code to an unauthenticated caller (UNAUTHORIZED)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const res = await app.request(`/games/${gameId}`, { method: "GET" });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(JSON.parse(text)).not.toHaveProperty("inviteCode");
  });
});

/** DELETE a path as `token`'s owner. */
async function del(path: string, token: string): Promise<Response> {
  return app.request(path, { method: "DELETE", headers: bearer(token) });
}

/** Join `gameId` with an invite `code` as `token`'s owner. */
async function join(
  gameId: string,
  token: string,
  code: string,
): Promise<Response> {
  return postJson(`/games/${gameId}/join`, token, { code });
}

describe("kick (DELETE /games/{id}/members/{userId}) (PROTOCOL.md §12; DESIGN.md §7; INV-7)", () => {
  it("host kick removes the membership and writes the denylist in one transaction (INV-7)", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const memberSub = randomUUID();
    const member = await auth.mintUpgraded({ sub: memberSub });
    await join(gameId, member, inviteCode);

    const res = await del(`/games/${gameId}/members/${memberSub}`, host);
    expect(res.status).toBe(200);

    // The membership row is gone and the denylist row is written: one transaction, so a kicked
    // user is never in the "no membership yet not denied" half-state (INV-7 single writer).
    const m = await adminPool.query(
      "select 1 from memberships where game_id=$1 and user_id=$2",
      [gameId, memberSub],
    );
    expect(m.rows).toHaveLength(0);
    const d = await adminPool.query(
      "select 1 from game_denylist where game_id=$1 and user_id=$2",
      [gameId, memberSub],
    );
    expect(d.rows).toHaveLength(1);

    // The session was signaled to disconnect a live socket (DESIGN.md §6).
    expect(notifyCalls).toContainEqual({
      gameId,
      change: { change: "kick", userId: memberSub },
    });
  });

  it("a kicked account's join by invite code is refused DENIED (M3 exit line; INV-7)", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const memberSub = randomUUID();
    const member = await auth.mintUpgraded({ sub: memberSub });
    await join(gameId, member, inviteCode);
    await del(`/games/${gameId}/members/${memberSub}`, host);

    // The kicked user still holds the link; the denylist makes it dead (DESIGN.md §7).
    const rejoined = await join(gameId, member, inviteCode);
    expect(rejoined.status).toBe(403);
    await expectError(rejoined, "DENIED");
  });

  it("the host cannot kick themselves (FORBIDDEN; DESIGN.md §7)", async () => {
    resetRecorders();
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const res = await del(`/games/${gameId}/members/${hostSub}`, host);
    expect(res.status).toBe(403);
    await expectError(res, "FORBIDDEN");
  });

  it("a non-host member cannot kick (FORBIDDEN)", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const aSub = randomUUID();
    const bSub = randomUUID();
    await join(gameId, await auth.mintUpgraded({ sub: aSub }), inviteCode);
    await join(gameId, await auth.mintUpgraded({ sub: bSub }), inviteCode);
    const res = await del(
      `/games/${gameId}/members/${bSub}`,
      await auth.mintUpgraded({ sub: aSub }),
    );
    expect(res.status).toBe(403);
    await expectError(res, "FORBIDDEN");
  });

  it("kicking a non-member is NOT_PARTICIPANT", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const res = await del(`/games/${gameId}/members/${randomUUID()}`, host);
    expect(res.status).toBe(403);
    await expectError(res, "NOT_PARTICIPANT");
  });

  it("still denylists when the session notify fails (blast radius stays a disconnect; INV-7)", async () => {
    resetRecorders();
    notifyShouldFail = true;
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const memberSub = randomUUID();
    const member = await auth.mintUpgraded({ sub: memberSub });
    await join(gameId, member, inviteCode);

    // The DB write is authoritative, so a failed live-disconnect notify still succeeds; the
    // kicked user is refused at their next connect via the denylist regardless (DESIGN.md §6).
    const res = await del(`/games/${gameId}/members/${memberSub}`, host);
    expect(res.status).toBe(200);
    const d = await adminPool.query(
      "select 1 from game_denylist where game_id=$1 and user_id=$2",
      [gameId, memberSub],
    );
    expect(d.rows).toHaveLength(1);
  });

  it("returns GAME_NOT_FOUND for an unknown game", async () => {
    resetRecorders();
    const res = await del(
      `/games/${randomUUID()}/members/${randomUUID()}`,
      await auth.mintUpgraded(),
    );
    expect(res.status).toBe(404);
    await expectError(res, "GAME_NOT_FOUND");
  });
});

describe("role upgrade (POST /games/{id}/role) (PROTOCOL.md §12; DESIGN.md §8)", () => {
  it("a pre-existing spectator self-upgrades to solver, idempotently, signaling the session (DESIGN.md §8)", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    // A guest join seats a spectator (guests never seat solver, owner decision 2026-07-09);
    // the guest then upgrades their account in place (same user_id) and taps upgrade-to-solver.
    // Since a fresh full-account join now seats solver (owner decision 2026-07-10), this path
    // serves the pre-existing spectator and the former guest.
    const specSub = randomUUID();
    const joined = await join(
      gameId,
      await auth.mintAnonymous({ sub: specSub }),
      inviteCode,
    );
    expect(await roleOf(joined)).toBe("spectator");
    const spec = await auth.mintUpgraded({ sub: specSub });

    const res = await postJson(`/games/${gameId}/role`, spec, {
      role: "solver",
    });
    expect(res.status).toBe(200);
    expect(await roleOf(res)).toBe("solver");
    const m = await adminPool.query(
      "select role from memberships where game_id=$1 and user_id=$2",
      [gameId, specSub],
    );
    expect(m.rows[0].role).toBe("solver");
    expect(notifyCalls).toContainEqual({
      gameId,
      change: { change: "role", userId: specSub },
    });

    // Idempotent: a repeat is a no-op that neither writes nor notifies again.
    const before = notifyCalls.length;
    const again = await postJson(`/games/${gameId}/role`, spec, {
      role: "solver",
    });
    expect(await roleOf(again)).toBe("solver");
    expect(notifyCalls.length).toBe(before);
  });

  it("does not demote a host who calls the role endpoint (idempotent)", async () => {
    resetRecorders();
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const res = await postJson(`/games/${gameId}/role`, host, {
      role: "solver",
    });
    expect(res.status).toBe(200);
    expect(await roleOf(res)).toBe("host");
  });

  it("rejects a non-member with NOT_PARTICIPANT", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const res = await postJson(
      `/games/${gameId}/role`,
      await auth.mintUpgraded({ sub: randomUUID() }),
      { role: "solver" },
    );
    expect(res.status).toBe(403);
    await expectError(res, "NOT_PARTICIPANT");
  });

  it("rejects a target role other than solver with VALIDATION", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const spec = await auth.mintUpgraded({ sub: randomUUID() });
    await join(gameId, spec, inviteCode);
    const res = await postJson(`/games/${gameId}/role`, spec, { role: "host" });
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION");
  });

  it("rejects a guest's upgrade to solver with FULL_ACCOUNT_REQUIRED, leaving the spectator row unwritten (owner decision 2026-07-09; DESIGN.md §8)", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    // A guest may join and spectate exactly as today (200).
    const guestSub = randomUUID();
    const guest = await auth.mintAnonymous({ sub: guestSub });
    const joined = await join(gameId, guest, inviteCode);
    expect(joined.status).toBe(200);
    expect(await roleOf(joined)).toBe("spectator");

    // But the solver upgrade is refused with the create gate's exact code and status (403).
    // The gate runs before any write, so the row stays spectator and the session is not notified.
    const res = await postJson(`/games/${gameId}/role`, guest, {
      role: "solver",
    });
    expect(res.status).toBe(403);
    await expectError(res, "FULL_ACCOUNT_REQUIRED");
    const m = await adminPool.query(
      "select role from memberships where game_id=$1 and user_id=$2",
      [gameId, guestSub],
    );
    expect(m.rows[0].role).toBe("spectator");
    expect(notifyCalls.some((n) => n.change.change === "role")).toBe(false);
  });
});

describe("abandon (POST /games/{id}/abandon) (PROTOCOL.md §12; DESIGN.md §6, §7)", () => {
  it("host abandon authorizes and dispatches to the session (DESIGN.md §6)", async () => {
    resetRecorders();
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const res = await postJson(`/games/${gameId}/abandon`, host, {});
    expect(res.status).toBe(200);
    expect(notifyCalls).toContainEqual({
      gameId,
      change: { change: "abandon", by: hostSub },
    });
  });

  it("a non-host member cannot abandon (FORBIDDEN)", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const spec = await auth.mintUpgraded({ sub: randomUUID() });
    await join(gameId, spec, inviteCode);
    const res = await postJson(`/games/${gameId}/abandon`, spec, {});
    expect(res.status).toBe(403);
    await expectError(res, "FORBIDDEN");
  });

  it("returns INTERNAL when the required session notify fails (only the actor abandons)", async () => {
    resetRecorders();
    notifyShouldFail = true;
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const res = await postJson(`/games/${gameId}/abandon`, host, {});
    expect(res.status).toBe(500);
    await expectError(res, "INTERNAL");
  });
});

describe("account deletion + host succession (DELETE /account) (DESIGN.md §7, §8, §9; INV-1, INV-2, INV-7)", () => {
  it("tombstones the mirror row, keeps the id, and leaves cell_events contiguous (DESIGN.md §8, §9; INV-2)", async () => {
    resetRecorders();
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    // Give the host PII to scrub, and author two immutable events (session-owned, so seeded via
    // the superuser pool; the api role cannot write cell_events).
    await adminPool.query(
      "update users set display_name=$2, avatar=$3 where user_id=$1",
      [hostSub, "Ada", "avatar-url"],
    );
    await adminPool.query(
      "insert into cell_events (game_id, seq, cell, user_id, value) values ($1,1,0,$2,'H'),($1,2,1,$2,'I')",
      [gameId, hostSub],
    );

    const res = await del("/account", host);
    expect(res.status).toBe(200);

    // The mirror row survives with PII scrubbed and the stable id kept (renders "former
    // participant"), because INV-1 replay and INV-2 contiguity depend on the id (DESIGN.md §8).
    const u = await adminPool.query(
      "select user_id, display_name, avatar from users where user_id=$1",
      [hostSub],
    );
    expect(u.rows).toHaveLength(1);
    expect(u.rows[0].display_name).toBeNull();
    expect(u.rows[0].avatar).toBeNull();

    // The event log stays contiguous through deletion; attribution survives as the opaque id
    // (cell_events.user_id is ON DELETE NO ACTION and untouched, DESIGN.md §9; INV-2).
    const ev = await adminPool.query(
      "select seq, user_id from cell_events where game_id=$1 order by seq",
      [gameId],
    );
    expect(ev.rows.map((r) => Number(r.seq))).toEqual([1, 2]);
    expect(ev.rows.every((r) => r.user_id === hostSub)).toBe(true);

    // The vendor identity is removed through the injected port, with no network (DESIGN.md §8).
    expect(vendorDeletions).toContain(hostSub);
  });

  it("host succession passes to the earliest-joined remaining solver (DESIGN.md §7)", async () => {
    resetRecorders();
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const earlySub = randomUUID();
    const lateSub = randomUUID();
    // Two solvers with explicit joined_at so "earliest" is deterministic.
    for (const [sub, joinedAt] of [
      [earlySub, "2026-01-01T00:00:00Z"],
      [lateSub, "2026-01-02T00:00:00Z"],
    ] as const) {
      await adminPool.query(
        "insert into users (user_id, is_anonymous) values ($1, false)",
        [sub],
      );
      await adminPool.query(
        "insert into memberships (game_id, user_id, role, joined_at) values ($1,$2,'solver',$3)",
        [gameId, sub, joinedAt],
      );
    }

    const res = await del("/account", host);
    expect(res.status).toBe(200);

    const roles = await adminPool.query<{ user_id: string; role: string }>(
      "select user_id, role from memberships where game_id=$1",
      [gameId],
    );
    const byUser = new Map(roles.rows.map((r) => [r.user_id, r.role]));
    expect(byUser.get(earlySub)).toBe("host"); // earliest solver inherits the host role
    expect(byUser.get(lateSub)).toBe("solver");
    expect(byUser.has(hostSub)).toBe(false); // the departing host's membership is removed
    expect(notifyCalls.some((n) => n.change.change === "abandon")).toBe(false);
  });

  it("auto-abandons a game left with no eligible successor, so it is never unadministrable (DESIGN.md §7)", async () => {
    resetRecorders();
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    // Only a guest spectator remains: not eligible to inherit the host role. A guest join seats
    // spectator (a full account would now seat solver, owner decision 2026-07-10), and guests
    // never hold host or solver (owner decision 2026-07-09), so succession finds no successor
    // and the game auto-abandons (DESIGN.md §7, §8).
    const spec = await auth.mintAnonymous({ sub: randomUUID() });
    await join(gameId, spec, inviteCode);

    const res = await del("/account", host);
    expect(res.status).toBe(200);
    expect(notifyCalls).toContainEqual({
      gameId,
      change: { change: "abandon", by: hostSub },
    });
  });

  it("skips an anonymous solver in succession, never minting a guest host (owner decision 2026-07-09; DESIGN.md §7, §8)", async () => {
    resetRecorders();
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    // The earliest-joined remaining solver is a guest; a later solver is a full account. Absent
    // the guest gate, "earliest solver wins" would hand the host role to the guest.
    const guestSub = randomUUID();
    const fullSub = randomUUID();
    for (const [sub, anon, joinedAt] of [
      [guestSub, true, "2026-01-01T00:00:00Z"],
      [fullSub, false, "2026-01-02T00:00:00Z"],
    ] as const) {
      await adminPool.query(
        "insert into users (user_id, is_anonymous) values ($1, $2)",
        [sub, anon],
      );
      await adminPool.query(
        "insert into memberships (game_id, user_id, role, joined_at) values ($1,$2,'solver',$3)",
        [gameId, sub, joinedAt],
      );
    }

    const res = await del("/account", host);
    expect(res.status).toBe(200);

    const roles = await adminPool.query<{ user_id: string; role: string }>(
      "select user_id, role from memberships where game_id=$1",
      [gameId],
    );
    const byUser = new Map(roles.rows.map((r) => [r.user_id, r.role]));
    // The guest is skipped despite joining first; the full account inherits the host role.
    expect(byUser.get(fullSub)).toBe("host");
    expect(byUser.get(guestSub)).toBe("solver");
    expect(notifyCalls.some((n) => n.change.change === "abandon")).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------
// The signed-in home lists: GET /games and GET /puzzles (PROTOCOL.md §12; ROADMAP M4 surface).
// ------------------------------------------------------------------------------------------

/**
 * A rebus doc whose first solution cell plants a distinctive marker. If any list handler ever
 * stringified the stored puzzle (`puzzle_snapshot` or `data`, both solution-bearing) into its
 * response, the marker would surface in the serialized JSON. INV-6 asserts it never does.
 */
const LIST_MARKER = "MARKERWORD";
function markerDoc() {
  return {
    size: { rows: 2, cols: 2 },
    grid: [LIST_MARKER, "I", "O", "N"],
    clues: {
      across: ["1. friendly opener", "3. keyboard basics"],
      down: ["1. up top", "2. and beside"],
    },
  };
}

/** Force a row's created_at (superuser fixture) so ordering and cursor tests are deterministic. */
async function setGameCreatedAt(gameId: string, iso: string): Promise<void> {
  await adminPool.query("update games set created_at = $2 where game_id = $1", [
    gameId,
    iso,
  ]);
}
async function setPuzzleCreatedAt(
  puzzleId: string,
  iso: string,
): Promise<void> {
  await adminPool.query(
    "update puzzles set created_at = $2 where puzzle_id = $1",
    [puzzleId, iso],
  );
}

/**
 * Materialize a `game_state` row through the superuser fixture, standing in for the session
 * service (the real single writer of game_state, DESIGN.md §9). A non-null `completedAt` seeds a
 * completed game; null (the default) leaves it ongoing. The API reads this row under its
 * SELECT-only grant (migration 0005), never writes it, so this fixture is the only way a test can
 * put a game into a terminal state without a live actor.
 */
async function seedGameState(
  gameId: string,
  completedAt: string | null,
): Promise<void> {
  await adminPool.query(
    `insert into game_state (game_id, status, completed_at)
       values ($1, $2, $3)
     on conflict (game_id) do update set status = excluded.status, completed_at = excluded.completed_at`,
    [gameId, completedAt === null ? "ongoing" : "completed", completedAt],
  );
}

/**
 * Append a board event through the superuser fixture, standing in for the session service (the
 * real single writer of the append-only cell_events log, DESIGN.md §9). The event's `at` is the
 * server timestamp `GET /games` aggregates to `MAX(at) = lastActivityAt` for activity ordering
 * (PROTOCOL.md §12). `seq` must be unique per game; the caller supplies it. The value here is a
 * throwaway `A`: the API only ever reads `MAX(at)`, never the value (INV-6), so the letter is
 * immaterial to what the list surfaces. The API cannot write this table under its grant (the
 * negative half of the read-only assertion below), so the superuser pool is the only way a test
 * can plant activity without a live actor.
 */
async function seedCellEvent(
  gameId: string,
  userId: string,
  seq: number,
  at: string,
): Promise<void> {
  await adminPool.query(
    `insert into cell_events (game_id, seq, cell, user_id, value, at)
       values ($1, $2, 0, $3, 'A', $4)`,
    [gameId, seq, userId, at],
  );
}

interface GamesList {
  games: {
    gameId: string;
    name: string | null;
    role: string;
    createdAt: string;
    createdBy: string;
    memberCount: number;
    completedAt: string | null;
    lastActivityAt: string | null;
    puzzle: {
      puzzleId: string;
      rows: number;
      cols: number;
      title: string | null;
      mask: string[];
    };
  }[];
  /** Server-computed next cursor (page-minimum createdAt), null when the list is exhausted. */
  nextBefore: string | null;
}
interface PuzzlesList {
  puzzles: {
    puzzleId: string;
    createdAt: string;
    rows: number;
    cols: number;
    features: unknown;
    title: string | null;
    author: string | null;
    mask: string[];
  }[];
}

/**
 * Assert a mask is a well-formed black-square silhouette (PROTOCOL.md §12): `rows` strings, each
 * exactly `cols` characters, every glyph either `#` (block) or `.` (playable), and the marked
 * cells exactly the given block indices (row-major, cell i = r*cols + c). This pins the mask to
 * the puzzle geometry and to black squares only, with no letters, numbering, or solution content.
 */
function expectMask(
  mask: string[],
  rows: number,
  cols: number,
  blocks: readonly number[],
): void {
  expect(mask).toHaveLength(rows);
  expect(mask.every((row) => row.length === cols)).toBe(true);
  const flat = mask.join("");
  expect(flat).toMatch(/^[#.]*$/); // pattern only: no letters, digits, or numbering ever
  const blocked = new Set(blocks);
  for (let i = 0; i < rows * cols; i += 1) {
    expect(flat[i]).toBe(blocked.has(i) ? "#" : ".");
  }
}

describe("GET /games list (PROTOCOL.md §12; DESIGN.md §8, §9; INV-6)", () => {
  it("returns only games the caller is a member of, never another user's (visibility scoped to membership)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(caller);
    const { gameId: mine1 } = await createGame(caller, puzzleId);
    const { gameId: mine2 } = await createGame(caller, puzzleId);

    const stranger = await auth.mintUpgraded({ sub: randomUUID() });
    const strangerPuzzle = await ingestFixture(stranger);
    const { gameId: theirs } = await createGame(stranger, strangerPuzzle);

    const res = await get("/games", caller);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as GamesList).games.map((g) => g.gameId);
    expect(ids).toContain(mine1);
    expect(ids).toContain(mine2);
    expect(ids).not.toContain(theirs);
  });

  it("lists a game a guest joined, with the caller's own spectator role (guests are members, DESIGN.md §8)", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const guest = await auth.mintAnonymous({ sub: randomUUID() });
    await join(gameId, guest, inviteCode);

    const res = await get("/games", guest);
    expect(res.status).toBe(200);
    const { games } = (await res.json()) as GamesList;
    expect(games).toHaveLength(1);
    expect(games[0]!.gameId).toBe(gameId);
    expect(games[0]!.role).toBe("spectator");
  });

  it("reports the caller's own role and the member count per game", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(caller);
    const { gameId: hosted } = await createGame(caller, puzzleId);

    const otherHost = await auth.mintUpgraded({ sub: randomUUID() });
    const otherPuzzle = await ingestFixture(otherHost);
    const { gameId: joined, inviteCode } = await createGame(
      otherHost,
      otherPuzzle,
    );
    await join(joined, caller, inviteCode);

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    const byId = new Map(games.map((g) => [g.gameId, g]));
    expect(byId.get(hosted)!.role).toBe("host");
    expect(byId.get(hosted)!.memberCount).toBe(1);
    // A full account joining now seats solver directly (owner decision 2026-07-10).
    expect(byId.get(joined)!.role).toBe("solver");
    expect(byId.get(joined)!.memberCount).toBe(2); // host plus the caller who joined
  });

  it("orders unplayed games newest-createdAt first (no activity yet; PROTOCOL.md §12)", async () => {
    // With no board events, every game's lastActivityAt is null, so activity ordering falls back
    // to createdAt DESC among the unplayed games: the newest-created reads first.
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(caller);
    const { gameId: g1 } = await createGame(caller, puzzleId);
    const { gameId: g2 } = await createGame(caller, puzzleId);
    const { gameId: g3 } = await createGame(caller, puzzleId);
    await setGameCreatedAt(g1, "2026-03-01T00:00:00.000Z");
    await setGameCreatedAt(g2, "2026-03-02T00:00:00.000Z");
    await setGameCreatedAt(g3, "2026-03-03T00:00:00.000Z");

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    expect(games.map((g) => g.gameId)).toEqual([g3, g2, g1]);
    // Unplayed games carry a null lastActivityAt.
    expect(games.every((g) => g.lastActivityAt === null)).toBe(true);
  });

  it("orders the page by most recent activity, not creation time (read expand; PROTOCOL.md §12)", async () => {
    // Three games created oldest-to-newest (g1 < g2 < g3), then played in the OPPOSITE order so
    // activity inverts creation: g1 last-active, g3 first-active. The page must read by activity.
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub });
    const puzzleId = await ingestFixture(caller);
    const { gameId: g1 } = await createGame(caller, puzzleId);
    const { gameId: g2 } = await createGame(caller, puzzleId);
    const { gameId: g3 } = await createGame(caller, puzzleId);
    await setGameCreatedAt(g1, "2026-03-01T00:00:00.000Z");
    await setGameCreatedAt(g2, "2026-03-02T00:00:00.000Z");
    await setGameCreatedAt(g3, "2026-03-03T00:00:00.000Z");
    // Activity inverts creation order: g1 is the most recently touched.
    await seedCellEvent(g3, sub, 1, "2026-05-01T10:00:00.000Z");
    await seedCellEvent(g2, sub, 1, "2026-05-02T10:00:00.000Z");
    await seedCellEvent(g1, sub, 1, "2026-05-03T10:00:00.000Z");

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    // By activity, newest touch first: g1, g2, g3 (the reverse of createdAt order).
    expect(games.map((g) => g.gameId)).toEqual([g1, g2, g3]);
    expect(games.find((g) => g.gameId === g1)!.lastActivityAt).toBe(
      "2026-05-03T10:00:00.000Z",
    );
  });

  it("reports lastActivityAt as MAX(cell_events.at), advancing as the game is played", async () => {
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub });
    const puzzleId = await ingestFixture(caller);
    const { gameId } = await createGame(caller, puzzleId);
    // Two events; the later `at` is the game's last activity, regardless of insert/seq order.
    await seedCellEvent(gameId, sub, 1, "2026-05-10T08:00:00.000Z");
    await seedCellEvent(gameId, sub, 2, "2026-05-10T09:30:00.000Z");

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    expect(games.find((g) => g.gameId === gameId)!.lastActivityAt).toBe(
      "2026-05-10T09:30:00.000Z",
    );
  });

  it("sorts played games ahead of unplayed ones within a page (PROTOCOL.md §12)", async () => {
    // A played game outranks every unplayed game in its page even when the unplayed game was
    // created later: activity beats creation, and null activity sorts last.
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub });
    const puzzleId = await ingestFixture(caller);
    const { gameId: unplayedNew } = await createGame(caller, puzzleId);
    const { gameId: playedOld } = await createGame(caller, puzzleId);
    await setGameCreatedAt(playedOld, "2026-02-01T00:00:00.000Z");
    await setGameCreatedAt(unplayedNew, "2026-02-09T00:00:00.000Z");
    // The old game has recent activity; the newer game has none.
    await seedCellEvent(playedOld, sub, 1, "2026-06-01T12:00:00.000Z");

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    expect(games.map((g) => g.gameId)).toEqual([playedOld, unplayedNew]);
    expect(
      games.find((g) => g.gameId === unplayedNew)!.lastActivityAt,
    ).toBeNull();
  });

  it("reads cell_events under a SELECT-only grant and never writes it (INV-7 single writer)", async () => {
    // Activity ordering reads the session-owned event log; that read must not become a write. The
    // api role can SELECT MAX(at) now, but still cannot INSERT/UPDATE/DELETE cell_events (the log
    // stays append-only for the session too). Asserted through the real crossy_api-role pool.
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub });
    const puzzleId = await ingestFixture(caller);
    const { gameId } = await createGame(caller, puzzleId);
    await seedCellEvent(gameId, sub, 1, "2026-06-03T09:30:00.000Z");

    // Positive: the api role can now read cell_events (migration 0008 grant), the MAX(at) the
    // list needs. It reads only the timestamp, never a value (INV-6).
    const read = await apiPool.query<{ last: Date | null }>(
      "select max(at) as last from cell_events where game_id = $1",
      [gameId],
    );
    expect(read.rows[0]?.last).not.toBeNull();
    // Negative: the read grant is not a write grant. cell_events stays session-owned (INV-7).
    await expect(
      apiPool.query(
        "insert into cell_events (game_id, seq, cell, user_id, value) values ($1, 2, 0, $2, 'B')",
        [gameId, sub],
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      apiPool.query("update cell_events set value = 'Z' where game_id = $1", [
        gameId,
      ]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      apiPool.query("delete from cell_events where game_id = $1", [gameId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("carries INV-6-safe geometry and leaks no solution anywhere in the serialized JSON (INV-6)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const marker = await postJson("/puzzles", caller, markerDoc());
    const { puzzleId } = (await marker.json()) as { puzzleId: string };
    const { gameId } = await createGame(caller, puzzleId);

    const res = await get("/games", caller);
    const text = await res.text();
    const body = JSON.parse(text) as GamesList;
    const g = body.games.find((x) => x.gameId === gameId)!;
    expect(g.puzzle.rows).toBe(2);
    expect(g.puzzle.cols).toBe(2);
    // The mask is the black-square silhouette, pattern only (PROTOCOL.md §12). markerDoc is a
    // 2x2 all-playable grid, so every cell reads playable and no glyph is anything but `#`/`.`.
    expectMask(g.puzzle.mask, 2, 2, []);
    // No solution content, and no whole snapshot, anywhere in the response (INV-6, structural).
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "puzzleSnapshot")).toBe(false);
    expect(text).not.toContain(LIST_MARKER);
    // Completion surfaces as `completedAt` only, never a full `status` enum the API cannot own
    // (§9): the API reads the terminal timestamp under its grant, not a lifecycle claim.
    expect(hasKeyDeep(body, "status")).toBe(false);
    // A fresh game has no game_state row yet (left join), so it reads ongoing: completedAt null.
    expect(g.completedAt).toBeNull();
  });

  it("carries the puzzle mask matching the block geometry, pattern only, no solution leak (PROTOCOL.md §12; INV-6)", async () => {
    // A 3x3 grid with a real black square at cell 4 (the center) and a planted solution marker.
    // The mask must place the block exactly and never carry a letter, number, or the marker.
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const blockDoc = {
      size: { rows: 3, cols: 3 },
      grid: [LIST_MARKER, "B", "C", "D", ".", "E", "F", "G", "H"],
      clues: { across: ["1. top", "3. bottom"], down: ["1. left", "2. right"] },
    };
    const { puzzleId } = (await postJson("/puzzles", caller, blockDoc).then(
      (r) => r.json(),
    )) as { puzzleId: string };
    const { gameId } = await createGame(caller, puzzleId);

    const res = await get("/games", caller);
    const text = await res.text();
    const body = JSON.parse(text) as GamesList;
    const g = body.games.find((x) => x.gameId === gameId)!;
    // Block at the center cell (index 4); the silhouette reflects the stored geometry exactly.
    expectMask(g.puzzle.mask, 3, 3, [4]);
    expect(g.puzzle.mask).toEqual(["...", ".#.", "..."]);
    // INV-6: the mask is derived from block indices, never the solution, so no marker leaks.
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "puzzleSnapshot")).toBe(false);
    expect(text).not.toContain(LIST_MARKER);
  });

  it("reports completedAt from the session-owned game_state, null while ongoing (read expand; INV-7)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(caller);
    const { gameId: ongoing } = await createGame(caller, puzzleId);
    const { gameId: done } = await createGame(caller, puzzleId);
    const { gameId: never } = await createGame(caller, puzzleId);

    // The session (here the superuser fixture) materializes game_state: `done` is completed,
    // `ongoing` has a row but no completed_at; `never` has no row at all (never connected).
    const completedIso = "2026-06-01T12:00:00.000Z";
    await seedGameState(done, completedIso);
    await seedGameState(ongoing, null);

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    const byId = new Map(games.map((g) => [g.gameId, g]));
    // A completed game reports its terminal timestamp, so the home can mark it done.
    expect(byId.get(done)!.completedAt).toBe(completedIso);
    // An ongoing game (game_state row, no completed_at) reads null.
    expect(byId.get(ongoing)!.completedAt).toBeNull();
    // A game with no game_state row still lists (left join) and reads ongoing.
    expect(byId.get(never)!.completedAt).toBeNull();
  });

  it("reads game_state under a SELECT-only grant and never writes it (INV-7 single writer)", async () => {
    // The completion read must not weaken single-writer: the API role can SELECT game_state now,
    // but still cannot INSERT/UPDATE/DELETE it. Both halves are asserted through the real
    // crossy_api-role pool the app uses.
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(caller);
    const { gameId } = await createGame(caller, puzzleId);
    await seedGameState(gameId, "2026-06-02T09:30:00.000Z");

    // Positive: the api role can now read game_state (migration 0005 grant).
    const read = await apiPool.query<{ completed_at: Date | null }>(
      "select completed_at from game_state where game_id = $1",
      [gameId],
    );
    expect(read.rows[0]?.completed_at).not.toBeNull();
    // Negative: the read grant does not become a write grant. game_state stays session-owned.
    await expect(
      apiPool.query(
        "update game_state set completed_at = now() where game_id = $1",
        [gameId],
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      apiPool.query(
        "insert into game_state (game_id) values (gen_random_uuid())",
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("carries the puzzle title in the summary, null when the puzzle has none (display content; INV-6-safe)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    // A titled puzzle (with a planted solution marker) and an untitled one, each in its own game.
    const titled = (await postJson("/puzzles", caller, {
      ...markerDoc(),
      title: "Sunday Themeless",
    }).then((r) => r.json())) as { puzzleId: string };
    const { gameId: withTitle } = await createGame(caller, titled.puzzleId);
    const untitledPuzzle = await ingestFixture(caller); // FIXTURE: no title
    const { gameId: withoutTitle } = await createGame(caller, untitledPuzzle);

    const res = await get("/games", caller);
    const text = await res.text();
    const body = JSON.parse(text) as GamesList;
    const byId = new Map(body.games.map((g) => [g.gameId, g]));
    expect(byId.get(withTitle)!.puzzle.title).toBe("Sunday Themeless");
    expect(byId.get(withoutTitle)!.puzzle.title).toBeNull();
    // The title is display content and rides no solution (INV-6): the join selects a single named
    // column, never the snapshot, so no solution/snapshot key and no marker ever leak.
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "puzzleSnapshot")).toBe(false);
    expect(text).not.toContain(LIST_MARKER);
  });

  it("paginates by limit and the server-computed nextBefore cursor, never an offset", async () => {
    // Unplayed games, so activity order equals createdAt order; the cursor is the page-minimum
    // createdAt the server returns as nextBefore (not the visual last row, which activity ordering
    // can reshuffle). A full page yields a non-null nextBefore; the final partial page yields null.
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(caller);
    const { gameId: g1 } = await createGame(caller, puzzleId);
    const { gameId: g2 } = await createGame(caller, puzzleId);
    const { gameId: g3 } = await createGame(caller, puzzleId);
    await setGameCreatedAt(g1, "2026-04-01T00:00:00.000Z");
    await setGameCreatedAt(g2, "2026-04-02T00:00:00.000Z");
    await setGameCreatedAt(g3, "2026-04-03T00:00:00.000Z");

    const first = (await get("/games?limit=2", caller).then((r) =>
      r.json(),
    )) as GamesList;
    expect(first.games.map((g) => g.gameId)).toEqual([g3, g2]);
    // A full page (2 of 3) carries a next cursor: the page-minimum createdAt (g2's).
    expect(first.nextBefore).toBe("2026-04-02T00:00:00.000Z");

    const cursor = encodeURIComponent(first.nextBefore!);
    const second = (await get(`/games?limit=2&before=${cursor}`, caller).then(
      (r) => r.json(),
    )) as GamesList;
    expect(second.games.map((g) => g.gameId)).toEqual([g1]);
    // The last, partial page (1 row < limit 2) is the end of the list: no next cursor.
    expect(second.nextBefore).toBeNull();
  });

  it("selects the page by createdAt even as activity reorders it, so nextBefore stays page-minimum createdAt (PROTOCOL.md §12)", async () => {
    // The subtle case the design turns on: the page is SELECTED by createdAt (stable under moving
    // activity) but SHOWN by activity. So the visual last row is not the page's oldest createdAt,
    // and the cursor must be the server-computed page-minimum createdAt, never the reordered tail.
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub });
    const puzzleId = await ingestFixture(caller);
    const { gameId: g1 } = await createGame(caller, puzzleId); // oldest created
    const { gameId: g2 } = await createGame(caller, puzzleId);
    const { gameId: g3 } = await createGame(caller, puzzleId); // newest created
    await setGameCreatedAt(g1, "2026-07-01T00:00:00.000Z");
    await setGameCreatedAt(g2, "2026-07-02T00:00:00.000Z");
    await setGameCreatedAt(g3, "2026-07-03T00:00:00.000Z");
    // Page 1 selects the two newest-created (g3, g2). Within it, activity puts g2 above g3.
    await seedCellEvent(g2, sub, 1, "2026-08-02T00:00:00.000Z");
    await seedCellEvent(g3, sub, 1, "2026-08-01T00:00:00.000Z");

    const first = (await get("/games?limit=2", caller).then((r) =>
      r.json(),
    )) as GamesList;
    // Shown by activity: g2 (later touch) then g3, even though g3 was created later.
    expect(first.games.map((g) => g.gameId)).toEqual([g2, g3]);
    // The visual last row is g3 (created 07-03), but the page's OLDEST createdAt is g2's (07-02).
    // The cursor is that page-minimum, so page 2 correctly resumes below it and returns g1.
    expect(first.nextBefore).toBe("2026-07-02T00:00:00.000Z");
    expect(first.games.at(-1)!.createdAt).not.toBe(first.nextBefore);

    const cursor = encodeURIComponent(first.nextBefore!);
    const second = (await get(`/games?limit=2&before=${cursor}`, caller).then(
      (r) => r.json(),
    )) as GamesList;
    expect(second.games.map((g) => g.gameId)).toEqual([g1]);
    expect(second.nextBefore).toBeNull();
  });

  it("clamps limit and rejects an unparseable before cursor (VALIDATION)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(caller);
    const { gameId: g1 } = await createGame(caller, puzzleId);
    const { gameId: g2 } = await createGame(caller, puzzleId);
    await setGameCreatedAt(g1, "2026-05-01T00:00:00.000Z");
    await setGameCreatedAt(g2, "2026-05-02T00:00:00.000Z");

    const clamped = (await get("/games?limit=1", caller).then((r) =>
      r.json(),
    )) as GamesList;
    expect(clamped.games).toHaveLength(1);
    expect(clamped.games[0]!.gameId).toBe(g2);

    const bad = await get("/games?before=not-a-timestamp", caller);
    expect(bad.status).toBe(400);
    await expectError(bad, "VALIDATION");
  });

  it("requires authentication: 401 UNAUTHORIZED with no bearer token", async () => {
    const res = await app.request("/games", { method: "GET" });
    expect(res.status).toBe(401);
    await expectError(res, "UNAUTHORIZED");
  });
});

describe("GET /puzzles list (PROTOCOL.md §12; DESIGN.md §7, §8; INV-6)", () => {
  it("returns only puzzles the caller uploaded, never another user's (visibility scoped to uploader)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const p1 = await ingestFixture(caller);
    const p2 = await ingestFixture(caller);
    const stranger = await auth.mintUpgraded({ sub: randomUUID() });
    const p3 = await ingestFixture(stranger);

    const res = await get("/puzzles", caller);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as PuzzlesList).puzzles.map(
      (p) => p.puzzleId,
    );
    expect(ids).toContain(p1);
    expect(ids).toContain(p2);
    expect(ids).not.toContain(p3);
  });

  it("orders puzzles newest-createdAt first", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const p1 = await ingestFixture(caller);
    const p2 = await ingestFixture(caller);
    const p3 = await ingestFixture(caller);
    await setPuzzleCreatedAt(p1, "2026-03-01T00:00:00.000Z");
    await setPuzzleCreatedAt(p2, "2026-03-02T00:00:00.000Z");
    await setPuzzleCreatedAt(p3, "2026-03-03T00:00:00.000Z");

    const { puzzles } = (await get("/puzzles", caller).then((r) =>
      r.json(),
    )) as PuzzlesList;
    expect(puzzles.map((p) => p.puzzleId)).toEqual([p3, p2, p1]);
  });

  it("carries rows, cols, and features but no solution anywhere in the serialized JSON (INV-6)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const marker = await postJson("/puzzles", caller, markerDoc());
    const { puzzleId } = (await marker.json()) as { puzzleId: string };

    const res = await get("/puzzles", caller);
    const text = await res.text();
    const body = JSON.parse(text) as PuzzlesList;
    const p = body.puzzles.find((x) => x.puzzleId === puzzleId)!;
    expect(p.rows).toBe(2);
    expect(p.cols).toBe(2);
    expect(p.features).toEqual({
      rebus: true,
      circles: false,
      shadedCircles: false,
    });
    // The black-square silhouette, pattern only (PROTOCOL.md §12): markerDoc is all-playable.
    expectMask(p.mask, 2, 2, []);
    // Built from an explicit column list, never a select-all: no solution, no raw `data` (INV-6).
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "data")).toBe(false);
    expect(text).not.toContain(LIST_MARKER);
  });

  it("carries the puzzle mask matching the block geometry, pattern only, no solution leak (PROTOCOL.md §12; INV-6)", async () => {
    // A 2x3 grid with a black square at cell 2 and a planted solution marker; the mask must place
    // the block exactly and never carry a letter, digit, or the marker.
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const blockDoc = {
      size: { rows: 2, cols: 3 },
      grid: [LIST_MARKER, "I", ".", "O", "N", "E"],
      clues: { across: ["1. row one", "3. row two"], down: ["1. a", "2. b"] },
    };
    const { puzzleId } = (await postJson("/puzzles", caller, blockDoc).then(
      (r) => r.json(),
    )) as { puzzleId: string };

    const res = await get("/puzzles", caller);
    const text = await res.text();
    const body = JSON.parse(text) as PuzzlesList;
    const p = body.puzzles.find((x) => x.puzzleId === puzzleId)!;
    expectMask(p.mask, 2, 3, [2]);
    expect(p.mask).toEqual(["..#", "..."]);
    // INV-6: the mask is derived from block indices, never the solution; no marker or data leaks.
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "data")).toBe(false);
    expect(text).not.toContain(LIST_MARKER);
  });

  it("returns the parsed title and author per row, entity-decoded (display content; INV-6-safe)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    // Plant the solution marker AND display metadata: the marker must never surface, the
    // metadata must round-trip decoded (INV-6 untouched: title/author are not solutions).
    const created = (await postJson("/puzzles", caller, {
      ...markerDoc(),
      title: "Sat &amp; Sun",
      author: "Ada &amp; Bob",
    }).then((r) => r.json())) as { puzzleId: string };

    const res = await get("/puzzles", caller);
    const text = await res.text();
    const body = JSON.parse(text) as PuzzlesList;
    const p = body.puzzles.find((x) => x.puzzleId === created.puzzleId)!;
    expect(p.title).toBe("Sat & Sun");
    expect(p.author).toBe("Ada & Bob");
    // The new fields ride no solution: no solution/data key, and the marker never leaks (INV-6).
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "data")).toBe(false);
    expect(text).not.toContain(LIST_MARKER);
  });

  it("reads an absent or null title/author as null (existing puzzles read as untitled)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const absent = await ingestFixture(caller); // FIXTURE carries no title/author
    const explicitNull = (await postJson("/puzzles", caller, {
      ...markerDoc(),
      title: null,
      author: null,
    }).then((r) => r.json())) as { puzzleId: string };

    const { puzzles } = (await get("/puzzles", caller).then((r) =>
      r.json(),
    )) as PuzzlesList;
    const byId = new Map(puzzles.map((p) => [p.puzzleId, p]));
    expect(byId.get(absent)!.title).toBeNull();
    expect(byId.get(absent)!.author).toBeNull();
    expect(byId.get(explicitNull.puzzleId)!.title).toBeNull();
    expect(byId.get(explicitNull.puzzleId)!.author).toBeNull();
  });

  it("caps an over-long title at 200 characters (truncated on ingest, never rejected)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const created = (await postJson("/puzzles", caller, {
      ...markerDoc(),
      title: "T".repeat(500),
    }).then((r) => r.json())) as { puzzleId: string };
    const { puzzles } = (await get("/puzzles", caller).then((r) =>
      r.json(),
    )) as PuzzlesList;
    expect(
      puzzles.find((x) => x.puzzleId === created.puzzleId)!.title,
    ).toHaveLength(200);
  });

  it("paginates by limit and the createdAt before cursor, never an offset", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const p1 = await ingestFixture(caller);
    const p2 = await ingestFixture(caller);
    const p3 = await ingestFixture(caller);
    await setPuzzleCreatedAt(p1, "2026-04-01T00:00:00.000Z");
    await setPuzzleCreatedAt(p2, "2026-04-02T00:00:00.000Z");
    await setPuzzleCreatedAt(p3, "2026-04-03T00:00:00.000Z");

    const first = (await get("/puzzles?limit=2", caller).then((r) =>
      r.json(),
    )) as PuzzlesList;
    expect(first.puzzles.map((p) => p.puzzleId)).toEqual([p3, p2]);

    const cursor = encodeURIComponent(first.puzzles.at(-1)!.createdAt);
    const second = (await get(`/puzzles?limit=2&before=${cursor}`, caller).then(
      (r) => r.json(),
    )) as PuzzlesList;
    expect(second.puzzles.map((p) => p.puzzleId)).toEqual([p1]);
  });

  it("returns an empty list to a guest, who cannot upload (DESIGN.md §8)", async () => {
    const guest = await auth.mintAnonymous({ sub: randomUUID() });
    const res = await get("/puzzles", guest);
    expect(res.status).toBe(200);
    expect(((await res.json()) as PuzzlesList).puzzles).toEqual([]);
  });

  it("requires authentication: 401 UNAUTHORIZED with no bearer token", async () => {
    const res = await app.request("/puzzles", { method: "GET" });
    expect(res.status).toBe(401);
    await expectError(res, "UNAUTHORIZED");
  });
});

describe("GET /g/{code} invite unfurl (PROTOCOL.md §12; DESIGN.md §7; INV-1, INV-6)", () => {
  it("section 12: serves a public HTML shell with OpenGraph tags to an unauthenticated fetch", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { inviteCode } = await createGame(host, puzzleId);

    // No authorization header: unfurlers fetch anonymously (the §12 row is `public`).
    const res = await app.request(`/g/${inviteCode}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("<!doctype html>");
    expect(text).toContain('property="og:title"');
    expect(text).toContain('property="og:description"');
    expect(text).toContain('property="og:type"');
  });

  it("section 12: an unknown code is GAME_NOT_FOUND on the REST error envelope (the code is the lookup key, as in join-by-code; §12 pins no shape here)", async () => {
    const res = await app.request("/g/ZZZZZZZZ");
    await expectRejectionNoLeak(res, 404, "GAME_NOT_FOUND");
  });

  it("section 12: a malformed code (wrong length or outside the invite alphabet) is the same GAME_NOT_FOUND, never a fault", async () => {
    // Too short, excluded glyphs (0/1/I/O are not in the alphabet), too long, and symbols:
    // none can match a stored code (the `games_invite_code_format` CHECK), so each is the
    // identical not-found, indistinguishable from an unknown well-formed code.
    for (const code of ["abc", "OO11IIOO", "THISCODEISTOOLONG", "1234!"]) {
      const res = await app.request(`/g/${encodeURIComponent(code)}`);
      await expectRejectionNoLeak(res, 404, "GAME_NOT_FOUND");
    }
  });

  it("INV-1: a lowercase, whitespace-padded code resolves by trim + ASCII-uppercase, exactly like join-by-code, and the shell renders the stored code, never the raw input", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { inviteCode } = await createGame(host, puzzleId);

    const res = await app.request(
      `/g/${encodeURIComponent(`  ${inviteCode.toLowerCase()}  `)}`,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(inviteCode);
    // The raw lowercase input never appears (guarded: a rare all-digit code has no case).
    const lower = inviteCode.toLowerCase();
    if (lower !== inviteCode) expect(text).not.toContain(lower);
  });

  it("INV-6: the shell reads no puzzle or game content: no solution marker, no title, no author, no game name, no gameId", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const marker = await postJson("/puzzles", host, {
      ...markerDoc(),
      title: "Sunday Themeless",
      author: "Anna Gram",
    });
    const { puzzleId } = (await marker.json()) as { puzzleId: string };
    const created = await postJson("/games", host, {
      puzzleId,
      name: "Crew room",
    });
    expect(created.status).toBe(201);
    const { gameId, inviteCode } = (await created.json()) as {
      gameId: string;
      inviteCode: string;
    };

    const res = await app.request(`/g/${inviteCode}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    // INV-6 on a public, third-party-cached page (DESIGN.md §7): no solution content.
    expect(text).not.toContain(LIST_MARKER);
    expect(text).not.toContain("solution");
    // §12 pins title/author to GET /puzzles and GET /games only, and names neither the
    // game name nor the gameId for this route: the OpenGraph copy is generic.
    expect(text).not.toContain("Sunday Themeless");
    expect(text).not.toContain("Anna Gram");
    expect(text).not.toContain("Crew room");
    expect(text).not.toContain(gameId);
  });
});

describe("Live Activity token registry (PROTOCOL.md Live Activity push; DESIGN.md §9; INV-7)", () => {
  // A hex-ish ActivityKit token. The real token is opaque hex; any non-empty string is accepted
  // by the contract, since the column is text and the token is a capability, not a validated id.
  const tokenFor = (label: string): string =>
    `${label}-${randomUUID().replace(/-/g, "")}`;

  it("registers a member's token and returns 204, writing one row under the API single writer (INV-7)", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const token = tokenFor("reg");

    const res = await postJson(`/games/${gameId}/live-activity-tokens`, host, {
      token,
      environment: "sandbox",
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");

    const rows = await adminPool.query(
      "select user_id, game_id, apns_environment from live_activity_tokens where token=$1",
      [token],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].game_id).toBe(gameId);
    expect(rows.rows[0].apns_environment).toBe("sandbox");
  });

  it("records the apns_environment so the emitter targets the matching APNs host (sandbox vs production)", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const token = tokenFor("prod");

    const res = await postJson(`/games/${gameId}/live-activity-tokens`, host, {
      token,
      environment: "production",
    });
    expect(res.status).toBe(204);
    const rows = await adminPool.query(
      "select apns_environment from live_activity_tokens where token=$1",
      [token],
    );
    expect(rows.rows[0].apns_environment).toBe("production");
  });

  it("upserts on token conflict: a re-registration after app restart updates the row, not a duplicate", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const token = tokenFor("rereg");

    await postJson(`/games/${gameId}/live-activity-tokens`, host, {
      token,
      environment: "sandbox",
    });
    // The same token re-registers with a different environment (e.g. a debug-to-release rebuild).
    const res = await postJson(`/games/${gameId}/live-activity-tokens`, host, {
      token,
      environment: "production",
    });
    expect(res.status).toBe(204);

    const rows = await adminPool.query(
      "select apns_environment from live_activity_tokens where token=$1",
      [token],
    );
    // One row (primary key on token), updated in place.
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].apns_environment).toBe("production");
  });

  it("forbids a non-member registering a token as NOT_PARTICIPANT (same gate as member endpoints)", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const strangerSub = randomUUID();
    const stranger = await auth.mintUpgraded({ sub: strangerSub });
    const strangerToken = tokenFor("stranger");
    const res = await postJson(
      `/games/${gameId}/live-activity-tokens`,
      stranger,
      { token: strangerToken, environment: "sandbox" },
    );
    expect(res.status).toBe(403);
    await expectError(res, "NOT_PARTICIPANT");
    // Nothing was written for the non-member.
    const rows = await adminPool.query(
      "select 1 from live_activity_tokens where token=$1",
      [strangerToken],
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("rejects a missing token or a bad environment as VALIDATION", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const noToken = await postJson(
      `/games/${gameId}/live-activity-tokens`,
      host,
      { environment: "sandbox" },
    );
    expect(noToken.status).toBe(400);
    await expectError(noToken, "VALIDATION");

    const badEnv = await postJson(
      `/games/${gameId}/live-activity-tokens`,
      host,
      { token: tokenFor("bad"), environment: "staging" },
    );
    expect(badEnv.status).toBe(400);
    await expectError(badEnv, "VALIDATION");
  });

  it("returns GAME_NOT_FOUND for an unknown game", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const res = await postJson(
      `/games/${randomUUID()}/live-activity-tokens`,
      host,
      { token: tokenFor("nogame"), environment: "sandbox" },
    );
    expect(res.status).toBe(404);
    await expectError(res, "GAME_NOT_FOUND");
  });

  it("deletes a caller's own token and returns 204", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const token = tokenFor("del");
    await postJson(`/games/${gameId}/live-activity-tokens`, host, {
      token,
      environment: "sandbox",
    });

    const res = await del(
      `/games/${gameId}/live-activity-tokens/${token}`,
      host,
    );
    expect(res.status).toBe(204);
    const rows = await adminPool.query(
      "select 1 from live_activity_tokens where token=$1",
      [token],
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("is idempotent: deleting an already-gone token still returns 204", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const res = await del(
      `/games/${gameId}/live-activity-tokens/${tokenFor("ghost")}`,
      host,
    );
    expect(res.status).toBe(204);
  });

  it("a caller may delete only their own rows: another user's token survives (user_id scope)", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const otherSub = randomUUID();
    const other = await auth.mintUpgraded({ sub: otherSub });
    await join(gameId, other, inviteCode);

    const otherToken = tokenFor("other");
    await postJson(`/games/${gameId}/live-activity-tokens`, other, {
      token: otherToken,
      environment: "sandbox",
    });

    // The host tries to delete the other member's token: 204 (idempotent), but the row survives.
    const res = await del(
      `/games/${gameId}/live-activity-tokens/${otherToken}`,
      host,
    );
    expect(res.status).toBe(204);
    const rows = await adminPool.query(
      "select user_id from live_activity_tokens where token=$1",
      [otherToken],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].user_id).toBe(otherSub);
  });

  it("INV-6: the registry stores no board content, only a token, ids, environment, and timestamp", async () => {
    // The registry is presence and routing metadata, never solution content. Assert the column
    // set carries nothing board-derived (no value, no cell, no board, no solution).
    const { rows } = await adminPool.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='public' and table_name='live_activity_tokens'",
    );
    const cols = rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(
      ["apns_environment", "created_at", "game_id", "token", "user_id"].sort(),
    );
  });
});
