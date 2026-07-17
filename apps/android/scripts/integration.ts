// The Wave A3 integration harness (apps/android): boot the real local stack, create a game through
// the real REST api, then run `:session:test` in apps/android with the connection facts in the
// environment so crossy.session.StackIntegrationTests drives a real socket round trip (the M1 exit
// shape, replayed in Kotlin). Run it as `corepack pnpm test:android-integration`; `--reap` sweeps
// orphans and exits. Twin of apps/ios/scripts/integration.ts.
//
// Machinery is the Wave 2.2 smoke harness, reused by import from e2e/src/harness.ts (Testcontainers
// Postgres, migrations, jose token minting, the JWKS server, service spawn, http readiness): this
// file orchestrates processes, it duplicates nothing. The orphan sweep mirrors e2e/scripts/
// dev-stack.ts (module-private there; hoist into the harness on a third copy): /proc and ss are the
// primaries because this harness's home is Linux, with lsof/ps darwin fallbacks kept for
// portability. Teardown plus that sweep are part of the harness, not a convention: teardown always
// runs (tests failed, startup died, Ctrl+C), every run reaps what a prior run may have leaked before
// it takes the ports, and after teardown the harness verifies no orphaned listener survives.

import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
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
} from "../../../e2e/src/harness";

const here = dirname(fileURLToPath(import.meta.url));
const androidAppDir = join(repoRoot, "apps/android");

// apps/android is a Gradle project, not a pnpm workspace member, so @testcontainers/postgresql is
// not resolvable from here (unlike apps/ios, which declares it). Borrow it at runtime from the e2e
// package that owns the dep, anchored to the very module the reused harness imports it from. This
// keeps every change inside apps/android plus the two root script lines: no new workspace member,
// no lockfile churn. The type import above is erased, so only the value needs this bridge.
const { PostgreSqlContainer } = createRequire(
  pathToFileURL(join(repoRoot, "e2e/src/harness.ts")),
)("@testcontainers/postgresql") as typeof import("@testcontainers/postgresql");

// Fixed ports one band above iOS's 8890-8892, so this harness, the iOS harness, and a live
// `pnpm dev:stack` never fight over a listener (each sweeps only its own band), and still clear of
// the 80xx/809x self-hosting territory dev-stack's comment records. Postgres is a Testcontainer on
// its own mapped port, as everywhere else.
const API_PORT = Number(process.env["CROSSY_IT_API_PORT"] ?? "8990");
const SESSION_PORT = Number(process.env["CROSSY_IT_SESSION_PORT"] ?? "8991");
const JWKS_PORT = Number(process.env["CROSSY_IT_JWKS_PORT"] ?? "8992");

const API_URL = `http://127.0.0.1:${API_PORT}`;
const SESSION_WS_BASE = `ws://127.0.0.1:${SESSION_PORT}`;
const ISSUER = `http://127.0.0.1:${JWKS_PORT}/auth/v1`;

// The dev-stack seed puzzle, verbatim (the same one apps/ios/scripts/integration.ts seeds): a real
// 5x5 double word square, XWord Info document shape (the G1 ingestion ACL translates at the
// boundary). The grid carries the solution letters server-side only; what the Kotlin client sees
// never includes them (INV-6), and the tests place arbitrary letters, not these.
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

// Orphan reaping, the dev-stack pattern: each run records its process groups in a pidfile and reaps
// live leftovers before starting; a port sweep catches orphans with no pidfile entry. The ownership
// check is load bearing: after a reboot a recorded pid can belong to an unrelated process, so
// nothing is ever signaled unless its command line carries this repo's path.

const PIDFILE = join(here, ".integration.pid");
const DRAIN_TIMEOUT_MS = 10_000;
const STACK_PORTS: Array<[number, string]> = [
  [API_PORT, "api"],
  [SESSION_PORT, "session"],
  [JWKS_PORT, "jwks"],
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
 * True only when `pid` is one of ours: its command line carries the repo path (the services run
 * under the repo's tsx, and the gradle build's JVMs carry absolute repo classpaths for exactly this
 * check). /proc on Linux, ps elsewhere; an unconfirmable pid is never killed.
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

/** The process group id of `pid`, via ps (portable to darwin), or null. */
function groupOf(pid: number): number | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "pgid="], {
      encoding: "utf8",
    });
    const pgid = Number(out.trim());
    return Number.isInteger(pgid) && pgid > 0 ? pgid : null;
  } catch {
    return null;
  }
}

