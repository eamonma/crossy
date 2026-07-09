// The M1 local dev stack (ROADMAP Wave 2.2 owner taste pass). It stands up the real
// two-service shape the owner can play in two browser tabs: Testcontainers Postgres with
// migrations applied, the api, the session service, and the Vite DEV server for apps/web
// (dev server, not a build, so hot reload works). It seeds one demo game through the real
// api on a real puzzle fixture, prints the two urls to open, then stays up until Ctrl+C,
// which drains the session (SIGTERM so the flush runs) and stops the containers.
//
// This reuses the Wave 2.2 smoke harness machinery by import (auth minting, the jwks
// server, service spawn, migrations, http readiness). The only orchestration it adds over
// the harness is stable ports and a Vite dev server in place of the built static client.
//
// Seed-surface note (called out in the report): the second player joins through the api as
// a spectator, and spectators cannot mutate the board (apps/session actor.ts). To make two
// typing identities (presence color, conflict flash) this script elevates the joined member
// to `solver` and sets display names with direct seed writes. No app code is changed.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import {
  apiEntry,
  jwksServer,
  killChild,
  makeAuth,
  repoRoot,
  runMigrations,
  sessionEntry,
  spawnService,
  waitForHttp,
} from "../src/harness";

// Stable ports so the owner opens the same url every run (override with DEV_STACK_*_PORT).
// Postgres is the one exception: it is a Testcontainer on its own mapped port, reached only
// by the api and session over DATABASE_URL, never by the owner.
// 8790-8792 rather than 809x: the 80xx and 809x bands are prime self-hosting territory
// (the owner's machine has Calibre parked on 8090), and a dev tool's defaults should not
// gamble on them.
const WEB_PORT = Number(process.env["DEV_STACK_WEB_PORT"] ?? "5173");
const API_PORT = Number(process.env["DEV_STACK_API_PORT"] ?? "8790");
const SESSION_PORT = Number(process.env["DEV_STACK_SESSION_PORT"] ?? "8791");
const JWKS_PORT = Number(process.env["DEV_STACK_JWKS_PORT"] ?? "8792");

const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const SESSION_WS_BASE = `ws://127.0.0.1:${SESSION_PORT}`;
const ISSUER = `http://127.0.0.1:${JWKS_PORT}/auth/v1`;

const viteBin = join(repoRoot, "apps/web/node_modules/.bin/vite");
const webAppDir = join(repoRoot, "apps/web");

// A real, well-formed puzzle: a 5x5 double word square. Every row and column is a word, so
// there is always a live clue on both axes and typing feels like a real solve. Shape is a
// ServerPuzzle (apps/api ingest validates {number,text,cellIndices} clues and a per-cell
// solution); the solution never reaches the client (INV-6).
const PUZZLE = {
  rows: 5,
  cols: 5,
  blocks: [] as number[],
  circles: [] as number[],
  clues: {
    across: [
      {
        number: 1,
        text: "Organ that keeps the beat",
        cellIndices: [0, 1, 2, 3, 4],
      },
      { number: 6, text: "Dying glow in a fire", cellIndices: [5, 6, 7, 8, 9] },
      { number: 7, text: "Treat badly", cellIndices: [10, 11, 12, 13, 14] },
      {
        number: 8,
        text: "Sticky pine secretion",
        cellIndices: [15, 16, 17, 18, 19],
      },
      {
        number: 9,
        text: "Direction things are moving",
        cellIndices: [20, 21, 22, 23, 24],
      },
    ],
    down: [
      { number: 1, text: "Valentine symbol", cellIndices: [0, 5, 10, 15, 20] },
      { number: 2, text: "Smoldering coal", cellIndices: [1, 6, 11, 16, 21] },
      { number: 3, text: "Mistreatment", cellIndices: [2, 7, 12, 17, 22] },
      {
        number: 4,
        text: "Violin bow application",
        cellIndices: [3, 8, 13, 18, 23],
      },
      {
        number: 5,
        text: "What is hot right now",
        cellIndices: [4, 9, 14, 19, 24],
      },
    ],
  },
  // Row-major: HEART / EMBER / ABUSE / RESIN / TREND (columns spell the same words).
  solution: [
    "H",
    "E",
    "A",
    "R",
    "T",
    "E",
    "M",
    "B",
    "E",
    "R",
    "A",
    "B",
    "U",
    "S",
    "E",
    "R",
    "E",
    "S",
    "I",
    "N",
    "T",
    "R",
    "E",
    "N",
    "D",
  ],
};

