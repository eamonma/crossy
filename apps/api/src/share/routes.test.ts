/**
 * The public completion share surface (design/post-game/SHARE.md wave S2; PROTOCOL.md §12).
 *
 * Driven in-process through Hono's `app.request(...)`, like api.test.ts: the auth is the in-memory
 * fake, and the database is a throwaway Testcontainers Postgres with the committed migrations
 * applied. The app's own connections run under the least-privilege `crossy_api` role, so the
 * share_tokens grants are exercised for real (INV-7): the API is the single writer of the table it
 * mints into. A superuser connection seeds the completed game (standing in for the session, the
 * single writer of game_state and cell_events).
 *
 * No silent skips (repo rule): if Docker is unreachable the suite FAILS loudly.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@crossy/db";
import { createFakeAuthProvider } from "@crossy/auth";
import type { FakeAuthProvider } from "@crossy/auth";
import { buildApp } from "../app";
import { createDb } from "../db/client";
import type { ApiEnv, AppDeps } from "../context";
import { SHARE_TOKEN_PATTERN } from "./token";

const POSTGRES_IMAGE = "postgres:16-alpine";
const BOOT_TIMEOUT_MS = 180_000;
const SESSION_WS_BASE = "wss://session.crossy.test";
const INVITE_HOST = "crossy.ing";
const WEB_ORIGIN = "https://crossy.party";

// A 2x2 all-playable fixture: the stored solution is H,I,O,N at cells 0..3, so seeded correct fills
// produce a two-solver owner map through the real analysis path.
const FIXTURE = {
  size: { rows: 2, cols: 2 },
  grid: ["H", "I", "O", "N"],
  clues: {
    across: ["1. friendly opener", "3. keyboard basics"],
    down: ["1. up top", "2. and beside"],
  },
};

let container: StartedPostgreSqlContainer;
let apiPool: Pool;
let adminPool: Pool;
let auth: FakeAuthProvider;
let app: Hono<ApiEnv>;
let deps: AppDeps;

function bearer(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}
async function post(
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
/** An unauthenticated GET on the public share host (so the invite-host `/s/*` forward is exercised
 * against the same host the links point at). */
async function getPublic(path: string): Promise<Response> {
  return app.request(`https://${INVITE_HOST}${path}`, { method: "GET" });
}

async function ingestFixture(token: string): Promise<string> {
  const res = await app.request("/puzzles", {
    method: "POST",
    headers: bearer(token),
    body: JSON.stringify(FIXTURE),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { puzzleId: string }).puzzleId;
}
async function createGame(
  token: string,
): Promise<{ gameId: string; inviteCode: string }> {
  const puzzleId = await ingestFixture(token);
  const res = await post("/games", token, { puzzleId });
  expect(res.status).toBe(201);
  return (await res.json()) as { gameId: string; inviteCode: string };
}
async function seedCompleted(gameId: string): Promise<void> {
  await adminPool.query(
    `insert into game_state (game_id, status, completed_at) values ($1, 'completed', now())
       on conflict (game_id) do update set status = 'completed', completed_at = now()`,
    [gameId],
  );
}
async function seedFill(
  gameId: string,
  userId: string,
  seq: number,
  cell: number,
  value: string,
): Promise<void> {
  await adminPool.query(
    `insert into cell_events (game_id, seq, cell, user_id, value, at)
       values ($1, $2, $3, $4, $5, now() + ($6)::interval)`,
    [gameId, seq, cell, userId, value, `${seq} seconds`],
  );
}

/** A completed two-solver game: host owns cells 0,1; joiner owns 2,3. Returns the ids. */
async function completedGame(): Promise<{
  gameId: string;
  hostToken: string;
  hostId: string;
  joinerToken: string;
  joinerId: string;
}> {
  const hostId = randomUUID();
  const hostToken = await auth.mintUpgraded({
    sub: hostId,
    userMetadata: { full_name: "Ada" },
  });
  const { gameId, inviteCode } = await createGame(hostToken);
  const joinerId = randomUUID();
  const joinerToken = await auth.mintUpgraded({
    sub: joinerId,
    userMetadata: { full_name: "Grace" },
  });
  const join = await post(`/games/${gameId}/join`, joinerToken, {
    code: inviteCode,
  });
  expect(join.status).toBe(200);
  await seedFill(gameId, hostId, 1, 0, "H");
  await seedFill(gameId, hostId, 2, 1, "I");
  await seedFill(gameId, joinerId, 3, 2, "O");
  await seedFill(gameId, joinerId, 4, 3, "N");
  await seedCompleted(gameId);
  return { gameId, hostToken, hostId, joinerToken, joinerId };
}

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  } catch (cause) {
    throw new Error(
      "Testcontainers could not start Postgres. This suite requires a running Docker daemon " +
        "and does not skip when it is missing (repo rule: no silent skips).",
      { cause },
    );
  }
  const connectionString = container.getConnectionUri();
  await applyMigrations(connectionString);
  apiPool = new Pool({ connectionString, options: "-c role=crossy_api" });
  apiPool.on("error", () => {});
  adminPool = new Pool({ connectionString });
  auth = await createFakeAuthProvider();
  deps = {
    db: createDb(apiPool),
    authPort: auth,
    sessionWsBase: SESSION_WS_BASE,
    inviteHost: INVITE_HOST,
    webOrigin: WEB_ORIGIN,
  };
  app = buildApp(deps);
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await apiPool?.end();
  await adminPool?.end();
  await container?.stop();
}, 60_000);