/** Pids listening on `port`: ss on Linux (the primary), lsof where available (darwin fallback). */
function portOwners(port: number): number[] {
  try {
    const out = execFileSync("ss", ["-ltnpH"], { encoding: "utf8" });
    const pids = new Set<number>();
    for (const raw of out.split("\n")) {
      const local = raw.trim().split(/\s+/)[3];
      if (local === undefined || !local.endsWith(`:${port}`)) continue;
      for (const m of raw.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
    }
    if (pids.size > 0) return [...pids];
  } catch {
    // ss absent (darwin): fall through to lsof.
  }
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    );
    return out
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/**
 * SIGTERM a confirmed-ours process, wait, then SIGKILL if it lingers. Ownership is checked on `pid`
 * itself, never its group leader (often the shared pnpm wrapper), and this process and its own group
 * are never reaped.
 */
async function reapProcess(pid: number, label: string): Promise<void> {
  const ownGroup = groupOf(process.pid) ?? process.pid;
  if (pid === process.pid || pid === ownGroup) return;
  if (!alive(pid) || !isOurs(pid)) return;
  console.log(`reaping an orphaned ${label} (pid ${pid}) from a prior run...`);
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

/**
 * Reject if a loopback port is already taken, probing both loopback families (the dev-stack lesson:
 * an IPv4-only probe false-passes a [::1] squatter).
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
            `${label} port ${port} is in use (${code} on ${host}). Free it or set the matching CROSSY_IT_*_PORT env var.`,
          ),
        );
      });
      srv.listen(port, host, () => srv.close(() => resolve()));
    });
  return probe("127.0.0.1").then(() => probe("::1"));
}

function preflight(): Promise<void> {
  return Promise.all(
    STACK_PORTS.map(([port, label]) => checkPortFree(port, label)),
  ).then(() => undefined);
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
      throw first; // still held: a process we cannot claim owns it
    }
  }
}

/**
 * The post-teardown verification the process-hygiene rule requires: after everything is down, no
 * stack port may still have a listener and no pid this run recorded may still be alive. Returns a
 * human-readable report and whether it is clean; the caller prints it either way.
 */
function verifyNoOrphans(): { clean: boolean; report: string } {
  const lines: string[] = [];
  let clean = true;
  for (const [port, label] of STACK_PORTS) {
    const owners = portOwners(port).filter((pid) => alive(pid));
    if (owners.length === 0) {
      lines.push(`  port ${port} (${label}): free`);
    } else {
      clean = false;
      lines.push(
        `  port ${port} (${label}): STILL HELD by pid(s) ${owners.join(", ")}`,
      );
    }
  }
  let tracked = "no pidfile";
  if (existsSync(PIDFILE)) {
    try {
      const data = JSON.parse(readFileSync(PIDFILE, "utf8")) as Pidfile;
      const live = Object.entries(data.groups)
        .filter(([, pid]) => alive(pid))
        .map(([label, pid]) => `${label}:${pid}`);
      if (live.length === 0) {
        tracked = "all recorded groups dead";
      } else {
        clean = false;
        tracked = `LIVE recorded groups ${live.join(", ")}`;
      }
    } catch {
      tracked = "unreadable pidfile";
    }
  }
  lines.push(`  tracked groups: ${tracked}`);
  return {
    clean,
    report: `orphan check (${clean ? "ALL CLEAR" : "ORPHANS REMAIN"}):\n${lines.join("\n")}`,
  };
}

/** POST JSON to the api with a bearer token, throwing on a non-2xx. */
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

/**
 * Run `:session:test` in apps/android with the connection facts injected. Output streams through
 * (stdio inherit); detached so the whole gradle tree (the --no-daemon build JVM plus its forked
 * test workers) is one reapable group, and the JVMs carry absolute repo classpaths so the group's
 * command lines carry the repo path the sweep's ownership check keys on.
 */
function spawnGradleTests(facts: Record<string, string>): ChildProcess {
  return spawn("./gradlew", ["--no-daemon", ":session:test"], {
    cwd: androidAppDir,
    env: { ...process.env, ...facts },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
}

let container: StartedPostgreSqlContainer | null = null;
let jwks: Server | null = null;
let api: ChildProcess | null = null;
let session: ChildProcess | null = null;
let gradleTests: ChildProcess | null = null;
let toreDown = false;

function forceKillAll(): void {
  for (const child of [session, api, gradleTests]) {
    if (child?.pid !== undefined) killGroup(child.pid, "SIGKILL");
  }
}

/** Record the live process groups so the next run can reap a leaked one. */
function writePidfile(): void {
  const groups: Record<string, number> = {};
  if (session?.pid !== undefined) groups["session"] = session.pid;
  if (api?.pid !== undefined) groups["api"] = api.pid;
  if (gradleTests?.pid !== undefined) groups["gradle-test"] = gradleTests.pid;
  const data: Pidfile = {
    startedAt: Date.now(),
    parentPid: process.pid,
    groups,
  };
  writeFileSync(PIDFILE, JSON.stringify(data));
}

/**
 * Always-runs teardown: SIGKILL the gradle tree first (a build has no drain to protect), then
 * SIGTERM the session so its drain flushes the accepted tail to Postgres (INV-5), then the api, the
 * jwks server, and the container. Bounded: a hung drain escalates to a group SIGKILL rather than
 * holding the ports. Orphaned containers from a run killed harder than this are Ryuk's job (the
 * Testcontainers reaper removes them once the controlling connection dies).
 */
async function teardown(): Promise<void> {
  if (toreDown) return;
  toreDown = true;
  const drain = (async () => {
    await killChild(gradleTests, "SIGKILL");
    await killChild(session, "SIGTERM");
    await killChild(api, "SIGKILL");
    await new Promise<void>((r) => (jwks ? jwks.close(() => r()) : r()));
    await container?.stop();
  })();
  await Promise.race([drain, delay(DRAIN_TIMEOUT_MS)]);
  forceKillAll();
  rmSync(PIDFILE, { force: true });
}

async function shutdownOnSignal(signal: string): Promise<void> {
  console.log(`\n${signal} received, tearing the stack down...`);
  await teardown();
  const { report } = verifyNoOrphans();
  console.log(report);
  process.exit(1);
}

async function main(): Promise<void> {
  // Survive a dead controlling terminal: a write to a closed pipe must not crash the teardown, and a
  // disconnect during startup must still drain (SIGHUP).
  process.stdout.on("error", () => undefined);
  process.stderr.on("error", () => undefined);
  process.on("SIGINT", () => void shutdownOnSignal("SIGINT"));
  process.on("SIGTERM", () => void shutdownOnSignal("SIGTERM"));
  process.on("SIGHUP", () => void shutdownOnSignal("SIGHUP"));

  if (process.argv.includes("--reap")) {
    await reapFromPidfile();
    await reapFromPorts();
    const { report } = verifyNoOrphans();
    console.log("reaped any orphaned integration-stack processes.");
    console.log(report);
    return;
  }

  // The sweep runs first, every run: clear what a prior crash or disconnect leaked, then confirm the
  // band is actually free.
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
    PORT: String(API_PORT),
  });
  writePidfile();
  await waitForHttp(`http://127.0.0.1:${SESSION_PORT}/`);
  await waitForHttp(`${API_URL}/health`);

  console.log("seeding one game through the api (two full-account members)...");
  const tokenA = await auth.mint(randomUUID(), false);
  const tokenB = await auth.mint(randomUUID(), false);
  // C never joins here: the REST arrival suite (I3) walks the cold path itself.
  const tokenC = await auth.mint(randomUUID(), false);
  const puzzle = (await postJson("/puzzles", tokenA, PUZZLE)) as {
    puzzleId: string;
  };
  const game = (await postJson("/games", tokenA, {
    puzzleId: puzzle.puzzleId,
  })) as { gameId: string; inviteCode: string };
  await postJson(`/games/${game.gameId}/join`, tokenB, {
    code: game.inviteCode,
  });

  console.log(`running :session:test against game ${game.gameId}...`);
  gradleTests = spawnGradleTests({
    CROSSY_IT_API_URL: API_URL,
    CROSSY_IT_WS_BASE: SESSION_WS_BASE,
    CROSSY_IT_GAME_ID: game.gameId,
    CROSSY_IT_INVITE_CODE: game.inviteCode,
    CROSSY_IT_TOKEN_A: tokenA,
    CROSSY_IT_TOKEN_B: tokenB,
    CROSSY_IT_TOKEN_C: tokenC,
  });
  writePidfile(); // again, now that the gradle group exists too
  const code = await new Promise<number>((resolve) => {
    gradleTests?.on("exit", (exitCode, signalCode) =>
      resolve(signalCode !== null ? 1 : (exitCode ?? 1)),
    );
  });

  await teardown();
  // The process-hygiene rule: verify nothing survived teardown, and report it.
  const { clean, report } = verifyNoOrphans();
  console.log(report);
  console.log(
    code === 0 ? "integration suite green." : `:session:test exited ${code}.`,
  );
  process.exit(code === 0 && clean ? 0 : code === 0 ? 2 : code);
}

main().catch(async (err: unknown) => {
  console.error("integration harness failed:", err);
  await teardown();
  const { report } = verifyNoOrphans();
  console.log(report);
  process.exit(1);
});