/**
 * Reject if a loopback port is already taken, with a message that names the override.
 * Probes both loopback families: Vite with --host localhost binds ::1 where available,
 * so an IPv4-only probe false-passes when a squatter holds [::1]:port (seen live with
 * an orphaned Vite). A machine without IPv6 loopback skips that probe.
 */
function checkPortFree(port: number, label: string): Promise<void> {
  const probe = (host: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const srv = createNetServer();
      srv.once("error", (err) => {
        const code = (err as NodeJS.ErrnoException).code ?? "EADDRINUSE";
        if (
          host === "::1" &&
          (code === "EAFNOSUPPORT" || code === "EADDRNOTAVAIL")
        ) {
          resolve();
          return;
        }
        reject(
          new Error(
            `${label} port ${port} is in use (${code} on ${host}). Free it or set the matching DEV_STACK_*_PORT env var.`,
          ),
        );
      });
      srv.listen(port, host, () => srv.close(() => resolve()));
    });
  return probe("127.0.0.1").then(() => probe("::1"));
}

/** POST JSON to the api with a bearer token, throwing on a non-2xx (same shape as the harness). */
async function postJson(
  path: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Spawn the Vite dev server for apps/web on the stable web port (hot reload, no build). */
function spawnVite(): ChildProcess {
  const child = spawn(
    viteBin,
    ["--port", String(WEB_PORT), "--strictPort", "--host", "localhost"],
    {
      cwd: webAppDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[web] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[web] ${d}`));
  return child;
}

function gameUrl(gameId: string, token: string): string {
  const q = new URLSearchParams({ api: API_URL, game: gameId, token });
  return `${WEB_ORIGIN}/?${q.toString()}`;
}

function printInstructions(opts: {
  gameId: string;
  inviteCode: string;
  urlA: string;
  urlB: string;
}): void {
  const line = "=".repeat(72);
  const out = [
    "",
    line,
    "  Crossy local dev stack is up. Play the real game in two browser tabs.",
    line,
    "",
    `  Web (Vite dev, hot reload):  ${WEB_ORIGIN}`,
    `  API:                         ${API_URL}`,
    `  Session (WebSocket):         ${SESSION_WS_BASE}`,
    `  Game id:                     ${opts.gameId}`,
    `  Invite code:                 ${opts.inviteCode}`,
    "  Puzzle:                      5x5 word square (HEART EMBER ABUSE RESIN TREND)",
    "",
    "  Open EACH url below in its own tab. The token in the url is the identity,",
    "  so the two tabs are two different players already joined to one game.",
    "",
    "  Tab 1  (Ada, host):",
    `    ${opts.urlA}`,
    "",
    "  Tab 2  (Grace, solver):",
    `    ${opts.urlB}`,
    "",
    "  What to feel (M1 typing-feel taste pass):",
    "    - Typing latency: type in one tab, watch letters land in the other.",
    "    - Conflict flash: put both cursors on the SAME cell and type different",
    "      letters; the overwritten cell flashes the writer's color for 300 ms.",
    "    - Cursor motion: your own cursor advances with filled-skip as you type.",
    "    - Resync pill: in one tab open devtools Network and switch to Offline,",
    "      type a few letters, then switch back to Online. The Reconnecting and",
    "      Resyncing pill shows, the socket reconnects, and both boards reconcile.",
    "",
    "  Notes:",
    "    - Tokens expire in 1 hour. Re-run pnpm dev:stack for fresh ones.",
    "    - Teammate live cursors are not broadcast in this wave; you read a",
    "      teammate through their landed letters and the conflict-flash color.",
    "",
    "  Press Ctrl+C to drain the session (flush to Postgres) and stop everything.",
    line,
    "",
  ];
  console.log(out.join("\n"));
}

let container: StartedPostgreSqlContainer | null = null;
let jwks: Server | null = null;
let api: ChildProcess | null = null;
let session: ChildProcess | null = null;
let web: ChildProcess | null = null;
let shuttingDown = false;

async function shutdown(signal: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, draining the stack...`);
  // SIGTERM the session first so its drain flushes the accepted tail to Postgres (INV-5).
  await killChild(session, "SIGTERM");
  await killChild(web, "SIGTERM");
  await killChild(api, "SIGKILL");
  await new Promise<void>((r) => (jwks ? jwks.close(() => r()) : r()));
  await container?.stop();
  console.log("stack stopped.");
  process.exit(code);
}

async function main(): Promise<void> {
  await Promise.all([
    checkPortFree(API_PORT, "api"),
    checkPortFree(SESSION_PORT, "session"),
    checkPortFree(JWKS_PORT, "jwks"),
    checkPortFree(WEB_PORT, "web"),
  ]);

  console.log("starting Postgres (Testcontainers) and applying migrations...");
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const dbUrl = container.getConnectionUri();
  await runMigrations(dbUrl);

  const auth = await makeAuth(ISSUER);
  jwks = await jwksServer(auth.jwks, JWKS_PORT);

  console.log("starting the session service and the api...");
  session = spawnService("session", sessionEntry, {
    DATABASE_URL: dbUrl,
    SUPABASE_ISSUER: ISSUER,
    PORT: String(SESSION_PORT),
    HOST: "127.0.0.1",
  });
  api = spawnService("api", apiEntry, {
    DATABASE_URL: dbUrl,
    SUPABASE_ISSUER: ISSUER,
    SESSION_WS_BASE,
    CORS_ORIGIN: WEB_ORIGIN,
    PORT: String(API_PORT),
  });
  await waitForHttp(`http://127.0.0.1:${SESSION_PORT}/`);
  await waitForHttp(`${API_URL}/health`);

  console.log("seeding one demo game through the api...");
  const userA = randomUUID();
  const userB = randomUUID();
  const tokenA = await auth.mint(userA, false);
  const tokenB = await auth.mint(userB, false);

  const puzzle = (await postJson("/puzzles", tokenA, PUZZLE)) as {
    puzzleId: string;
  };
  const game = (await postJson("/games", tokenA, {
    puzzleId: puzzle.puzzleId,
  })) as { gameId: string; inviteCode: string };
  await postJson(`/games/${game.gameId}/join`, tokenB, {
    code: game.inviteCode,
  });

  // Seed writes: elevate the joined spectator to a writer and give both players a name so
  // presence shows distinct initials and colors. Both users already exist in `users` from
  // their api calls (the JIT upsert), so these are updates.
  const dbClient = new Client({ connectionString: dbUrl });
  await dbClient.connect();
  await dbClient.query(
    "update memberships set role = 'solver' where game_id = $1 and user_id = $2",
    [game.gameId, userB],
  );
  await dbClient.query(
    "update users set display_name = $2 where user_id = $1",
    [userA, "Ada"],
  );
  await dbClient.query(
    "update users set display_name = $2 where user_id = $1",
    [userB, "Grace"],
  );
  await dbClient.end();

  console.log("starting the Vite dev server for apps/web (hot reload)...");
  web = spawnVite();
  await waitForHttp(WEB_ORIGIN, 60_000);

  printInstructions({
    gameId: game.gameId,
    inviteCode: game.inviteCode,
    urlA: gameUrl(game.gameId, tokenA),
    urlB: gameUrl(game.gameId, tokenB),
  });

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // The jwks server, child processes, and container keep the event loop alive until Ctrl+C.
}

main().catch((err: unknown) => {
  console.error("dev stack failed to start:", err);
  void shutdown("startup error", 1);
});
