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
import { Buffer } from "node:buffer";
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
import { puzzleDigest } from "./puzzles/digest";
import {
  STARTER_GAME_NAME,
  STARTER_PUZZLE_FEATURES,
  STARTER_PUZZLE_TITLE,
} from "./starter/starter-puzzle";
import type {
  ApiEnv,
  MembershipChange,
  MembershipNotifier,
  VendorIdentityPort,
} from "./context";

const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;
const SESSION_WS_BASE = "wss://session.crossy.test";
const INVITE_HOST = "crossy.ing";
const WEB_ORIGIN = "https://crossy.party";

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
// The Live Activity welcome notice (PROTOCOL.md 12a) rides the same recording notifier, so the
// M3a-style suite proves the API fires it after a token upsert without a socket or a network hop.
let welcomeCalls: { gameId: string; userId: string }[] = [];
let welcomeShouldFail = false;
let vendorDeletions: string[] = [];
let vendorShouldFail = false;

const membershipNotifier: MembershipNotifier = {
  async membershipChanged(gameId, change) {
    notifyCalls.push({ gameId, change });
    if (notifyShouldFail) throw new Error("session unreachable (test)");
  },
  async liveActivityRegistered(gameId, userId) {
    welcomeCalls.push({ gameId, userId });
    if (welcomeShouldFail) throw new Error("session unreachable (test)");
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
  welcomeCalls = [];
  welcomeShouldFail = false;
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

async function patchJson(
  path: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return app.request(path, {
    method: "PATCH",
    headers: bearer(token),
    body: JSON.stringify(body),
  });
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

// Each ingestFixture call ingests a DISTINCT puzzle (a unique clue, which is in the content
// digest), so repeated ingests by one account create separate rows and never collapse on the
// dedup index (D23). This restores the "each ingest is a new row" assumption these list and
// pagination tests were written against; the dedup suite posts FIXTURE directly to exercise the
// collapse.
let fixtureSeq = 0;

/** Ingest a distinct fixture puzzle as `token`'s owner; return its id. */
async function ingestFixture(token: string): Promise<string> {
  fixtureSeq += 1;
  const doc = {
    ...FIXTURE,
    clues: {
      ...FIXTURE.clues,
      across: [`1. friendly opener ${fixtureSeq}`, "3. keyboard basics"],
    },
  };
  const res = await postJson("/puzzles", token, doc);
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
    // The invite host is enabled here so its DB-backed paths (a real code resolving to a game) are
    // exercised against Postgres. It is host-scoped, so every existing test (which requests a
    // relative path, host `localhost`) is unaffected; only `http://crossy.ing/...` requests below
    // reach it.
    inviteHost: INVITE_HOST,
    webOrigin: WEB_ORIGIN,
  });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await apiPool?.end();
  await adminPool?.end();
  await container?.stop();
}, 60_000);

// CORS preflight: the SPA calls this API from a different origin (crossy.party ->
// rest.crossy.party), so any request carrying Authorization is preceded by an OPTIONS
// preflight. The allow-methods header must advertise every method the API routes, or the
// browser blocks the real call. Regression: #236 added PATCH /me but left PATCH out of the
// list, so the display-name write failed the preflight cross-origin (DESIGN.md §7).
describe("CORS preflight advertises every served method (DESIGN.md §7)", () => {
  const corsApp = () =>
    buildApp({
      db: createDb(apiPool),
      authPort: auth,
      sessionWsBase: SESSION_WS_BASE,
      membershipNotifier,
      vendorIdentity,
      inviteHost: INVITE_HOST,
      webOrigin: WEB_ORIGIN,
      corsOrigin: WEB_ORIGIN,
    });

  it("answers OPTIONS /me with PATCH in allow-methods, so the SPA's display-name write is not blocked", async () => {
    const res = await corsApp().request("/me", {
      method: "OPTIONS",
      headers: {
        origin: WEB_ORIGIN,
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization, content-type",
      },
    });
    expect(res.status).toBe(204);
    const methods = res.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]) {
      expect(methods).toContain(method);
    }
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
  });
});

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

  it("propagates a changed provider display name only while the name is still provider-owned (INV-7)", async () => {
    // The provider-name propagation holds for a row whose name has never diverged from the
    // token: a token name only FILLS a null, and here the second token's name overwrites the
    // first because the first token's name was never a user choice. (The next test proves that
    // once a user sets a name via PATCH /me, a later provider rename does NOT overwrite it.)
    const sub = randomUUID();
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada" } }),
      FIXTURE,
    );
    // A second token with a different provider name only FILLS a null; here the row is not null,
    // so under the R1 contract the app-DB value wins and the rename does NOT propagate.
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada L." } }),
      FIXTURE,
    );
    const { rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    );
    // R1 (DESIGN.md name-onboarding): the app-DB name is authoritative; a token name only fills
    // a null or adopts on upgrade. A provider rename never overwrites an established name.
    expect(rows[0].display_name).toBe("Ada");
  });

  it("a PATCH /me name survives a later request whose token carries a different provider name (INV-7, the user owns the name)", async () => {
    const sub = randomUUID();
    // The user arrives with a provider name, then chooses their own via PATCH /me.
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada" } }),
      FIXTURE,
    );
    const patched = await patchJson(
      "/me",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada" } }),
      { displayName: "Ada Lovelace" },
    );
    expect(patched.status).toBe(200);
    // A later request whose token carries a DIFFERENT provider name must not clobber the choice.
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({
        sub,
        userMetadata: { full_name: "Someone Else" },
      }),
      FIXTURE,
    );
    const { rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    );
    expect(rows[0].display_name).toBe("Ada Lovelace");
  });

  it("a guest who upgrades WITH a provider name adopts it, dropping the Guest default (R1; INV-7)", async () => {
    const sub = randomUUID();
    await postJson("/puzzles", await auth.mintAnonymous({ sub }), FIXTURE);
    // Sanity: the guest mirror holds the "Guest" default.
    let { rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    );
    expect(rows[0].display_name).toBe("Guest");
    // Upgrade with a provider name: the upgrade branch drops "Guest" and adopts the name.
    await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Grace" } }),
      FIXTURE,
    );
    ({ rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    ));
    expect(rows[0].display_name).toBe("Grace");
  });

  it("a guest who upgrades WITHOUT a provider name becomes display_name null, arming onboarding (R1; INV-7)", async () => {
    const sub = randomUUID();
    await postJson("/puzzles", await auth.mintAnonymous({ sub }), FIXTURE);
    // Upgrade with NO provider name: the upgrade branch drops "Guest" to null (not to "Guest"),
    // so the account is nameless and onboarding fires (GET /me reports needsName true).
    await postJson("/puzzles", await auth.mintUpgraded({ sub }), FIXTURE);
    const { rows } = await adminPool.query(
      "select display_name from users where user_id = $1",
      [sub],
    );
    expect(rows[0].display_name).toBeNull();
  });
});