describe("POST /games/{id}/share gates and idempotent mint (SHARE.md S2; INV-7)", () => {
  it("mints a share link for a member of a completed game, on the config-driven host", async () => {
    const { gameId, hostToken } = await completedGame();
    const res = await post(`/games/${gameId}/share`, hostToken, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shareUrl: string; token: string };
    expect(SHARE_TOKEN_PATTERN.test(body.token)).toBe(true);
    // The public origin follows how invite links build theirs (INVITE_HOST), path /s/{token}.
    expect(body.shareUrl).toBe(`https://${INVITE_HOST}/s/${body.token}`);
  });

  it("is idempotent: a re-POST returns the same active token, one row per game (INV-7 single writer)", async () => {
    const { gameId, hostToken, joinerToken } = await completedGame();
    const first = (await (
      await post(`/games/${gameId}/share`, hostToken, {})
    ).json()) as { token: string };
    // A different member re-minting returns the SAME token, not a second live link.
    const second = (await (
      await post(`/games/${gameId}/share`, joinerToken, {})
    ).json()) as { token: string };
    expect(second.token).toBe(first.token);
    const rows = await adminPool.query(
      "select count(*)::int as n from share_tokens where game_id = $1 and revoked_at is null",
      [gameId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("refuses a non-member with NOT_PARTICIPANT, never leaking whether the game exists", async () => {
    const { gameId } = await completedGame();
    const stranger = await auth.mintUpgraded({ sub: randomUUID() });
    const res = await post(`/games/${gameId}/share`, stranger, {});
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(
      "NOT_PARTICIPANT",
    );
  });

  it("refuses an ongoing game with GAME_NOT_FOUND and mints nothing", async () => {
    const hostToken = await auth.mintUpgraded({ sub: randomUUID() });
    const { gameId } = await createGame(hostToken); // never completed
    const res = await post(`/games/${gameId}/share`, hostToken, {});
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe(
      "GAME_NOT_FOUND",
    );
    const rows = await adminPool.query(
      "select count(*)::int as n from share_tokens where game_id = $1",
      [gameId],
    );
    expect(rows.rows[0].n).toBe(0);
  });
});

describe("public GET /s/{token} shell + card (SHARE.md S2)", () => {
  it("serves an OpenGraph shell pointing at the card with the og dimensions", async () => {
    const { gameId, hostToken } = await completedGame();
    const { token } = (await (
      await post(`/games/${gameId}/share`, hostToken, {})
    ).json()) as { token: string };
    const res = await getPublic(`/s/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(`og:image`);
    expect(html).toContain(`/s/${token}/card.png`);
    expect(html).toContain(`content="1200"`);
    expect(html).toContain(`content="630"`);
  });

  it("rasterizes the card PNG at 1200x630, long-cached", async () => {
    const { gameId, hostToken } = await completedGame();
    const { token } = (await (
      await post(`/games/${gameId}/share`, hostToken, {})
    ).json()) as { token: string };
    const res = await getPublic(`/s/${token}/card.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    const png = new Uint8Array(await res.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
  });

  it("gives an unknown, malformed, or revoked token the SAME soft 404 (no oracle)", async () => {
    // Unknown but well-formed token.
    const unknown = "A".repeat(43);
    const uRes = await getPublic(`/s/${unknown}`);
    expect(uRes.status).toBe(404);
    expect(await uRes.text()).not.toContain("og:image");

    // Malformed token (wrong length): same soft 404, never a shape-confirming error.
    const mRes = await getPublic(`/s/short`);
    expect(mRes.status).toBe(404);

    // Revoked token: mint one, revoke it, and it dies exactly like an unknown token.
    const { gameId, hostToken } = await completedGame();
    const { token } = (await (
      await post(`/games/${gameId}/share`, hostToken, {})
    ).json()) as { token: string };
    await adminPool.query(
      "update share_tokens set revoked_at = now() where token = $1",
      [token],
    );
    const rRes = await getPublic(`/s/${token}`);
    expect(rRes.status).toBe(404);
    expect(await rRes.text()).not.toContain("og:image");
    // And the card for a revoked token is a plain 404, never a render.
    const rCard = await getPublic(`/s/${token}/card.png`);
    expect(rCard.status).toBe(404);
  });

  it("mints a fresh token after revocation (the active index frees up), so a new link works", async () => {
    const { gameId, hostToken } = await completedGame();
    const first = (await (
      await post(`/games/${gameId}/share`, hostToken, {})
    ).json()) as { token: string };
    await adminPool.query(
      "update share_tokens set revoked_at = now() where token = $1",
      [first.token],
    );
    const second = (await (
      await post(`/games/${gameId}/share`, hostToken, {})
    ).json()) as { token: string };
    expect(second.token).not.toBe(first.token);
    expect((await getPublic(`/s/${second.token}`)).status).toBe(200);
  });
});

describe("public share routes rate-limit like the unfurl (defense in depth)", () => {
  it("returns a plain-text 429 once the per-IP window is spent", async () => {
    // A dedicated app instance so this test's flood does not spend the shared app's window.
    const isolated = buildApp(deps);
    const path = `https://${INVITE_HOST}/s/${"A".repeat(43)}`;
    let last: Response | null = null;
    for (let i = 0; i < 62; i += 1) {
      last = await isolated.request(path, {
        method: "GET",
        headers: { "cf-connecting-ip": "203.0.113.7" },
      });
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("retry-after")).not.toBeNull();
    expect(await last?.text()).toContain("too many requests");
  });
});
