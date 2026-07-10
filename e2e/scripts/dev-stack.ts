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
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import {
  apiEntry,
  jwksServer,
  killChild,
  killGroup,
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
// there is always a live clue on both axes and typing feels like a real solve. Shape is an
// XWord Info document (the G1 ingestion ACL translates it at the boundary): the grid
// carries the solution letters, numbering and cell runs derive from geometry, and the
// solution never reaches the client (INV-6).
// Row-major: HEART / EMBER / ABUSE / RESIN / TREND (columns spell the same words).
const PUZZLE = {
  size: { rows: 5, cols: 5 },
  grid: [..."HEART", ..."EMBER", ..."ABUSE", ..."RESIN", ..."TREND"],
  clues: {
    across: [
      "1. Organ that keeps the beat",
      "6. Dying glow in a fire",
      "7. Treat badly",
      "8. Sticky pine secretion",
      "9. Direction things are moving",
    ],
    down: [
      "1. Valentine symbol",
      "2. Smoldering coal",
      "3. Mistreatment",
      "4. Violin bow application",
      "5. What is hot right now",
    ],
  },
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

// Orphan reaping. A dropped SSH session sends SIGHUP to the foreground job, which the
// detached service groups never receive, and a SIGKILLed parent runs no handler at all, so
// the services can survive holding their ports. Each run records its process groups in a
// pidfile and reaps live leftovers before starting. The ownership check is load bearing:
// after a reboot a recorded pid can belong to an unrelated process, so we never signal a pid
// we cannot confirm is ours (the rule that spared Calibre on 8090).

const PIDFILE = join(repoRoot, "e2e/.dev-stack.pid");
const DRAIN_TIMEOUT_MS = 10_000;
// All four stack ports, including jwks: jwks runs in the parent process, so an orphaned
// parent that skipped its drain keeps holding it, and the sweep must be able to reach it.
const STACK_PORTS: Array<[number, string]> = [
  [API_PORT, "api"],
  [SESSION_PORT, "session"],
  [JWKS_PORT, "jwks"],
  [WEB_PORT, "web"],
];

interface Pidfile {
  startedAt: number;
  parentPid: number;
  groups: Record<string, number>;
}

/** True if the pid exists (EPERM counts: alive, just not ours to signal). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * True only when `pid` is one of ours. Our group leaders are tsx or vite launched from this
 * repo, so their /proc cmdline carries the repo path; a process that merely reused the pid
 * will not. Falls back to `ps` off Linux, then to false, so an unconfirmable pid is never
 * killed.
 */
function isOurs(pid: number): boolean {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(
      /\0/g,
      " ",
    );
    return cmdline.includes(repoRoot);
  } catch {
    try {
      const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
      });
      return out.includes(repoRoot);
    } catch {
      return false;
    }
  }
}

/** The process group id of `pid` from /proc/<pid>/stat (field 5), or null off Linux. */
function groupOf(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm (field 2) can hold spaces and parens, so read fields after the final ')'.
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const pgrp = Number(rest[2]); // state(3) ppid(4) pgrp(5) => index 2 here
    return Number.isInteger(pgrp) ? pgrp : null;
  } catch {
    return null;
  }
}