describe("self display identity /me (DESIGN.md name-onboarding; PROTOCOL.md §12; INV-7 single writer of users)", () => {
  interface MeBody {
    userId: string;
    displayName: string | null;
    isAnonymous: boolean;
    avatarUrl: string | null;
    needsName: boolean;
    reactionSet: string[] | null;
  }

  it("GET /me returns needsName true and displayName null for a nameless permanent mint (R3)", async () => {
    const sub = randomUUID();
    // A permanent token with no user_metadata name mirrors display_name null (email OTP, etc.).
    const res = await get("/me", await auth.mintUpgraded({ sub }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeBody;
    expect(body.userId).toBe(sub);
    expect(body.displayName).toBeNull();
    expect(body.isAnonymous).toBe(false);
    expect(body.needsName).toBe(true);
  });

  it("GET /me returns needsName false when the token carried a provider name", async () => {
    const sub = randomUUID();
    const res = await get(
      "/me",
      await auth.mintUpgraded({ sub, userMetadata: { full_name: "Ada" } }),
    );
    const body = (await res.json()) as MeBody;
    expect(body.displayName).toBe("Ada");
    expect(body.needsName).toBe(false);
  });

  it("GET /me returns needsName false for an anonymous guest (guests are never onboarded, R2)", async () => {
    const sub = randomUUID();
    const res = await get("/me", await auth.mintAnonymous({ sub }));
    const body = (await res.json()) as MeBody;
    // A guest holds the "Guest" default and is join-only; needsName only fires for permanents.
    expect(body.isAnonymous).toBe(true);
    expect(body.needsName).toBe(false);
  });

  it("PATCH /me sets the name and GET /me then reports it with needsName false", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    const patched = await patchJson("/me", token, {
      displayName: "Ada Lovelace",
    });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as MeBody;
    expect(body.displayName).toBe("Ada Lovelace");
    expect(body.needsName).toBe(false);
    // The write is the single authoritative source: a later GET /me reads it back.
    const after = (await (await get("/me", token)).json()) as MeBody;
    expect(after.displayName).toBe("Ada Lovelace");
    expect(after.needsName).toBe(false);
  });

  it("PATCH /me canonicalizes: NFC, trim, and collapse internal whitespace (INV-1 casing untouched)", async () => {
    const sub = randomUUID();
    const res = await patchJson("/me", await auth.mintUpgraded({ sub }), {
      displayName: "  Ada   Lovelace ",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeBody;
    expect(body.displayName).toBe("Ada Lovelace");
  });

  it("PATCH /me is idempotent on the canonical value", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    const first = (await (
      await patchJson("/me", token, { displayName: "Ada" })
    ).json()) as MeBody;
    const second = (await (
      await patchJson("/me", token, { displayName: "Ada" })
    ).json()) as MeBody;
    expect(first.displayName).toBe("Ada");
    expect(second.displayName).toBe("Ada");
  });

  it("PATCH /me rejects a whitespace-only name as 422 NAME_REQUIRED", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      displayName: "   ",
    });
    expect(res.status).toBe(422);
    await expectError(res, "NAME_REQUIRED");
  });

  it("PATCH /me rejects an over-40-grapheme name as 422 NAME_TOO_LONG", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      displayName: "a".repeat(41),
    });
    expect(res.status).toBe(422);
    await expectError(res, "NAME_TOO_LONG");
  });

  it("PATCH /me rejects a name with a disallowed character as 422 NAME_INVALID", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      displayName: "Ada\nLovelace",
    });
    expect(res.status).toBe(422);
    await expectError(res, "NAME_INVALID");
  });

  it("PATCH /me rejects a malformed body (missing displayName) as 400 VALIDATION", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {});
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION");
  });

  it("PATCH /me rejects a non-string displayName as 400 VALIDATION", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      displayName: 42,
    });
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION");
  });

  it("GET /me and PATCH /me reject a missing bearer as 401 UNAUTHORIZED", async () => {
    const noAuth = await app.request("/me", { method: "GET" });
    expect(noAuth.status).toBe(401);
    await expectError(noAuth, "UNAUTHORIZED");
    const noAuthPatch = await app.request("/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Ada" }),
    });
    expect(noAuthPatch.status).toBe(401);
    await expectError(noAuthPatch, "UNAUTHORIZED");
  });

  it("PATCH /me is rate-limited per user with 429 RATE_LIMITED and a Retry-After (INV-7 write path)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    // The budget is 20 writes / 10 min; the 21st spends the window.
    let last: Response | undefined;
    for (let i = 0; i < 21; i += 1) {
      last = await patchJson("/me", token, { displayName: `Ada ${i}` });
    }
    expect(last!.status).toBe(429);
    await expectError(last!, "RATE_LIMITED");
    expect(last!.headers.get("retry-after")).not.toBeNull();
  });

  // Personal reaction sets (PROTOCOL.md §9, §12; DESIGN.md D25). The set is a nullable jsonb column
  // the API owns (INV-7 single writer of users); null means the default five and is every account's
  // state until it configures a set. A multi-codepoint single grapheme, one valid slot.
  const FLAG_CA = "\u{1F1E8}\u{1F1E6}"; // 🇨🇦
  const VALID_SET = ["🔥", "🤔", "🐐", "💀", "😭"];

  it("GET /me returns reactionSet null by default (null means the default five, PROTOCOL.md §9)", async () => {
    const res = await get("/me", await auth.mintUpgraded());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeBody;
    expect(body.reactionSet).toBeNull();
  });

  it("PATCH /me sets reactionSet byte-exact and GET /me round-trips it (INV-7 single writer of users)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    const set = ["🔥", "🤔", FLAG_CA, "💀", "😭"];
    const patched = await patchJson("/me", token, { reactionSet: set });
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as MeBody;
    // Stored and returned byte-exact: no normalization strips the multi-codepoint grapheme.
    expect(body.reactionSet).toEqual(set);
    // The write is the single authoritative source: a later GET /me reads it back unchanged.
    const after = (await (await get("/me", token)).json()) as MeBody;
    expect(after.reactionSet).toEqual(set);
  });

  it("PATCH /me with reactionSet null resets to the defaults (the column back to null)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    await patchJson("/me", token, { reactionSet: VALID_SET });
    const reset = await patchJson("/me", token, { reactionSet: null });
    expect(reset.status).toBe(200);
    expect(((await reset.json()) as MeBody).reactionSet).toBeNull();
  });

  it("PATCH /me patches reactionSet without touching displayName, and vice versa (INV-7, independent writes)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    // Set only the name.
    await patchJson("/me", token, { displayName: "Ada Lovelace" });
    // Patch only the reaction set: the name must survive untouched.
    const afterSet = (await (
      await patchJson("/me", token, { reactionSet: VALID_SET })
    ).json()) as MeBody;
    expect(afterSet.displayName).toBe("Ada Lovelace");
    expect(afterSet.reactionSet).toEqual(VALID_SET);
    // Patch only the name: the reaction set must survive untouched.
    const afterName = (await (
      await patchJson("/me", token, { displayName: "Grace Hopper" })
    ).json()) as MeBody;
    expect(afterName.displayName).toBe("Grace Hopper");
    expect(afterName.reactionSet).toEqual(VALID_SET);
  });

  it("PATCH /me writes both displayName and reactionSet in one patch", async () => {
    const token = await auth.mintUpgraded({ sub: randomUUID() });
    const res = await patchJson("/me", token, {
      displayName: "Ada",
      reactionSet: VALID_SET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MeBody;
    expect(body.displayName).toBe("Ada");
    expect(body.reactionSet).toEqual(VALID_SET);
  });

  it("PATCH /me lets a guest configure a reaction set (its durable users row holds the column, DESIGN.md §8)", async () => {
    const token = await auth.mintAnonymous({ sub: randomUUID() });
    const res = await patchJson("/me", token, { reactionSet: VALID_SET });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MeBody).reactionSet).toEqual(VALID_SET);
  });

  it("PATCH /me rejects a reactionSet that is not five entries as 422 REACTION_SET_LENGTH", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      reactionSet: ["🔥", "🤔", "🐐", "💀"],
    });
    expect(res.status).toBe(422);
    await expectError(res, "REACTION_SET_LENGTH");
  });

  it("PATCH /me rejects a reactionSet entry that is not one emoji as 422 REACTION_SET_INVALID", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      reactionSet: ["🔥", "🤔", "🐐", "💀", "nope"],
    });
    expect(res.status).toBe(422);
    await expectError(res, "REACTION_SET_INVALID");
  });

  it("PATCH /me rejects a repeated reactionSet entry as 422 REACTION_SET_DUPLICATE", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      reactionSet: ["🔥", "🤔", "🐐", "💀", "🔥"],
    });
    expect(res.status).toBe(422);
    await expectError(res, "REACTION_SET_DUPLICATE");
  });

  it("PATCH /me rejects a non-array reactionSet as 400 VALIDATION (wrong type, not a 422)", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      reactionSet: "🔥🤔🐐💀😭",
    });
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION");
  });

  it("PATCH /me rejects a reactionSet array with a non-string element as 400 VALIDATION", async () => {
    const res = await patchJson("/me", await auth.mintUpgraded(), {
      reactionSet: ["🔥", "🤔", "🐐", "💀", 5],
    });
    expect(res.status).toBe(400);
    await expectError(res, "VALIDATION");
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

describe("POST /puzzles dedup (DESIGN.md D23, PROTOCOL.md §12; INV-6)", () => {
  // A second well-formed XWord Info doc: same 2x2 shape, a different solution grid, so it
  // translates cleanly but hashes to a different content digest than FIXTURE.
  const OTHER = {
    size: { rows: 2, cols: 2 },
    grid: ["C", "A", "T", "S"],
    clues: {
      across: ["1. feline", "3. men, informally"],
      down: ["1. taxi", "2. matured"],
    },
  };

  /** Count a caller's stored puzzle rows (created_by = user_id = the JWT sub). */
  async function puzzleCount(userId: string): Promise<number> {
    const { rows } = await adminPool.query(
      "select count(*)::int as n from puzzles where created_by = $1",
      [userId],
    );
    return rows[0].n as number;
  }

  it("re-posting the same puzzle by one account collapses to the existing row: 200 + duplicate, same id (D23)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });

    const first = await postJson("/puzzles", token, FIXTURE);
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { puzzleId: string }).puzzleId;

    const second = await postJson("/puzzles", token, FIXTURE);
    expect(second.status).toBe(200);
    const body = (await second.json()) as {
      puzzleId: string;
      duplicate?: boolean;
    };
    expect(body.duplicate).toBe(true);
    expect(body.puzzleId).toBe(firstId);

    // The re-post resolved to the one row, never a copy.
    expect(await puzzleCount(sub)).toBe(1);

    // The digest is stored server-side and equals the digest of the stored ServerPuzzle.
    const { rows } = await adminPool.query(
      "select data, content_digest from puzzles where puzzle_id = $1",
      [firstId],
    );
    expect(rows[0].content_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].content_digest).toBe(puzzleDigest(rows[0].data));
  });

  it("a fresh insert is 201 and omits the duplicate marker (absent reads as false)", async () => {
    const token = await auth.mintUpgraded({ sub: randomUUID() });
    const res = await postJson("/puzzles", token, FIXTURE);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("duplicate");
  });

  it("a different puzzle by the same account is a new row, not a duplicate: 201 (D23 strict)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });

    const a = await postJson("/puzzles", token, FIXTURE);
    expect(a.status).toBe(201);
    const idA = ((await a.json()) as { puzzleId: string }).puzzleId;

    const b = await postJson("/puzzles", token, OTHER);
    expect(b.status).toBe(201);
    const idB = ((await b.json()) as { puzzleId: string }).puzzleId;

    expect(idB).not.toBe(idA);
    expect(await puzzleCount(sub)).toBe(2);
  });

  it("the same puzzle from a DIFFERENT account is not a duplicate: 201, its own row (per-account scope, D21)", async () => {
    const subA = randomUUID();
    const subB = randomUUID();
    const a = await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub: subA }),
      FIXTURE,
    );
    expect(a.status).toBe(201);
    const idA = ((await a.json()) as { puzzleId: string }).puzzleId;

    const b = await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub: subB }),
      FIXTURE,
    );
    // B has never uploaded this: it is a fresh insert for B, not "someone already has it".
    expect(b.status).toBe(201);
    const bBody = (await b.json()) as { puzzleId: string; duplicate?: boolean };
    expect(bBody.duplicate).toBeUndefined();
    expect(bBody.puzzleId).not.toBe(idA);
    expect(await puzzleCount(subA)).toBe(1);
    expect(await puzzleCount(subB)).toBe(1);
  });

  it("the duplicate response carries no solution and no digest anywhere (INV-6)", async () => {
    const token = await auth.mintUpgraded({ sub: randomUUID() });
    const firstRes = await postJson("/puzzles", token, FIXTURE);
    const firstId = ((await firstRes.json()) as { puzzleId: string }).puzzleId;
    const { rows } = await adminPool.query(
      "select content_digest from puzzles where puzzle_id = $1",
      [firstId],
    );
    const digest = rows[0].content_digest as string;

    const res = await postJson("/puzzles", token, FIXTURE);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "content_digest")).toBe(false);
    expect(hasKeyDeep(body, "digest")).toBe(false);
    // The solution-derived digest must never ride the wire, even as an opaque string.
    expect(text).not.toContain(digest);
  });

  it("two concurrent identical posts race to exactly one row: one 201, one 200 (ON CONFLICT atomic)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    // Warm the account with a distinct puzzle first, so this asserts the dedup race, not the
    // JIT user-upsert race.
    expect((await postJson("/puzzles", token, OTHER)).status).toBe(201);

    const [x, y] = await Promise.all([
      postJson("/puzzles", token, FIXTURE),
      postJson("/puzzles", token, FIXTURE),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 201]);
    const idX = ((await x.json()) as { puzzleId: string }).puzzleId;
    const idY = ((await y.json()) as { puzzleId: string }).puzzleId;
    expect(idX).toBe(idY);
    expect(await puzzleCount(sub)).toBe(2); // OTHER + the single FIXTURE row
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

  it("captures clue markup as runs at ingest and passes them through the ClientPuzzle view (owner ruling 2026-07-12; INV-6)", async () => {
    // A styled clue carries {text, runs}; a plain clue stays a bare string. Prove the runs survive
    // the jsonb store AND the ClientPuzzle projection (toClientPuzzle keeps every PuzzleBase field),
    // and that INV-6 is untouched (no solution key rides the runs-bearing view).
    const token = await auth.mintUpgraded();
    const doc = {
      size: { rows: 2, cols: 2 },
      grid: ["H", "I", "O", "N"],
      clues: {
        across: ["1. plain opener", "3. <b>bold</b> basics"],
        down: ["1. up top", "2. H<sub>2</sub>O beside"],
      },
    };
    const res = await postJson("/puzzles", token, doc);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      puzzleId: string;
      puzzle: { clues: { across: unknown[]; down: unknown[] } };
    };
    // The ClientPuzzle view (the POST response `puzzle`) carries runs on the styled clues only.
    expect(hasKeyDeep(body.puzzle, "solution")).toBe(false);
    expect(body.puzzle.clues.across).toEqual([
      { number: 1, text: "plain opener", cellIndices: [0, 1] },
      {
        number: 3,
        text: "bold basics",
        cellIndices: [2, 3],
        runs: [{ t: "bold", s: ["b"] }, { t: " basics" }],
      },
    ]);
    expect(body.puzzle.clues.down).toEqual([
      { number: 1, text: "up top", cellIndices: [0, 2] },
      {
        number: 2,
        text: "H2O beside",
        cellIndices: [1, 3],
        runs: [{ t: "H" }, { t: "2", s: ["sub"] }, { t: "O beside" }],
      },
    ]);
    // The stored server model carries the same runs (jsonb round-trip) alongside the solution.
    const { rows } = await adminPool.query(
      "select data from puzzles where puzzle_id = $1",
      [body.puzzleId],
    );
    expect(rows[0].data.clues.across[1]).toEqual({
      number: 3,
      text: "bold basics",
      cellIndices: [2, 3],
      runs: [{ t: "bold", s: ["b"] }, { t: " basics" }],
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

describe("POST /puzzles envelope dispatch (PROTOCOL.md §12; DESIGN.md §7, D21; ROADMAP 6.1 x1)", () => {
  const MARKER = "MARKERWORD";

  /** Read the stored `source` jsonb for one puzzle via the superuser inspection pool. */
  async function storedSource(puzzleId: string): Promise<unknown> {
    const { rows } = await adminPool.query(
      "select source from puzzles where puzzle_id = $1",
      [puzzleId],
    );
    return rows[0].source;
  }

  it("stores source {kind: 'upload', format: 'xwordinfo'} on the legacy bare path", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, FIXTURE);
    expect(res.status).toBe(201);
    const { puzzleId } = (await res.json()) as { puzzleId: string };
    expect(await storedSource(puzzleId)).toEqual({
      kind: "upload",
      format: "xwordinfo",
    });
  });

  it("ingests the {format, document} envelope equivalently to the bare body, same source", async () => {
    // Distinct accounts, so this proves translation equivalence in isolation from dedup (D23):
    // the same content by one account would collapse (covered in the dedup suite); across two it
    // is two fresh 201s whose projected puzzles must match.
    const bare = await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub: randomUUID() }),
      FIXTURE,
    );
    const enveloped = await postJson(
      "/puzzles",
      await auth.mintUpgraded({ sub: randomUUID() }),
      { format: "xwordinfo", document: FIXTURE },
    );
    expect(bare.status).toBe(201);
    expect(enveloped.status).toBe(201);
    const bareBody = (await bare.json()) as {
      puzzleId: string;
      puzzle: unknown;
    };
    const envBody = (await enveloped.json()) as {
      puzzleId: string;
      puzzle: unknown;
    };
    expect(envBody.puzzle).toEqual(bareBody.puzzle);
    expect(await storedSource(envBody.puzzleId)).toEqual({
      kind: "upload",
      format: "xwordinfo",
    });
  });

  it("rejects an unknown format as UNKNOWN_FORMAT 400, naming the format, never the document (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      format: "nonesuch",
      document: { grid: [MARKER], answer: MARKER },
    });
    await expectRejectionNoLeak(res, 400, "UNKNOWN_FORMAT", MARKER);
  });

  it("rejects format without document as VALIDATION 400, never echoing the body (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      format: "xwordinfo",
      extra: MARKER,
    });
    await expectRejectionNoLeak(res, 400, "VALIDATION", MARKER);
  });

  it("rejects a non-string format as VALIDATION 400, never echoing the document (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      format: 42,
      document: { grid: [MARKER] },
    });
    await expectRejectionNoLeak(res, 400, "VALIDATION", MARKER);
  });

  // A synthetic Guardian-shaped 3x3 (never real Guardian content, DESIGN.md §7): CAT/DOG
  // across, CUD/TAG down, center block. Positions are 0-based {x, y}.
  const guardianEntry = (
    id: string,
    clue: string,
    direction: string,
    x: number,
    y: number,
    solution: string,
  ) => ({
    id,
    humanNumber: id.split("-")[0],
    clue,
    direction,
    length: 3,
    group: [id],
    position: { x, y },
    separatorLocations: {},
    solution,
  });
  const guardianDoc = () => ({
    id: "crosswords/quick/1",
    name: "Synthetic quick No 1",
    dimensions: { cols: 3, rows: 3 },
    solutionAvailable: true,
    entries: [
      guardianEntry("1-across", "Feline (3)", "across", 0, 0, "CAT"),
      guardianEntry("1-down", "Chewed morsel (3)", "down", 0, 0, "CUD"),
      guardianEntry("2-down", "Label (3)", "down", 2, 0, "TAG"),
      guardianEntry("3-across", "Canine (3)", "across", 0, 2, "DOG"),
    ],
  });

  it("ingests a guardian envelope: stored solution server-side, ClientPuzzle view, source format (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      format: "guardian",
      document: guardianDoc(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      puzzleId: string;
      puzzle: Record<string, unknown>;
    };
    expect(hasKeyDeep(body.puzzle, "solution")).toBe(false);
    expect(body.puzzle.blocks).toEqual([4]);
    expect(await storedSource(body.puzzleId)).toEqual({
      kind: "upload",
      format: "guardian",
    });
    const { rows } = await adminPool.query(
      "select data from puzzles where puzzle_id = $1",
      [body.puzzleId],
    );
    expect(rows[0].data.solution).toEqual([
      "C",
      "A",
      "T",
      "U",
      null,
      "A",
      "D",
      "O",
      "G",
    ]);
  });

  it("rejects a guardian document with solutionAvailable false as SOLUTION_MISSING 422, no leak (INV-6, D11)", async () => {
    const token = await auth.mintUpgraded();
    const doc = guardianDoc();
    const res = await postJson("/puzzles", token, {
      format: "guardian",
      document: { ...doc, solutionAvailable: false },
    });
    await expectRejectionNoLeak(res, 422, "SOLUTION_MISSING", "CAT");
  });

  it("applies the shared domain rejections to guardian documents (OVERSIZE_GRID 422)", async () => {
    const token = await auth.mintUpgraded();
    const doc = guardianDoc();
    const res = await postJson("/puzzles", token, {
      format: "guardian",
      document: { ...doc, dimensions: { cols: 26, rows: 3 } },
    });
    await expectRejectionNoLeak(res, 422, "OVERSIZE_GRID", "CAT");
  });

  // A synthetic AmuseLabs (PuzzleMe) 3x3 (never real AmuseLabs content, DESIGN.md §7): the same
  // CAT/DOG grid as decoded JSON. The box is column-major (box[col][row], xword-dl reference)
  // and the envelope document is the base64 blob, encoded here exactly as the extension would
  // find it in the page (the extension never decodes, PROTOCOL.md §12).
  const amuseDoc = () => ({
    title: "Synthetic PuzzleMe No 1",
    author: "Synthia",
    w: 3,
    h: 3,
    box: [
      ["C", "U", "D"],
      ["A", "\u0000", "O"],
      ["T", "A", "G"],
    ],
    placedWords: [
      { clue: { clue: "Feline (3)" }, acrossNotDown: true, x: 0, y: 0 },
      { clue: { clue: "Chewed morsel (3)" }, acrossNotDown: false, x: 0, y: 0 },
      { clue: { clue: "Label (3)" }, acrossNotDown: false, x: 2, y: 0 },
      { clue: { clue: "Canine (3)" }, acrossNotDown: true, x: 0, y: 2 },
    ],
  });
  const amuseBlob = (doc: unknown) =>
    Buffer.from(JSON.stringify(doc), "utf8").toString("base64");

  it("ingests an amuselabs envelope: blob decoded server-side, ClientPuzzle view, source format (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      format: "amuselabs",
      document: amuseBlob(amuseDoc()),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      puzzleId: string;
      puzzle: Record<string, unknown>;
    };
    expect(hasKeyDeep(body.puzzle, "solution")).toBe(false);
    expect(body.puzzle.blocks).toEqual([4]);
    expect(await storedSource(body.puzzleId)).toEqual({
      kind: "upload",
      format: "amuselabs",
    });
    const { rows } = await adminPool.query(
      "select data from puzzles where puzzle_id = $1",
      [body.puzzleId],
    );
    expect(rows[0].data.solution).toEqual([
      "C",
      "A",
      "T",
      "U",
      null,
      "A",
      "D",
      "O",
      "G",
    ]);
  });

  it("rejects an amuselabs blob with empty answer cells as SOLUTION_MISSING 422, no leak (INV-6, D11)", async () => {
    const token = await auth.mintUpgraded();
    const doc = amuseDoc();
    doc.box[0] = ["", "U", "D"]; // an empty cell: the outlet served no answer there
    const res = await postJson("/puzzles", token, {
      format: "amuselabs",
      document: amuseBlob(doc),
    });
    await expectRejectionNoLeak(res, 422, "SOLUTION_MISSING", "TAG");
  });

  // A synthetic NYT v6 3x3 (never real NYT content, DESIGN.md §7): the same CAT/DOG grid in the
  // v6 body shape. Blocks are the empty object `{}` (the reference's falsy rule); cells are
  // row-major; clue entries carry the covered cell indices and capitalized directions.
  const nytClue = (cells: number[], direction: string, plain: string) => ({
    cells,
    direction,
    label: "99",
    text: [{ plain }],
  });
  const nytDoc = () => ({
    body: [
      {
        cells: [
          { answer: "C", label: "1" },
          { answer: "A" },
          { answer: "T", label: "2" },
          { answer: "U" },
          {},
          { answer: "A" },
          { answer: "D", label: "3" },
          { answer: "O" },
          { answer: "G" },
        ] as Record<string, unknown>[],
        clues: [
          nytClue([0, 1, 2], "Across", "Feline (3)"),
          nytClue([6, 7, 8], "Across", "Canine (3)"),
          nytClue([0, 3, 6], "Down", "Chewed morsel (3)"),
          nytClue([2, 5, 8], "Down", "Label (3)"),
        ],
        dimensions: { width: 3, height: 3 },
      },
    ],
    constructors: ["Synthia Synthetic"],
    publicationDate: "2026-01-01",
  });

  it("ingests a nyt envelope: v6 body translated, ClientPuzzle view, source format (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      format: "nyt",
      document: nytDoc(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      puzzleId: string;
      puzzle: Record<string, unknown>;
    };
    expect(hasKeyDeep(body.puzzle, "solution")).toBe(false);
    expect(body.puzzle.blocks).toEqual([4]);
    expect(await storedSource(body.puzzleId)).toEqual({
      kind: "upload",
      format: "nyt",
    });
    const { rows } = await adminPool.query(
      "select data from puzzles where puzzle_id = $1",
      [body.puzzleId],
    );
    expect(rows[0].data.solution).toEqual([
      "C",
      "A",
      "T",
      "U",
      null,
      "A",
      "D",
      "O",
      "G",
    ]);
  });

  it("rejects a stripped nyt payload (no answers) as SOLUTION_MISSING 422, no leak (INV-6, D11)", async () => {
    const token = await auth.mintUpgraded();
    const doc = nytDoc();
    // The unauthenticated shape: one answer survives as the planted marker, the next playable
    // cell is stripped to its label, which trips the code; the marker must never echo.
    doc.body[0]!.cells[0] = { answer: "MARKERWORD", label: "1" };
    doc.body[0]!.cells[1] = { label: "" };
    const res = await postJson("/puzzles", token, {
      format: "nyt",
      document: doc,
    });
    await expectRejectionNoLeak(res, 422, "SOLUTION_MISSING", "MARKERWORD");
  });

  // A synthetic `.puz` (Across Lite) file, built BYTE BY BYTE with real checksums (never a
  // captured real puzzle, DESIGN.md §7): the same CAT/DOG 3x3 grid. `.puz` is binary, so the
  // envelope document is standard base64 of the file bytes (PROTOCOL.md §12); the extension never
  // decodes it. This tiny builder mirrors the unit-test builder just enough for the golden path.
  const puzChecksum = (bytes: Buffer, seed = 0): number => {
    let sum = seed & 0xffff;
    for (const b of bytes) {
      sum = (sum >>> 1) | ((sum & 1) << 15);
      sum = (sum + b) & 0xffff;
    }
    return sum;
  };
  const puzTextChecksum = (
    seed: number,
    strings: {
      title: string;
      author: string;
      copyright: string;
      clues: string[];
    },
  ): number => {
    let sum = seed;
    const withNul = (s: string): void => {
      if (s === "") return;
      sum = puzChecksum(
        Buffer.concat([Buffer.from(s, "latin1"), Buffer.from([0])]),
        sum,
      );
    };
    withNul(strings.title);
    withNul(strings.author);
    withNul(strings.copyright);
    for (const c of strings.clues)
      sum = puzChecksum(Buffer.from(c, "latin1"), sum);
    withNul(""); // empty notepad
    return sum;
  };
  const buildPuzBase64 = (): string => {
    const grid = "CATU.ADOG"; // CAT / U#A / DOG
    const clues = [
      "Feline (3)",
      "Chewed morsel (3)",
      "Label (3)",
      "Canine (3)",
    ];
    const strings = {
      title: "Synthetic Puzzle",
      author: "Synthia",
      copyright: "(c) 2026",
      clues,
    };
    const solution = Buffer.from(grid, "latin1");
    const player = Buffer.from(
      grid
        .split("")
        .map((c) => (c === "." ? "." : "-"))
        .join(""),
      "latin1",
    );
    const stringBlock = Buffer.concat([
      Buffer.from(`${strings.title}\0`, "latin1"),
      Buffer.from(`${strings.author}\0`, "latin1"),
      Buffer.from(`${strings.copyright}\0`, "latin1"),
      ...clues.map((c) => Buffer.from(`${c}\0`, "latin1")),
      Buffer.from("\0", "latin1"), // empty notepad
    ]);
    const header = Buffer.alloc(0x34);
    header.write("ACROSS&DOWN\0", 0x02, "latin1");
    header.write("1.3\0", 0x18, "latin1");
    header.writeUInt8(3, 0x2c);
    header.writeUInt8(3, 0x2d);
    header.writeUInt16LE(clues.length, 0x2e);
    header.writeUInt16LE(0x0001, 0x30);
    const cib = puzChecksum(header.subarray(0x2c, 0x34));
    header.writeUInt16LE(cib, 0x0e);
    let global = puzChecksum(solution, cib);
    global = puzChecksum(player, global);
    global = puzTextChecksum(global, strings);
    header.writeUInt16LE(global, 0x00);
    const partials = [
      cib,
      puzChecksum(solution),
      puzChecksum(player),
      puzTextChecksum(0, strings),
    ];
    const mask = "ICHEATED";
    for (let i = 0; i < 4; i += 1) {
      header.writeUInt8((partials[i]! & 0xff) ^ mask.charCodeAt(i), 0x10 + i);
      header.writeUInt8(
        ((partials[i]! >> 8) & 0xff) ^ mask.charCodeAt(i + 4),
        0x14 + i,
      );
    }
    return Buffer.concat([header, solution, player, stringBlock]).toString(
      "base64",
    );
  };

  it("ingests a puz envelope: base64 file decoded server-side, ClientPuzzle view, source format (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const res = await postJson("/puzzles", token, {
      format: "puz",
      document: buildPuzBase64(),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      puzzleId: string;
      puzzle: Record<string, unknown>;
    };
    expect(hasKeyDeep(body.puzzle, "solution")).toBe(false);
    expect(body.puzzle.blocks).toEqual([4]);
    expect(await storedSource(body.puzzleId)).toEqual({
      kind: "upload",
      format: "puz",
    });
    const { rows } = await adminPool.query(
      "select data from puzzles where puzzle_id = $1",
      [body.puzzleId],
    );
    expect(rows[0].data.solution).toEqual([
      "C",
      "A",
      "T",
      "U",
      null,
      "A",
      "D",
      "O",
      "G",
    ]);
  });

  it("rejects a corrupt puz file (a flipped grid byte) as VALIDATION 400, no leak (INV-6)", async () => {
    const token = await auth.mintUpgraded();
    const bytes = Buffer.from(buildPuzBase64(), "base64");
    bytes[0x34] = 0x58; // flip the first solution cell without recomputing the checksum
    const res = await postJson("/puzzles", token, {
      format: "puz",
      document: bytes.toString("base64"),
    });
    await expectRejectionNoLeak(res, 400, "VALIDATION");
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

describe("invite host GET /{code} (PROTOCOL.md §12 Invite links)", () => {
  it("302s a real browser navigation to the canonical game view", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const res = await app.request(`https://${INVITE_HOST}/${inviteCode}`, {
      headers: { "sec-fetch-mode": "navigate" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${WEB_ORIGIN}/game/${gameId}?code=${inviteCode}`,
    );
  });

  it("serves a 200 OpenGraph shell that forwards to the game for a link unfurler (no navigate signal)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const res = await app.request(`https://${INVITE_HOST}/${inviteCode}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    // The OG card is present, and the shell forwards a browser onward to the canonical game URL.
    expect(html).toContain('property="og:title"');
    expect(html).toContain(`${WEB_ORIGIN}/game/${gameId}?code=${inviteCode}`);
  });

  it("resolves a lowercase code (INV-1 ASCII-uppercasing), same as join-by-code", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const res = await app.request(
      `https://${INVITE_HOST}/${inviteCode.toLowerCase()}`,
      { headers: { "sec-fetch-mode": "navigate" } },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `${WEB_ORIGIN}/game/${gameId}?code=${inviteCode}`,
    );
  });

  it("bounces a well-formed but unknown code to the web home, not an oracle 404 (INV-6)", async () => {
    // Shape-valid (8 chars from the alphabet) but not a code this suite minted (a 32^8 space).
    const res = await app.request(`https://${INVITE_HOST}/ABCD2345`, {
      headers: { "sec-fetch-mode": "navigate" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${WEB_ORIGIN}/`);
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

  it("carries the puzzle's display title and author on the view (additive expand, PROTOCOL.md §12, §14)", async () => {
    const host = await auth.mintUpgraded();
    // A titled document: the XWord Info metadata fields ride ingestion into the
    // puzzles row (readMetadata), and the view reads them back from that row only.
    fixtureSeq += 1;
    const doc = {
      ...FIXTURE,
      title: "Saturday Stumper",
      author: "E. Longo",
      clues: {
        ...FIXTURE.clues,
        across: [`1. friendly opener ${fixtureSeq}`, "3. keyboard basics"],
      },
    };
    const posted = await postJson("/puzzles", host, doc);
    expect(posted.status).toBe(201);
    const { puzzleId } = (await posted.json()) as { puzzleId: string };
    const { gameId } = await createGame(host, puzzleId);

    const res = await get(`/games/${gameId}`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      puzzleTitle: string | null;
      puzzleAuthor: string | null;
      puzzle: Record<string, unknown>;
    };
    expect(body.puzzleTitle).toBe("Saturday Stumper");
    expect(body.puzzleAuthor).toBe("E. Longo");
    // The fields sit beside `puzzle`, which stays exactly ClientPuzzle (INV-6:
    // structural, so no new field creeps into the solve payload).
    expect(body.puzzle).not.toHaveProperty("author");
  });

  it("reads puzzleTitle and puzzleAuthor as null when the document carried none (first-class null)", async () => {
    const host = await auth.mintUpgraded();
    const puzzleId = await ingestFixture(host); // the bare fixture has no metadata
    const { gameId } = await createGame(host, puzzleId);

    const res = await get(`/games/${gameId}`, host);
    const body = (await res.json()) as {
      puzzleTitle: string | null;
      puzzleAuthor: string | null;
    };
    expect(body.puzzleTitle).toBeNull();
    expect(body.puzzleAuthor).toBeNull();
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
 * completed game; a non-null `abandonedAt` seeds a host-ended one; both null (the default) leaves
 * it ongoing. The two terminal timestamps are mutually exclusive (INV-4), so a caller passes one or
 * the other, never both. The API reads this row under its SELECT-only grant (migration 0005), never
 * writes it, so this fixture is the only way a test can put a game into a terminal state without a
 * live actor.
 */
async function seedGameState(
  gameId: string,
  completedAt: string | null,
  abandonedAt: string | null = null,
): Promise<void> {
  const status =
    completedAt !== null
      ? "completed"
      : abandonedAt !== null
        ? "abandoned"
        : "ongoing";
  await adminPool.query(
    `insert into game_state (game_id, status, completed_at, abandoned_at)
       values ($1, $2, $3, $4)
     on conflict (game_id) do update set status = excluded.status, completed_at = excluded.completed_at, abandoned_at = excluded.abandoned_at`,
    [gameId, status, completedAt, abandonedAt],
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
    members: {
      userId: string;
      name: string;
      avatarUrl: string | null;
      role: string;
    }[];
    inviteCode: string;
    completedAt: string | null;
    abandonedAt: string | null;
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

  it("carries each row's member stack {userId, name, avatarUrl, role}, join-ordered and consistent with memberCount (PROTOCOL.md §12)", async () => {
    // The row member stack: the full membership as display identity, the §4 participant's
    // resolution (name and avatar from the identity mirror), so the room-open chrome and the
    // card's avatar stack read true at tap time without a second fetch.
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({
      sub: hostSub,
      userMetadata: {
        full_name: "Ada",
        avatar_url: "https://cdn.discordapp.com/avatars/a.png",
      },
    });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);

    const solverSub = randomUUID();
    const solver = await auth.mintUpgraded({
      sub: solverSub,
      userMetadata: { full_name: "Bo" },
    });
    await join(gameId, solver, inviteCode);
    const guestSub = randomUUID();
    const guest = await auth.mintAnonymous({ sub: guestSub });
    await join(gameId, guest, inviteCode);

    const { games } = (await get("/games", host).then((r) =>
      r.json(),
    )) as GamesList;
    const row = games.find((g) => g.gameId === gameId)!;
    // The stack is the whole membership: consistent with the count, never a sample.
    expect(row.members).toHaveLength(row.memberCount);
    expect(row.members).toHaveLength(3);
    // Join-ordered, first joiner first: the host's membership is born with the game.
    expect(row.members.map((m) => m.userId)).toEqual([
      hostSub,
      solverSub,
      guestSub,
    ]);
    const byUser = new Map(row.members.map((m) => [m.userId, m]));
    // The resolved §4 display identity, mirrored from users (name and avatar cannot drift
    // from the live roster's, which reads the same row).
    expect(byUser.get(hostSub)).toEqual({
      userId: hostSub,
      name: "Ada",
      avatarUrl: "https://cdn.discordapp.com/avatars/a.png",
      role: "host",
    });
    expect(byUser.get(solverSub)!.name).toBe("Bo");
    expect(byUser.get(solverSub)!.avatarUrl).toBeNull(); // no avatar, no email: first-class null
    expect(byUser.get(solverSub)!.role).toBe("solver");
    // The solvers/spectators fact rides `role`; a guest seats spectator and there is NO guest
    // flag on the wire (§12), so the standing solvers-only filters apply from `role` alone.
    expect(byUser.get(guestSub)!.role).toBe("spectator");
    expect(byUser.get(guestSub)!.name).toBe("Guest"); // the mirror's anonymous display name
    expect(row.members.every((m) => !("isAnonymous" in m))).toBe(true);
  });

  it("falls back to the §4 former-participant name where the mirror holds none (PROTOCOL.md §12; DESIGN.md §8)", async () => {
    // A full account whose token carries no metadata name mirrors display_name NULL. The wire
    // name is never null: the row sends the same fallback the session's participant payload
    // sends, so the two surfaces read one value.
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub }); // no userMetadata: displayName null
    const puzzleId = await ingestFixture(caller);
    const { gameId } = await createGame(caller, puzzleId);

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    const row = games.find((g) => g.gameId === gameId)!;
    expect(row.members).toEqual([
      {
        userId: sub,
        name: "former participant",
        avatarUrl: null,
        role: "host",
      },
    ]);
  });

  it("never leaks an email through the member stack; a Gravatar avatarUrl arrives resolved (INV-6 spirit)", async () => {
    // Email-only identity: the port derives the Gravatar URL server-side and the mirror stores
    // only the resolved URL, so the list (like the view) can never surface the email.
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub, email: "ada@example.com" });
    const puzzleId = await ingestFixture(caller);
    const { gameId } = await createGame(caller, puzzleId);

    const res = await get("/games", caller);
    const raw = await res.text();
    expect(raw).not.toContain("ada@example.com");
    const { games } = JSON.parse(raw) as GamesList;
    const member = games
      .find((g) => g.gameId === gameId)!
      .members.find((m) => m.userId === sub);
    expect(member?.avatarUrl).toMatch(
      /^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{32}\?d=404$/,
    );
  });

  it("carries the row's inviteCode to every member under the view's member-only rule (PROTOCOL.md §12)", async () => {
    // The list is member-scoped by construction (the membership join), so each row's reader is
    // a member: exactly the GET /games/{id} rule, never wider. Any role qualifies, a guest
    // spectator included, since every member joined via the code.
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    const guest = await auth.mintAnonymous({ sub: randomUUID() });
    await join(gameId, guest, inviteCode);

    const hostList = (await get("/games", host).then((r) =>
      r.json(),
    )) as GamesList;
    expect(hostList.games.find((g) => g.gameId === gameId)!.inviteCode).toBe(
      inviteCode,
    );
    const guestList = (await get("/games", guest).then((r) =>
      r.json(),
    )) as GamesList;
    expect(guestList.games.find((g) => g.gameId === gameId)!.inviteCode).toBe(
      inviteCode,
    );
    // A non-member never receives the row at all (the visibility test above), so there is no
    // wider path to the code: the stranger's list simply has no such game.
    const stranger = await auth.mintUpgraded({ sub: randomUUID() });
    const strangerList = (await get("/games", stranger).then((r) =>
      r.json(),
    )) as GamesList;
    expect(strangerList.games.map((g) => g.gameId)).not.toContain(gameId);
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

  it("sorts by activity when it is more recent than a rival's creation (PROTOCOL.md §12)", async () => {
    // A played game outranks a rival created before its last touch: the coalesce key COALESCE(
    // lastActivityAt, createdAt) puts the recent activity ahead of the older creation time.
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub });
    const puzzleId = await ingestFixture(caller);
    const { gameId: unplayedOld } = await createGame(caller, puzzleId);
    const { gameId: playedOld } = await createGame(caller, puzzleId);
    await setGameCreatedAt(playedOld, "2026-02-01T00:00:00.000Z");
    await setGameCreatedAt(unplayedOld, "2026-02-09T00:00:00.000Z");
    // The old game has recent activity, later than the rival's creation.
    await seedCellEvent(playedOld, sub, 1, "2026-06-01T12:00:00.000Z");

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    expect(games.map((g) => g.gameId)).toEqual([playedOld, unplayedOld]);
    expect(
      games.find((g) => g.gameId === unplayedOld)!.lastActivityAt,
    ).toBeNull();
  });

  it("sorts a freshly created unplayed game above an older game with older activity (coalesce rule; PROTOCOL.md §12)", async () => {
    // Owner ruling: creating a room is its first activity, so the sort key is COALESCE(
    // lastActivityAt, createdAt). A brand-new unplayed game (recent createdAt, no events) must
    // outrank an older game whose last activity predates that creation, NOT sort below it.
    const sub = randomUUID();
    const caller = await auth.mintUpgraded({ sub });
    const puzzleId = await ingestFixture(caller);
    const { gameId: playedOld } = await createGame(caller, puzzleId);
    const { gameId: freshUnplayed } = await createGame(caller, puzzleId);
    await setGameCreatedAt(playedOld, "2026-02-01T00:00:00.000Z");
    // The fresh game is created AFTER the old game's last activity.
    await setGameCreatedAt(freshUnplayed, "2026-06-10T00:00:00.000Z");
    await seedCellEvent(playedOld, sub, 1, "2026-06-01T12:00:00.000Z");

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    // Coalesce: freshUnplayed keys on its createdAt (2026-06-10), which is newer than
    // playedOld's activity (2026-06-01), so the fresh room leads.
    expect(games.map((g) => g.gameId)).toEqual([freshUnplayed, playedOld]);
    // The wire shape is unchanged: an unplayed game still reports null activity.
    expect(
      games.find((g) => g.gameId === freshUnplayed)!.lastActivityAt,
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

  it("reports abandonedAt for a host-ended game, its own terminal timestamp distinct from completedAt (read expand; INV-7)", async () => {
    const caller = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(caller);
    const { gameId: ended } = await createGame(caller, puzzleId);
    const { gameId: done } = await createGame(caller, puzzleId);
    const { gameId: ongoing } = await createGame(caller, puzzleId);

    // The session (here the superuser fixture) materializes game_state: `ended` was abandoned by
    // its host, `done` completed, `ongoing` has a row but neither terminal timestamp.
    const abandonedIso = "2026-06-03T08:15:00.000Z";
    const completedIso = "2026-06-01T12:00:00.000Z";
    await seedGameState(ended, null, abandonedIso);
    await seedGameState(done, completedIso);
    await seedGameState(ongoing, null);

    const { games } = (await get("/games", caller).then((r) =>
      r.json(),
    )) as GamesList;
    const byId = new Map(games.map((g) => [g.gameId, g]));
    // An abandoned game reports abandonedAt and never completedAt: the two terminal timestamps are
    // mutually exclusive (INV-4), so a client shelves it as ended, not as solved, and not as live.
    expect(byId.get(ended)!.abandonedAt).toBe(abandonedIso);
    expect(byId.get(ended)!.completedAt).toBeNull();
    // A completed game carries completedAt, never abandonedAt.
    expect(byId.get(done)!.abandonedAt).toBeNull();
    expect(byId.get(done)!.completedAt).toBe(completedIso);
    // An ongoing game carries neither terminal timestamp.
    expect(byId.get(ongoing)!.abandonedAt).toBeNull();
    expect(byId.get(ongoing)!.completedAt).toBeNull();
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

  it("fires the welcome notice to the session after a successful registration (PROTOCOL.md 12a)", async () => {
    resetRecorders();
    const hostSub = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostSub });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    const res = await postJson(`/games/${gameId}/live-activity-tokens`, host, {
      token: tokenFor("welcome"),
      environment: "sandbox",
    });
    expect(res.status).toBe(204);
    // The API signalled the session over the same internal channel the kick flow uses, naming the
    // game and the registering member, so the emitter can hand that member's tokens the current frame.
    expect(welcomeCalls).toContainEqual({ gameId, userId: hostSub });
  });

  it("a failed welcome notice is log-and-drop: registration still succeeds with 204", async () => {
    resetRecorders();
    welcomeShouldFail = true;
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const token = tokenFor("welcome-fail");

    const res = await postJson(`/games/${gameId}/live-activity-tokens`, host, {
      token,
      environment: "sandbox",
    });
    // The notice threw, but the registration already committed: 204 stands and the row is written.
    expect(res.status).toBe(204);
    const rows = await adminPool.query(
      "select 1 from live_activity_tokens where token=$1",
      [token],
    );
    expect(rows.rows).toHaveLength(1);
    resetRecorders();
  });

  it("a non-member registration never reaches the welcome notice (gate before the signal)", async () => {
    resetRecorders();
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    const stranger = await auth.mintUpgraded({ sub: randomUUID() });

    const res = await postJson(
      `/games/${gameId}/live-activity-tokens`,
      stranger,
      { token: tokenFor("stranger-welcome"), environment: "sandbox" },
    );
    expect(res.status).toBe(403);
    // The membership gate refused before the upsert, so no welcome was signalled for the stranger.
    expect(welcomeCalls).toHaveLength(0);
  });
});

describe("signup starter seed (DESIGN.md §8; INV-6 no-solution-leak; INV-7 users/games single writer)", () => {
  // A dedicated app with seeding ON. The suite's shared `app` keeps it OFF, so every other
  // GET /games assertion runs against a clean slate (the seed is a composition-root switch).
  let seedApp: Hono<ApiEnv>;
  beforeAll(() => {
    seedApp = buildApp({
      db: createDb(apiPool),
      authPort: auth,
      sessionWsBase: SESSION_WS_BASE,
      starterSeedEnabled: true,
      membershipNotifier,
      vendorIdentity,
    });
  });

  /** Every game a user belongs to, joined to its membership role, read as admin. */
  async function gamesOf(
    sub: string,
  ): Promise<
    { game_id: string; name: string; puzzle_id: string; role: string }[]
  > {
    const { rows } = await adminPool.query(
      `select g.game_id, g.name, g.puzzle_id, m.role
         from games g join memberships m on m.game_id = g.game_id
        where m.user_id = $1`,
      [sub],
    );
    return rows;
  }

  /** Puzzles the user owns (created_by), read as admin. */
  async function ownedPuzzles(
    sub: string,
  ): Promise<{ puzzle_id: string; title: string | null }[]> {
    const { rows } = await adminPool.query(
      "select puzzle_id, title from puzzles where created_by = $1",
      [sub],
    );
    return rows;
  }

  it("seeds one solo starter game on a user-owned puzzle the first time a full account is seen (INV-7)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    const res = await seedApp.request("/games", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const games = await gamesOf(sub);
    expect(games).toHaveLength(1);
    expect(games[0]!.name).toBe(STARTER_GAME_NAME);
    expect(games[0]!.role).toBe("host");
    // The user owns their own copy of the starter puzzle, and the game points at it.
    const owned = await ownedPuzzles(sub);
    expect(owned).toHaveLength(1);
    expect(owned[0]!.title).toBe(STARTER_PUZZLE_TITLE);
    expect(games[0]!.puzzle_id).toBe(owned[0]!.puzzle_id);
    // It surfaces in the owned-puzzles list (GET /puzzles filters created_by = caller).
    const listRes = await seedApp.request("/puzzles", {
      headers: { authorization: `Bearer ${token}` },
    });
    const list = (await listRes.json()) as {
      puzzles: { title: string | null; features: unknown }[];
    };
    expect(list.puzzles).toHaveLength(1);
    expect(list.puzzles[0]!.title).toBe(STARTER_PUZZLE_TITLE);
    // The seed states the starter's real flags; it never leans on a column default.
    // `GET /puzzles` returns `features` verbatim and the iOS twin decodes all three
    // keys as required, so an empty object here fails the caller's whole puzzles page.
    expect(list.puzzles[0]!.features).toEqual(STARTER_PUZZLE_FEATURES);
  });

  it("never seeds a guest: no game and no owned puzzle (DESIGN.md §8)", async () => {
    const sub = randomUUID();
    await seedApp.request("/games", {
      headers: { authorization: `Bearer ${await auth.mintAnonymous({ sub })}` },
    });
    expect(await gamesOf(sub)).toHaveLength(0);
    expect(await ownedPuzzles(sub)).toHaveLength(0);
  });

  it("seeds once, not on every request: one game and one owned puzzle (idempotent)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    for (let i = 0; i < 3; i += 1) {
      await seedApp.request("/games", {
        headers: { authorization: `Bearer ${token}` },
      });
    }
    expect(await gamesOf(sub)).toHaveLength(1);
    expect(await ownedPuzzles(sub)).toHaveLength(1);
  });

  it("exposes no solution on the seeded game view (INV-6)", async () => {
    const sub = randomUUID();
    const token = await auth.mintUpgraded({ sub });
    await seedApp.request("/games", {
      headers: { authorization: `Bearer ${token}` },
    });
    const game = (await gamesOf(sub))[0]!;
    const res = await seedApp.request(`/games/${game.game_id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(hasKeyDeep(await res.json(), "solution")).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------
// GET /games/{id}/analysis: the Archive post-game analysis bundle (design/post-game/ANALYSIS.md;
// DESIGN.md §7, §9). Reads the session-owned cell_events log (now including `at`) under the API's
// SELECT grant, lifts the Solution from the game's puzzle_snapshot, runs the engine's solveTrace /
// momentum / moments over one trace, and serves the bundle (owners + momentum + moments, userIds /
// cells / numbers only) for completed games only. Replaces /attribution.
// ------------------------------------------------------------------------------------------

/**
 * Append a board event with an explicit `cell` and `value` through the superuser fixture, standing
 * in for the session (the single writer of cell_events, DESIGN.md §9). Unlike `seedCellEvent` (cell
 * 0, throwaway `A`, used for the list's MAX(at) ordering), the analysis read joins the value and
 * cell against the solution, so a test must place real letters at real cells. `seq` orders the log
 * and must be unique per game. `value` may be null (a clear), which is never correct (INV-6-safe:
 * the API never emits the value, only the owner it implies). `at` is the server timestamp the trace
 * bins for momentum and scans for moments; it defaults to `now()` (the gate/authz cases do not
 * care about timing), and the timing cases pass an explicit ISO string so the assertions are
 * deterministic.
 */
async function seedAttributionEvent(
  gameId: string,
  userId: string,
  seq: number,
  cell: number,
  value: string | null,
  at?: string,
): Promise<void> {
  await adminPool.query(
    `insert into cell_events (game_id, seq, cell, user_id, value, at)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()))`,
    [gameId, seq, cell, userId, value, at ?? null],
  );
}

/** The analysis wire shape: the owner map, the momentum ribbon, the named moments, the
 * replay sequence (ordered {cell, atSeconds}, ascending by (at, seq); cells and times only),
 * the solver titles (ordered by ladder rank; userIds, kebab keys, and counts only), and the
 * sittings partition (count, spans on the active axis, the wall-clock span; D29). */
interface AnalysisBody {
  owners: Record<string, string>;
  momentum: { durationSeconds: number; samples: number[] };
  moments: {
    firstToFall: { cell: number; userId: string; atSeconds: number } | null;
    lastSquare: { cell: number; userId: string; atSeconds: number } | null;
    turningPoint: {
      stallSeconds: number;
      breakSeconds: number;
      burst: number;
    } | null;
  };
  sequence: { cell: number; atSeconds: number }[];
  titles: { userId: string; title: string; evidence: number | null }[];
  sittings: {
    count: number;
    spans: { startSeconds: number; endSeconds: number }[];
    wallSeconds: number;
  };
}

describe("GET /games/{id}/analysis (Archive post-game analysis bundle) (design/post-game/ANALYSIS.md; DESIGN.md §7, §9; INV-6)", () => {
  // FIXTURE is a 2x2 all-playable grid with solution ["H","I","O","N"] at cells 0..3.
  it("a completed game yields the first-correct owner map, immune to a later overwrite (scheme 1)", async () => {
    const hostId = randomUUID();
    const mateId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const mate = await auth.mintUpgraded({ sub: mateId });

    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    await join(gameId, mate, inviteCode);

    // The write log: host first-corrects cells 0 (H) and 1 (I); mate first-corrects cell 2 (O).
    // Cell 3 (N) is first typed WRONG by mate (X, not correct), then corrected by host, so host
    // owns cell 3. Then mate OVERWRITES cell 0 with the still-correct H at a later seq: scheme 1
    // must NOT move the owner, host keeps cell 0 (the cleanup-pass-immunity the doc pins).
    await seedAttributionEvent(gameId, hostId, 1, 0, "H"); // host owns 0
    await seedAttributionEvent(gameId, hostId, 2, 1, "I"); // host owns 1
    await seedAttributionEvent(gameId, mateId, 3, 2, "O"); // mate owns 2
    await seedAttributionEvent(gameId, mateId, 4, 3, "X"); // wrong, owns nothing
    await seedAttributionEvent(gameId, hostId, 5, 3, "N"); // host first-corrects 3
    await seedAttributionEvent(gameId, mateId, 6, 0, "H"); // re-correct, must not move owner

    // Gate the game to completed (the session, here the fixture, stamps completed_at).
    await seedGameState(gameId, "2026-06-10T10:00:00.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;
    // First-ever-correct: host owns 0,1,3; mate owns 2. The re-correct of 0 never displaces host.
    expect(body.owners).toEqual({
      "0": hostId,
      "1": hostId,
      "2": mateId,
      "3": hostId,
    });
  });

  it("momentum: a multi-timestamp solve returns 40 samples and the solve's duration (design/post-game/ANALYSIS.md pinned semantics)", async () => {
    const hostId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    // Four first-correct fills spanning a full minute: t0 at :00, tEnd at :60. Duration is 60s and
    // the ribbon is a fixed 40-sample curve regardless of how many fills there are.
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-13T10:00:00.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      2,
      1,
      "I",
      "2026-06-13T10:00:20.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      3,
      2,
      "O",
      "2026-06-13T10:00:40.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      4,
      3,
      "N",
      "2026-06-13T10:01:00.000Z",
    );
    await seedGameState(gameId, "2026-06-13T10:01:00.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;
    // Fixed granularity (N = 40): the server ships one shape both surfaces draw, so its length is
    // invariant. Duration is tEnd - t0 = 60s.
    expect(body.momentum.samples).toHaveLength(40);
    expect(body.momentum.durationSeconds).toBe(60);
    // Peak-normalized: every sample is in [0, 1], and the busiest bucket is exactly 1.
    for (const s of body.momentum.samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...body.momentum.samples)).toBe(1);
    // INV-6: the replay sequence rides the same bundle as {cell, atSeconds} only, ascending by
    // (at, seq), timed from t0. The four fills at :00/:20/:40/:60 land at 0/20/40/60s. No userId
    // and no solution value can surface, only cells and relative times.
    expect(body.sequence).toEqual([
      { cell: 0, atSeconds: 0 },
      { cell: 1, atSeconds: 20 },
      { cell: 2, atSeconds: 40 },
      { cell: 3, atSeconds: 60 },
    ]);
  });

  it("moments: firstToFall, lastSquare, and a turningPoint for a solve with a clear stall (design/post-game/ANALYSIS.md pinned semantics)", async () => {
    const hostId = randomUUID();
    const mateId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const mate = await auth.mintUpgraded({ sub: mateId });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    await join(gameId, mate, inviteCode);

    // A solve with a clear stall: cell 0 at t0, cell 1 ten seconds later, then a LONG 100s pause,
    // then cells 2 and 3 land within a few seconds of each other (the break and its burst). t0 is
    // the earliest at, so all times report relative to it.
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-14T10:00:00.000Z",
    ); // firstToFall
    await seedAttributionEvent(
      gameId,
      mateId,
      2,
      1,
      "I",
      "2026-06-14T10:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      3,
      2,
      "O",
      "2026-06-14T10:01:50.000Z",
    ); // break (ends the 100s stall)
    await seedAttributionEvent(
      gameId,
      mateId,
      4,
      3,
      "N",
      "2026-06-14T10:01:55.000Z",
    ); // lastSquare, inside the burst window
    await seedGameState(gameId, "2026-06-14T10:01:55.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;
    // firstToFall: the earliest at (cell 0, host), atSeconds 0 (t0).
    expect(body.moments.firstToFall).toEqual({
      cell: 0,
      userId: hostId,
      atSeconds: 0,
    });
    // lastSquare: the latest at (cell 3, mate), 115s after t0.
    expect(body.moments.lastSquare).toEqual({
      cell: 3,
      userId: mateId,
      atSeconds: 115,
    });
    // turningPoint: the longest gap is the 100s stall from 10s to 110s; the break is cell 2 at
    // 110s; the burst counts fills in [110s, 140s], which is cells 2 and 3 -> 2.
    expect(body.moments.turningPoint).toEqual({
      stallSeconds: 100,
      breakSeconds: 110,
      burst: 2,
    });
  });

  it("D29: a single-sitting game is the identity mapping and carries a one-span sittings field", async () => {
    const hostId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    // Four fills over one minute, no gap anywhere near SITTING_GAP_MS: the active axis IS the
    // wall axis (the compat proof the contract states), and the partition is one sitting.
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-15T10:00:00.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      2,
      1,
      "I",
      "2026-06-15T10:00:20.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      3,
      2,
      "O",
      "2026-06-15T10:00:40.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      4,
      3,
      "N",
      "2026-06-15T10:01:00.000Z",
    );
    await seedGameState(gameId, "2026-06-15T10:01:00.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;
    // Identity: same duration and sequence a pre-D29 bundle reported.
    expect(body.momentum.durationSeconds).toBe(60);
    expect(body.sequence).toEqual([
      { cell: 0, atSeconds: 0 },
      { cell: 1, atSeconds: 20 },
      { cell: 2, atSeconds: 40 },
      { cell: 3, atSeconds: 60 },
    ]);
    // One sitting, one span [0, durationSeconds], wallSeconds equal to it (PROTOCOL.md §12).
    expect(body.sittings).toEqual({
      count: 1,
      spans: [{ startSeconds: 0, endSeconds: 60 }],
      wallSeconds: 60,
    });
  });

  it("D29: an overnight gap collapses — the bundle measures active time and the sittings field carries the partition", async () => {
    const hostId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);

    // Two sittings eight wall-hours apart: cells 0,1 in the evening; cells 2,3 the next
    // morning, with a real 100s stall INSIDE the second sitting. On the active axis the
    // overnight gap is exactly zero (the seam at 10s), so the turning point is the 100s
    // within-sitting stall, never the night (the D29 re-base the vectors pin).
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-16T10:00:00.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      2,
      1,
      "I",
      "2026-06-16T10:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      3,
      2,
      "O",
      "2026-06-16T18:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      4,
      3,
      "N",
      "2026-06-16T18:01:50.000Z",
    );
    await seedGameState(gameId, "2026-06-16T18:01:50.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;
    // Active duration: 10s evening + 100s morning = 110s, not the 28910s wall span.
    expect(body.momentum.durationSeconds).toBe(110);
    // The sequence is compact: the seam fills share the active instant 10.
    expect(body.sequence).toEqual([
      { cell: 0, atSeconds: 0 },
      { cell: 1, atSeconds: 10 },
      { cell: 2, atSeconds: 10 },
      { cell: 3, atSeconds: 110 },
    ]);
    // The turning point is the within-sitting stall (100s ending at 110s, burst of 1), not
    // the collapsed night.
    expect(body.moments.turningPoint).toEqual({
      stallSeconds: 100,
      breakSeconds: 110,
      burst: 1,
    });
    // The partition itself: two contiguous spans on the active axis, wall span for flavor.
    expect(body.sittings).toEqual({
      count: 2,
      spans: [
        { startSeconds: 0, endSeconds: 10 },
        { startSeconds: 10, endSeconds: 110 },
      ],
      wallSeconds: 28910,
    });
  });

  it("D29 fast-follow: the titles re-base — the overnight wall stall no longer crowns the ice breaker, and a missed sitting refuses the marathoner (TITLES.md two-bases rule)", async () => {
    const hostId = randomUUID();
    const mateId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const mate = await auth.mintUpgraded({ sub: mateId });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    await join(gameId, mate, inviteCode);

    // Host fills the evening; mate returns after the 8h night. Pre-revisit this room
    // crowned mate the ice breaker with the 28800s wall stall; the re-base
    // (moments(solveTrace(collapseIdle(events)))) reads the largest WITHIN-SITTING gap,
    // 10s, far under the 120s floor, so nobody is the ice breaker however long the
    // night was. And with each solver present in only one of the two sittings, the new
    // marathoner rung refuses too: the fillers land on the floor tier instead.
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-17T10:00:00.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      2,
      1,
      "I",
      "2026-06-17T10:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      mateId,
      3,
      2,
      "O",
      "2026-06-17T18:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      mateId,
      4,
      3,
      "N",
      "2026-06-17T18:00:20.000Z",
    );
    await seedGameState(gameId, "2026-06-17T18:00:20.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;
    const keys = body.titles.map((t) => t.title);
    expect(keys).not.toContain("ice-breaker");
    expect(keys).not.toContain("marathoner");
    // The floor's coverage theorem still titles both fillers (TITLES.md).
    expect(new Set(body.titles.map((t) => t.userId))).toEqual(
      new Set([hostId, mateId]),
    );
  });

  it("gate: an ongoing game is GAME_NOT_FOUND and computes no bundle (completed-only)", async () => {
    const hostId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    // Events exist and would produce a bundle, but the game is ongoing (game_state row, no
    // completed_at), so the endpoint must refuse and compute nothing.
    await seedAttributionEvent(gameId, hostId, 1, 0, "H");
    await seedGameState(gameId, null);

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(404);
    await expectError(res, "GAME_NOT_FOUND");
  });

  it("gate: a game with no game_state row yet (never connected) is GAME_NOT_FOUND (completed-only)", async () => {
    const host = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    // No seedGameState: the actor never materialized game_state, so the game is not completed.
    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(404);
    await expectError(res, "GAME_NOT_FOUND");
  });

  it("gate: an abandoned game is GAME_NOT_FOUND and computes no bundle (recap deferred; completed-only)", async () => {
    const hostId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    await seedAttributionEvent(gameId, hostId, 1, 0, "H");
    // An abandoned game has a terminal game_state row but never stamped completed_at.
    await adminPool.query(
      `insert into game_state (game_id, status, completed_at, abandoned_at)
         values ($1, 'abandoned', null, now())
       on conflict (game_id) do update set status = 'abandoned', abandoned_at = now()`,
      [gameId],
    );

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(404);
    await expectError(res, "GAME_NOT_FOUND");
  });

  it("INV-6: the full bundle (owners + momentum + moments) carries no solution letter, no value, no events anywhere", async () => {
    const hostId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    // Plant every solution letter into the log with distinct timestamps (so momentum and moments
    // are populated too), so if the response ever serialized a value or the snapshot, one of these
    // letters would surface in the raw JSON text.
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-11T11:00:00.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      2,
      1,
      "I",
      "2026-06-11T11:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      3,
      2,
      "O",
      "2026-06-11T11:00:20.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      4,
      3,
      "N",
      "2026-06-11T11:00:30.000Z",
    );
    await seedGameState(gameId, "2026-06-11T11:00:30.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    // The whole bundle is userIds, cells, and numbers: never a solution value or a raw event.
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "value")).toBe(false);
    expect(hasKeyDeep(body, "events")).toBe(false);
    expect(hasKeyDeep(body, "puzzleSnapshot")).toBe(false);
    // No solution letter rides the wire, not in owners, not in the momentum ribbon, not in the
    // moments. Each solution cell is a single uppercase letter; a bare letter would only appear if
    // a value or snapshot leaked, so scan the raw text for any of them as a whole-token value.
    for (const letter of ["H", "I", "O", "N"]) {
      expect(text).not.toContain(`:"${letter}"`);
    }
    // The bundle is present and correct: the owner map, a full momentum ribbon, and the moments.
    const analysis = body as unknown as AnalysisBody;
    expect(analysis.owners).toEqual({
      "0": hostId,
      "1": hostId,
      "2": hostId,
      "3": hostId,
    });
    expect(analysis.momentum.samples).toHaveLength(40);
    expect(analysis.moments.firstToFall?.userId).toBe(hostId);
    expect(analysis.moments.lastSquare?.userId).toBe(hostId);
  });

  it("authz: a non-member viewer is refused NOT_PARTICIPANT, the same gate as the game view", async () => {
    const hostId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const stranger = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId } = await createGame(host, puzzleId);
    await seedAttributionEvent(gameId, hostId, 1, 0, "H");
    await seedGameState(gameId, "2026-06-12T12:00:00.000Z");

    // A non-member never learns whether the game exists (same as GET /games/{id}): NOT_PARTICIPANT.
    const res = await get(`/games/${gameId}/analysis`, stranger);
    expect(res.status).toBe(403);
    await expectError(res, "NOT_PARTICIPANT");
  });

  it("authz: an unauthenticated caller is rejected UNAUTHORIZED before any read", async () => {
    const res = await app.request(`/games/${randomUUID()}/analysis`, {
      method: "GET",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
    await expectError(res, "UNAUTHORIZED");
  });
});

// ------------------------------------------------------------------------------------------
// Titles on the analysis bundle (design/post-game/TITLES.md; PROTOCOL.md §12; ROADMAP Wave
// 10.4). The Archive module lifts the engine's inputs from the stored snapshot (slots as the
// union of the across/down clues' cellIndices with the D26 starred flag from the clue text;
// geometry as {rows, cols}) and appends `titles` to the same bundle. The API only lifts data:
// every count, the ladder, and the solo rule live in the engine (vectors/analysis/titles.json),
// so these tests exercise the LIFT (snapshot -> slots/starred/geometry, events -> reducers ->
// wire), not the counting.
// ------------------------------------------------------------------------------------------

describe("GET /games/{id}/analysis titles (design/post-game/TITLES.md; PROTOCOL.md §12; Wave 10.4)", () => {
  it("a completed game with two writers carries titles ordered by ladder rank, and the pre-existing bundle fields are unchanged (additive only)", async () => {
    const hostId = randomUUID();
    const mateId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const mate = await auth.mintUpgraded({ sub: mateId });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    await join(gameId, mate, inviteCode);

    // Hand-walkable log on the 2x2 fixture: host fills 0, 1, 3; mate fills only 2. Trace T = 4,
    // opening/closing stretch ceil(0.2 * 4) = 1. The ladder walk (TITLES.md v1): saboteur..bullseye
    // refuse (no overwrites, stall 5s < 120, max fills 3 < 5); `one-hit-wonder` gates for mate
    // (fills == 1, flawless, room max fills 3 >= 3) with no evidence; headliner..meddler refuse
    // (no marquee on a 2x2, burst 3 < 4, meddles 1 < 2); `quick-starter` then takes host (owns the
    // 1-entry opening stretch, evidence openingFills = 1). Output rides in ladder-rank order:
    // one-hit-wonder (rung 2) before quick-starter (rung 8).
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-15T10:00:00.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      2,
      1,
      "I",
      "2026-06-15T10:00:05.000Z",
    );
    await seedAttributionEvent(
      gameId,
      mateId,
      3,
      2,
      "O",
      "2026-06-15T10:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      4,
      3,
      "N",
      "2026-06-15T10:00:15.000Z",
    );
    await seedGameState(gameId, "2026-06-15T10:00:15.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;

    expect(body.titles).toEqual([
      { userId: mateId, title: "one-hit-wonder", evidence: null },
      { userId: hostId, title: "quick-starter", evidence: 1 },
    ]);

    // Additive change only: the bundle carries exactly the pinned field set (`titles` from
    // Wave 10.4, `sittings` from D29), and each pre-existing field reads exactly as it did
    // before each addition.
    expect(Object.keys(body).sort()).toEqual([
      "moments",
      "momentum",
      "owners",
      "sequence",
      "sittings",
      "titles",
    ]);
    expect(body.owners).toEqual({
      "0": hostId,
      "1": hostId,
      "2": mateId,
      "3": hostId,
    });
    expect(body.sequence).toEqual([
      { cell: 0, atSeconds: 0 },
      { cell: 1, atSeconds: 5 },
      { cell: 2, atSeconds: 10 },
      { cell: 3, atSeconds: 15 },
    ]);
    expect(body.momentum.durationSeconds).toBe(15);
    expect(body.momentum.samples).toHaveLength(40);
    expect(body.moments.firstToFall).toEqual({
      cell: 0,
      userId: hostId,
      atSeconds: 0,
    });
    expect(body.moments.lastSquare).toEqual({
      cell: 3,
      userId: hostId,
      atSeconds: 15,
    });
    // Uniform 5s gaps: the turning point is the FIRST longest stall (5s, broken at 5s), and its
    // burst counts the three fills inside [5s, 35s].
    expect(body.moments.turningPoint).toEqual({
      stallSeconds: 5,
      breakSeconds: 5,
      burst: 3,
    });
  });

  it("solo rule: one writer yields titles: [] even in a multi-member room (TITLES.md solo rule; PROTOCOL §12: writers, not members)", async () => {
    const hostId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const mate = await auth.mintUpgraded({ sub: randomUUID() });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    // The mate is a full member but never writes: the solo rule is about event membership
    // (writers), never the roster, so this room still titles nobody.
    await join(gameId, mate, inviteCode);

    await seedAttributionEvent(gameId, hostId, 1, 0, "H");
    await seedAttributionEvent(gameId, hostId, 2, 1, "I");
    await seedAttributionEvent(gameId, hostId, 3, 2, "O");
    await seedAttributionEvent(gameId, hostId, 4, 3, "N");
    await seedGameState(gameId, "2026-06-15T11:00:00.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;
    // Empty, present, and an array (the field always rides; a solo room carries []). The rest of
    // the bundle is untouched by the empty award list.
    expect(body.titles).toEqual([]);
    expect(Object.keys(body.owners)).toHaveLength(4);
  });

  it("D26 starred lift: a clue whose text opens `*` (optional leading whitespace) becomes a starred marquee slot, so the headliner can award on a 2x2", async () => {
    const hostId = randomUUID();
    const mateId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const mate = await auth.mintUpgraded({ sub: mateId });

    // A fixture variant whose across-1 clue wears the D26 starred mark (`^\s*\*`, the
    // clueRefs.ts predicate; the `\s*` tolerance is the shared regex's, though ingestion itself
    // trims leading whitespace, so the stored text opens with the literal `*` -- PROTOCOL §12
    // law 11 carries the star through verbatim). Without this star a 2x2 has NO marquee tier
    // (the length fallback gates at MARQUEE_MIN_LENGTH = 7), so a headliner award below proves
    // the starred flag was lifted from the snapshot's clue text into the slot data.
    const starredDoc = {
      ...FIXTURE,
      clues: {
        ...FIXTURE.clues,
        across: [
          `1.  *up high, thematically ${randomUUID()}`,
          "3. keyboard basics",
        ],
      },
    };
    const ingest = await postJson("/puzzles", host, starredDoc);
    expect(ingest.status).toBe(201);
    const { puzzleId } = (await ingest.json()) as { puzzleId: string };

    const { gameId, inviteCode } = await createGame(host, puzzleId);
    await join(gameId, mate, inviteCode);

    // Host first-corrects both cells of the starred across-1 (cells 0, 1): host strictly leads
    // its first-correct cells, marqueeLeads = 1. Mate fills 2 and 3. The walk: rungs 1-4 refuse
    // (no overwrites, both have 2 fills, stall 5s, fills < 5); `headliner` takes host
    // (marqueeLeads 1, the starred slot); `meddler` then takes mate, who finished both down
    // slots the host started (meddles 2 >= MEDDLER_MIN).
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-15T12:00:00.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      2,
      1,
      "I",
      "2026-06-15T12:00:05.000Z",
    );
    await seedAttributionEvent(
      gameId,
      mateId,
      3,
      2,
      "O",
      "2026-06-15T12:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      mateId,
      4,
      3,
      "N",
      "2026-06-15T12:00:15.000Z",
    );
    await seedGameState(gameId, "2026-06-15T12:00:15.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisBody;
    expect(body.titles).toEqual([
      { userId: hostId, title: "headliner", evidence: 1 },
      { userId: mateId, title: "meddler", evidence: 2 },
    ]);
  });

  it("INV-6: a bundle carrying titles still holds no solution letter, no value, no snapshot anywhere", async () => {
    const hostId = randomUUID();
    const mateId = randomUUID();
    const host = await auth.mintUpgraded({ sub: hostId });
    const mate = await auth.mintUpgraded({ sub: mateId });
    const puzzleId = await ingestFixture(host);
    const { gameId, inviteCode } = await createGame(host, puzzleId);
    await join(gameId, mate, inviteCode);

    // Two writers so `titles` is non-empty: the new field must be exercised, not vacuously
    // absent, when the leak scan runs. Every solution letter is planted in the log; the titles
    // path additionally reads the snapshot's clues and geometry, so if the lift ever leaked the
    // snapshot (or the awards ever carried a value), a letter would surface in the raw JSON.
    await seedAttributionEvent(
      gameId,
      hostId,
      1,
      0,
      "H",
      "2026-06-15T13:00:00.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      2,
      1,
      "I",
      "2026-06-15T13:00:05.000Z",
    );
    await seedAttributionEvent(
      gameId,
      mateId,
      3,
      2,
      "O",
      "2026-06-15T13:00:10.000Z",
    );
    await seedAttributionEvent(
      gameId,
      hostId,
      4,
      3,
      "N",
      "2026-06-15T13:00:15.000Z",
    );
    await seedGameState(gameId, "2026-06-15T13:00:15.000Z");

    const res = await get(`/games/${gameId}/analysis`, host);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(hasKeyDeep(body, "solution")).toBe(false);
    expect(hasKeyDeep(body, "value")).toBe(false);
    expect(hasKeyDeep(body, "events")).toBe(false);
    expect(hasKeyDeep(body, "puzzleSnapshot")).toBe(false);
    expect(hasKeyDeep(body, "clues")).toBe(false);
    for (const letter of ["H", "I", "O", "N"]) {
      expect(text).not.toContain(`:"${letter}"`);
    }
    // And the titles are live in this very payload: userIds, kebab keys, and numbers only.
    const analysis = body as unknown as AnalysisBody;
    expect(analysis.titles.length).toBeGreaterThan(0);
    for (const award of analysis.titles) {
      expect([hostId, mateId]).toContain(award.userId);
      expect(award.title).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(
        award.evidence === null || typeof award.evidence === "number",
      ).toBe(true);
    }
  });
});