/** Pids listening on `port`, via ss. Empty if ss is unavailable or the port is free. */
function portOwners(port: number): number[] {
  try {
    const out = execFileSync("ss", ["-ltnpH"], { encoding: "utf8" });
    const pids = new Set<number>();
    for (const raw of out.split("\n")) {
      // State Recv-Q Send-Q Local:Port Peer:Port users:(...). The local address is col 3.
      const local = raw.trim().split(/\s+/)[3];
      if (local === undefined || !local.endsWith(`:${port}`)) continue;
      for (const m of raw.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

/**
 * SIGTERM a confirmed-ours process, wait, then SIGKILL if it lingers. killGroup targets the
 * process group when `pid` leads one (a detached child, so its grandchildren go too) and the
 * pid alone otherwise (a listener or the parent), so it never reaps the shared pnpm group.
 * Ownership is checked on `pid` itself, never its group leader, since the leader is often the
 * pnpm wrapper whose cmdline is not under the repo.
 */
async function reapProcess(pid: number, label: string): Promise<void> {
  const ownGroup = groupOf(process.pid) ?? process.pid;
  if (pid === process.pid || pid === ownGroup) return; // never reap ourselves
  if (!alive(pid) || !isOurs(pid)) return;
  console.log(
    `reaping an orphaned ${label} (pid ${pid}) from a prior dev:stack...`,
  );
  killGroup(pid, "SIGTERM");
  for (let i = 0; i < 20 && alive(pid); i++) await delay(100);
  if (alive(pid)) killGroup(pid, "SIGKILL");
}

/** Reap the processes a previous run recorded, then drop the pidfile. */
async function reapFromPidfile(): Promise<void> {
  if (!existsSync(PIDFILE)) return;
  let data: Pidfile;
  try {
    data = JSON.parse(readFileSync(PIDFILE, "utf8")) as Pidfile;
  } catch {
    rmSync(PIDFILE, { force: true });
    return;
  }
  for (const [label, pid] of Object.entries(data.groups)) {
    await reapProcess(pid, label);
  }
  // The parent holds the in-process jwks port, so an orphaned parent must go too.
  await reapProcess(data.parentPid, "parent");
  rmSync(PIDFILE, { force: true });
}

/** Reap whatever of ours holds a stack port, catching orphans with no pidfile entry. */
async function reapFromPorts(): Promise<void> {
  for (const [port, label] of STACK_PORTS) {
    for (const pid of portOwners(port)) {
      await reapProcess(pid, `${label} :${port}`);
    }
  }
}

/** Reject if any stack port is taken (both loopback families). */
function preflight(): Promise<void> {
  return Promise.all([
    checkPortFree(API_PORT, "api"),
    checkPortFree(SESSION_PORT, "session"),
    checkPortFree(JWKS_PORT, "jwks"),
    checkPortFree(WEB_PORT, "web"),
  ]).then(() => undefined);
}

/** Preflight; if a port is busy, sweep it for our own leftovers and retry once. */
async function ensurePortsFree(): Promise<void> {
  try {
    await preflight();
  } catch (first) {
    await reapFromPorts();
    try {
      await preflight();
    } catch {
      throw first; // still held: a process we cannot claim owns it. Surface the message.
    }
  }
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
      // Own group so killChild reaps vite and its esbuild workers together.
      detached: true,
    },
  );
  child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[web] ${d}`));
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[web] ${d}`));
  return child;
}

function gameUrl(gameId: string, token: string): string {
  const q = new URLSearchParams({ api: API_URL, token });
  return `${WEB_ORIGIN}/game/${gameId}?${q.toString()}`;
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

function forceKillAll(): void {
  for (const child of [session, api, web]) {
    if (child?.pid !== undefined) killGroup(child.pid, "SIGKILL");
  }
}

/** Record the child process groups so a next run can reap them if a disconnect skips drain. */
function writePidfile(): void {
  const groups: Record<string, number> = {};
  if (session?.pid !== undefined) groups["session"] = session.pid;
  if (api?.pid !== undefined) groups["api"] = api.pid;
  if (web?.pid !== undefined) groups["web"] = web.pid;
  const data: Pidfile = {
    startedAt: Date.now(),
    parentPid: process.pid,
    groups,
  };
  writeFileSync(PIDFILE, JSON.stringify(data));
}

async function shutdown(signal: string, code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received, draining the stack...`);
  // SIGTERM the session first so its drain flushes the accepted tail to Postgres (INV-5).
  // Bound the drain: over a dead terminal (a dropped SSH session) it must not hang holding
  // ports, so a timeout escalates to a group SIGKILL of anything still up.
  const drain = (async () => {
    await killChild(session, "SIGTERM");
    await killChild(web, "SIGTERM");
    await killChild(api, "SIGKILL");
    await new Promise<void>((r) => (jwks ? jwks.close(() => r()) : r()));
    await container?.stop();
  })();
  await Promise.race([drain, delay(DRAIN_TIMEOUT_MS)]);
  forceKillAll();
  rmSync(PIDFILE, { force: true });
  console.log("stack stopped.");
  process.exit(code);
}

async function main(): Promise<void> {
  // Survive a dead controlling terminal: a write to a closed pipe must not crash the drain.
  process.stdout.on("error", () => undefined);
  process.stderr.on("error", () => undefined);
  // Register early so a disconnect during startup still drains. SIGHUP is the SSH-drop case.
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));

  if (process.argv.includes("--reap")) {
    await reapFromPidfile();
    await reapFromPorts();
    console.log("reaped any orphaned dev:stack processes.");
    return;
  }

  // Clear leftovers a prior disconnect or crash left holding the ports, then confirm free.
  await reapFromPidfile();
  await ensurePortsFree();

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

  // Record the process groups so the next run can reap these if a disconnect skips shutdown.
  writePidfile();

  printInstructions({
    gameId: game.gameId,
    inviteCode: game.inviteCode,
    urlA: gameUrl(game.gameId, tokenA),
    urlB: gameUrl(game.gameId, tokenB),
  });

  // Signal handlers were registered at the top of main. The jwks server, child processes,
  // and container keep the event loop alive until one fires.
}

main().catch((err: unknown) => {
  console.error("dev stack failed to start:", err);
  void shutdown("startup error", 1);
});
