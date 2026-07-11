// The Phase I2 scripted-room proof (apps/ios/ROADMAP.md I2 exit): boot the real local
// stack, create a game with a real puzzle fixture, build and launch the iOS simulator
// app configured against the stack, drive a scripted teammate over a real WebSocket
// (letters plus cursor presence), and prove the app renders them with a simctl
// screenshot. Run it as `corepack pnpm test:ios-room`; `--reap` sweeps orphans and
// exits; `--launch '<game url>'` is the one-command dogfood against a running
// dev-stack (see runLaunchMode and the recipe at the bottom).
//
// It reuses the I1e harness by import (e2e/src/harness.ts: Testcontainers Postgres,
// migrations, jose token minting, the JWKS server, service spawn, http readiness), so
// it orchestrates processes and duplicates none of that. Ports 8893-8895 sit one band
// above I1e's 8890-8892, so this harness, a live I1e run, and a `pnpm dev:stack` never
// fight over a listener (each sweeps only its own band).
//
// Teardown plus an orphan sweep is part of the script, not a convention (the
// integration.ts precedent, extended to the simulator): teardown always runs (the proof
// failed, startup died, Ctrl+C), it kills the stack processes AND shuts down the
// simulator, and every run reaps what a prior crashed run may have leaked before it
// takes the ports and the device. Running it twice back-to-back green is the teardown
// proof (the exit criterion in the brief).
//
// Dogfood recipe (how the owner solves phone-vs-browser locally) is at the bottom.

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { get as httpGet } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createNetServer } from "node:net";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
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
const xcodeProjectDir = join(repoRoot, "apps/ios/Crossy");

// One band above I1e (8890-8892): api, session, jwks. The app dials the api for the
// game view and the session for the socket; the JWKS server backs token verification
// exactly as the services expect from Supabase (SP2).
const API_PORT = Number(process.env["CROSSY_ROOM_API_PORT"] ?? "8893");
const SESSION_PORT = Number(process.env["CROSSY_ROOM_SESSION_PORT"] ?? "8894");
const JWKS_PORT = Number(process.env["CROSSY_ROOM_JWKS_PORT"] ?? "8895");

const API_URL = `http://127.0.0.1:${API_PORT}`;
const SESSION_WS_BASE = `ws://127.0.0.1:${SESSION_PORT}`;
const ISSUER = `http://127.0.0.1:${JWKS_PORT}/auth/v1`;

// The app runs on the simulator, which reaches the host stack through the shared
// loopback (simulators share the Mac's network namespace, so 127.0.0.1 in the app is
// the Mac's loopback where the services listen).
const APP_BUNDLE_ID = "com.eamonma.Crossy";
const SCHEME = "Crossy";
// A dedicated named device so this harness owns its lifecycle and can reap a strayed
// one by name after a crash. iOS 26 per the brief and the CI pin (ios.yml macos-26).
const SIM_NAME = "Crossy-Room-Proof";
const SIM_RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
const SIM_DEVICE_TYPE = "com.apple.CoreSimulator.SimDeviceType.iPhone-17";

// The dev-stack seed puzzle, verbatim (integration.ts): a real 5x5 double word square,
// XWord Info document shape. The grid carries the solution letters server-side only;
// the app sees the solution-stripped ClientPuzzle (INV-6), and the teammate places
// arbitrary letters, not these.
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

// The teammate's scripted moves: a word of letters into the second row, plus a cursor
// patrol so presence marks appear. Cells are row-major indices into the 5x5 grid; the
// letters are arbitrary (not the solution), proving the app renders a teammate's
// sequenced writes and ephemeral cursor, not fixture data.
const TEAMMATE_WORD: Array<{ cell: number; value: string }> = [
  { cell: 5, value: "T" },
  { cell: 6, value: "E" },
  { cell: 7, value: "A" },
  { cell: 8, value: "M" },
];
const TEAMMATE_CURSOR_CELLS = [10, 11, 12, 11, 10];

// Orphan reaping, the integration.ts pattern: a pidfile records this run's process
// groups plus the simulator udid, and reaps live leftovers before starting; a port
// sweep catches process orphans with no pidfile entry, and a device-name sweep catches
// a strayed simulator. Ownership is load bearing: a recorded pid is signaled only if
// its command line carries this repo's path, so a reused pid after a reboot is safe.

const PIDFILE = join(here, ".room.pid");
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
  simUdid?: string;
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
 * True only when `pid` is one of ours: its command line carries the repo path. /proc on
 * Linux, ps elsewhere (this harness's home is a Mac); an unconfirmable pid is never
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

/** Pids listening on `port`: lsof (darwin), ss otherwise (Linux). */
function portOwners(port: number): number[] {
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      {
        encoding: "utf8",
      },
    );
    return out
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    // lsof exits 1 on no matches; ss is the Linux fallback when lsof is absent.
  }
  try {
    const out = execFileSync("ss", ["-ltnpH"], { encoding: "utf8" });
    const pids = new Set<number>();
    for (const raw of out.split("\n")) {
      const local = raw.trim().split(/\s+/)[3];
      if (local === undefined || !local.endsWith(`:${port}`)) continue;
      for (const m of raw.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

/** SIGTERM a confirmed-ours process, wait, then SIGKILL if it lingers. */
async function reapProcess(pid: number, label: string): Promise<void> {
  const ownGroup = groupOf(process.pid) ?? process.pid;
  if (pid === process.pid || pid === ownGroup) return;
  if (!alive(pid) || !isOurs(pid)) return;
  console.log(`reaping an orphaned ${label} (pid ${pid}) from a prior run...`);
  killGroup(pid, "SIGTERM");
  for (let i = 0; i < 20 && alive(pid); i++) await delay(100);
  if (alive(pid)) killGroup(pid, "SIGKILL");
}

/** Reap the processes and the simulator a previous run recorded, then drop the pidfile. */
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
  await reapProcess(data.parentPid, "parent");
  if (data.simUdid !== undefined) shutdownSimulator(data.simUdid);
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
 * Reject if a loopback port is already taken, probing both loopback families (the
 * dev-stack lesson: an IPv4-only probe false-passes a [::1] squatter).
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
            `${label} port ${port} is in use (${code} on ${host}). Free it or set the matching CROSSY_ROOM_*_PORT env var.`,
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

// MARK: - Simulator lifecycle (simctl + xcodebuild)

interface SimDevice {
  udid: string;
  name: string;
  state: string;
}

/** All simulator devices across runtimes, flattened, via `simctl list --json`. */
function listDevices(): SimDevice[] {
  const out = execFileSync("xcrun", ["simctl", "list", "devices", "--json"], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(out) as {
    devices: Record<
      string,
      Array<{ udid: string; name: string; state: string }>
    >;
  };
  const devices: SimDevice[] = [];
  for (const list of Object.values(parsed.devices)) {
    for (const d of list)
      devices.push({ udid: d.udid, name: d.name, state: d.state });
  }
  return devices;
}

/** Shut down and delete a device by udid, swallowing errors (a reap is best-effort). */
function shutdownSimulator(udid: string): void {
  try {
    execFileSync("xcrun", ["simctl", "shutdown", udid], { stdio: "ignore" });
  } catch {
    // already off, or gone
  }
  try {
    execFileSync("xcrun", ["simctl", "delete", udid], { stdio: "ignore" });
  } catch {
    // already deleted
  }
}

/** Reap any strayed device by our dedicated name (an orphan with no pidfile entry). */
function reapStraySimulators(): void {
  for (const device of listDevices()) {
    if (device.name === SIM_NAME) {
      console.log(
        `reaping a strayed simulator "${SIM_NAME}" (${device.udid})...`,
      );
      shutdownSimulator(device.udid);
    }
  }
}

/** Create the dedicated device fresh and boot it; returns its udid. */
function createAndBootSimulator(): string {
  const udid = execFileSync(
    "xcrun",
    ["simctl", "create", SIM_NAME, SIM_DEVICE_TYPE, SIM_RUNTIME],
    { encoding: "utf8" },
  ).trim();
  execFileSync("xcrun", ["simctl", "boot", udid], { stdio: "inherit" });
  // Wait until the device is fully booted before installing.
  execFileSync("xcrun", ["simctl", "bootstatus", udid, "-b"], {
    stdio: "inherit",
  });
  return udid;
}

/**
 * Build the app for this simulator and return the built .app path. Signing is off (CI
 * holds no certificates and a simulator build needs none, the ios.yml posture).
 */
function buildApp(udid: string): string {
  const derived = join(here, ".room-derived");
  execFileSync(
    "xcodebuild",
    [
      "build",
      "-project",
      join(xcodeProjectDir, "Crossy.xcodeproj"),
      "-scheme",
      SCHEME,
      "-destination",
      `id=${udid}`,
      "-derivedDataPath",
      derived,
      "CODE_SIGNING_ALLOWED=NO",
    ],
    { stdio: "inherit", cwd: xcodeProjectDir },
  );
  return join(derived, "Build/Products/Debug-iphonesimulator/Crossy.app");
}

/**
 * Install the built app and launch it with the CROSSY_IT_* facts as launch arguments,
 * so RoomConfig.resolve lands in RealRoom against this stack (the -flag value convention
 * RoomConfig reads). The arguments carry the injected token, so the app dials REST and
 * the socket as the host identity.
 */
function installAndLaunch(
  udid: string,
  appPath: string,
  facts: Record<string, string>,
): void {
  execFileSync("xcrun", ["simctl", "install", udid, appPath], {
    stdio: "inherit",
  });
  const args: string[] = [];
  for (const [key, value] of Object.entries(facts)) {
    args.push(`-${key}`, value);
  }
  execFileSync("xcrun", ["simctl", "launch", udid, APP_BUNDLE_ID, ...args], {
    stdio: "inherit",
  });
}

/** A PNG screenshot into a gitignored tmp path (never committed): the render evidence. */
function screenshot(udid: string, label: string): string {
  const dir = join(tmpdir(), "crossy-room-proof");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${label}-${Date.now()}.png`);
  execFileSync("xcrun", ["simctl", "io", udid, "screenshot", path], {
    stdio: "ignore",
  });
  return path;
}

// MARK: - The scripted teammate (a real WebSocket, the room's second player)

/**
 * Connect a second identity to the game's socket and drive it: hello, wait for welcome,
 * then place a word of letters (each a placeLetter with a fresh commandId) and patrol a
 * cursor (moveCursor). The app, connected as the host, receives these as sequenced
 * cellSets and ephemeral cursor notices and renders them (INV-10 plus presence). This is
 * a real round trip through the session service, not a fixture.
 */
async function driveTeammate(gameId: string, token: string): Promise<void> {
  const url = `${SESSION_WS_BASE}/games/${gameId}/ws`;
  const socket = new WebSocket(url);

  const welcomed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("teammate never got welcome")),
      15_000,
    );
    socket.addEventListener("message", (event) => {
      try {
        const frame = JSON.parse(String((event as MessageEvent).data)) as {
          type?: string;
        };
        if (frame.type === "welcome") {
          clearTimeout(timer);
          resolve();
        }
      } catch {
        // not JSON: ignore, exactly the drop-and-log posture the client uses
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("teammate socket errored before welcome"));
    });
  });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () =>
      reject(new Error("teammate socket failed to open")),
    );
  });
  socket.send(JSON.stringify({ type: "hello", protocolVersion: 1, token }));
  await welcomed;

  // Place the word: one placeLetter per cell, a fresh commandId each (PROTOCOL.md §3).
  for (const { cell, value } of TEAMMATE_WORD) {
    socket.send(
      JSON.stringify({
        type: "placeLetter",
        commandId: randomUUID(),
        cell,
        value,
      }),
    );
    await delay(150);
  }
  // Patrol a cursor so presence marks move on the board (PROTOCOL.md §9).
  for (const cell of TEAMMATE_CURSOR_CELLS) {
    socket.send(
      JSON.stringify({ type: "moveCursor", cell, direction: "across" }),
    );
    await delay(200);
  }
  // Let the app apply and render the tail before the screenshot.
  await delay(600);
  socket.close(1000);
}

/**
 * Readiness poll for the SESSION origin specifically, via node:http with
 * `agent: false` so no keep-alive socket outlives the probe. The harness's
 * fetch-based `waitForHttp` parks a pooled keep-alive connection in undici's
 * global agent; the session's Node server reaps it after its idle timeout, and
 * when the first WebSocket dial to that origin lands minutes later (the
 * simulator build and boot sit in between), undici reuses the stale pooled
 * socket for the upgrade and the dial dies as close 1006 with no frames.
 * Diagnosed live in the Studio run of this harness (ios/i2-exit); a socket
 * that never enters the pool cannot go stale in it.
 */
function waitForSessionReady(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = httpGet(url, { agent: false }, (res) => {
        res.resume(); // drain so the one-shot socket closes cleanly
        if (res.statusCode !== undefined && res.statusCode < 500) {
          resolve();
          return;
        }
        retry(`status ${res.statusCode}`);
      });
      req.on("error", (err) => retry(String(err)));
    };
    const retry = (last: string): void => {
      if (Date.now() >= deadline) {
        reject(new Error(`timed out waiting for ${url} (${last})`));
        return;
      }
      setTimeout(attempt, 150);
    };
    attempt();
  });
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

let container: StartedPostgreSqlContainer | null = null;
let jwks: Server | null = null;
let api: ChildProcess | null = null;
let session: ChildProcess | null = null;
let simUdid: string | null = null;
let toreDown = false;

function forceKillAll(): void {
  for (const child of [session, api]) {
    if (child?.pid !== undefined) killGroup(child.pid, "SIGKILL");
  }
}

/** Record the live process groups plus the simulator so the next run can reap a leak. */
function writePidfile(): void {
  const groups: Record<string, number> = {};
  if (session?.pid !== undefined) groups["session"] = session.pid;
  if (api?.pid !== undefined) groups["api"] = api.pid;
  const data: Pidfile = {
    startedAt: Date.now(),
    parentPid: process.pid,
    groups,
    ...(simUdid !== null ? { simUdid } : {}),
  };
  writeFileSync(PIDFILE, JSON.stringify(data));
}

/**
 * Always-runs teardown: shut down the simulator, SIGTERM the session first so its drain
 * flushes the accepted tail to Postgres (INV-5), then the api, the jwks server, and the
 * container. Bounded: a hung drain escalates to a group SIGKILL rather than holding the
 * ports.
 */
async function teardown(): Promise<void> {
  if (toreDown) return;
  toreDown = true;
  if (simUdid !== null) shutdownSimulator(simUdid);
  const drain = (async () => {
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
  console.log(`\n${signal} received, tearing the room proof down...`);
  await teardown();
  process.exit(1);
}

/**
 * `--launch '<game url>'`: the one-command dogfood (ported from the Studio run,
 * ios/i2-exit). Against a running `corepack pnpm dev:stack`, parse the printed
 * game url (…/game/<id>?api=…&token=…), build the app, and launch a simulator
 * straight into that room as the url's identity; the human solves in a browser
 * on the stack's other printed url. This mode boots no services and sweeps
 * nothing, so nothing is torn down: Ctrl+C in the dev-stack terminal stops the
 * stack as usual, and the simulator stays up for the human. For a real device,
 * CROSSY_ROOM_WS_BASE overrides the session origin and the same four launch
 * arguments go into the Xcode scheme (the recipe at the bottom).
 */
function runLaunchMode(gameUrl: string): void {
  const url = new URL(gameUrl);
  const gameId = url.pathname.split("/").filter(Boolean).at(-1);
  const apiUrl = url.searchParams.get("api");
  const token = url.searchParams.get("token");
  if (gameId === undefined || apiUrl === null || token === null) {
    throw new Error(
      "--launch expects a dev-stack game url (…/game/<id>?api=…&token=…), quoted",
    );
  }
  // dev-stack's stable session port; CROSSY_ROOM_WS_BASE overrides for a device.
  const wsBase = process.env["CROSSY_ROOM_WS_BASE"] ?? "ws://127.0.0.1:8791";

  // An already-booted simulator is the human's; otherwise boot the dedicated
  // device (a later proof run reaps it by name, so leaving it up is safe).
  const booted = listDevices().find((d) => d.state === "Booted");
  const udid = booted?.udid ?? createAndBootSimulator();
  const appPath = buildApp(udid);
  installAndLaunch(udid, appPath, {
    CROSSY_IT_API_URL: apiUrl,
    CROSSY_IT_WS_BASE: wsBase,
    CROSSY_IT_GAME_ID: gameId,
    CROSSY_IT_TOKEN: token,
  });
  console.log(
    [
      "",
      `The real room is live on ${booted?.name ?? SIM_NAME} as this token's player.`,
      "Open the stack's OTHER printed url in a browser and solve together.",
      "This mode started no services, so nothing is torn down here; Ctrl+C in",
      "the dev-stack terminal stops the stack as usual.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  process.stdout.on("error", () => undefined);
  process.stderr.on("error", () => undefined);
  process.on("SIGINT", () => void shutdownOnSignal("SIGINT"));
  process.on("SIGTERM", () => void shutdownOnSignal("SIGTERM"));
  process.on("SIGHUP", () => void shutdownOnSignal("SIGHUP"));

  const launchIndex = process.argv.indexOf("--launch");
  if (launchIndex !== -1) {
    const gameUrl = process.argv[launchIndex + 1];
    if (gameUrl === undefined) {
      throw new Error("--launch needs the dev-stack game url as its argument");
    }
    runLaunchMode(gameUrl);
    return;
  }

  if (process.argv.includes("--reap")) {
    await reapFromPidfile();
    await reapFromPorts();
    reapStraySimulators();
    console.log("reaped any orphaned room-proof processes and simulators.");
    return;
  }

  // The sweep runs first, every run: clear what a prior crash or disconnect leaked
  // (processes, ports, and a strayed simulator), then confirm the band is free.
  await reapFromPidfile();
  await reapFromPorts();
  reapStraySimulators();
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
  // The session origin gets the pool-free probe (its next visitor is a WebSocket
  // upgrade); the api origin keeps waitForHttp, whose pooled socket is reused
  // immediately by the fetch-based seeding below, never left to go stale.
  await waitForSessionReady(`http://127.0.0.1:${SESSION_PORT}/`);
  await waitForHttp(`${API_URL}/health`);

  console.log(
    "seeding one game (host who solves in the app, plus a scripted teammate)...",
  );
  const hostToken = await auth.mint(randomUUID(), false);
  const teammateToken = await auth.mint(randomUUID(), false);
  const puzzle = (await postJson("/puzzles", hostToken, PUZZLE)) as {
    puzzleId: string;
  };
  const game = (await postJson("/games", hostToken, {
    puzzleId: puzzle.puzzleId,
  })) as {
    gameId: string;
    inviteCode: string;
  };
  await postJson(`/games/${game.gameId}/join`, teammateToken, {
    code: game.inviteCode,
  });

  console.log("creating and booting the iOS 26 simulator...");
  simUdid = createAndBootSimulator();
  writePidfile(); // record the udid now that it exists

  console.log("building the app for the simulator...");
  const appPath = buildApp(simUdid);

  console.log("installing and launching the app against the stack...");
  installAndLaunch(simUdid, appPath, {
    CROSSY_IT_API_URL: API_URL,
    CROSSY_IT_WS_BASE: SESSION_WS_BASE,
    CROSSY_IT_GAME_ID: game.gameId,
    CROSSY_IT_TOKEN: hostToken,
  });

  // Let the app fetch the game view, map the puzzle, and complete the hello/welcome
  // handshake before the teammate writes, so its cellSets land on a live, rendered room.
  await delay(4_000);
  const before = screenshot(simUdid, "before");
  console.log(`screenshot (empty room, host connected): ${before}`);

  console.log("driving the scripted teammate over a real WebSocket...");
  await driveTeammate(game.gameId, teammateToken);

  const after = screenshot(simUdid, "after-teammate");
  console.log(`screenshot (teammate letters + cursor rendered): ${after}`);

  // Weather evidence (ported from the Studio run): drop the session (SIGTERM,
  // so the accepted tail flushes, INV-5) and catch the dimmed room with the
  // quiet countdown — the reconnectRetryAt wiring over the real wire — then
  // restart on the same port and catch the redialed, re-livened room.
  console.log("dropping the session service for the reconnecting weather...");
  await killChild(session, "SIGTERM");
  session = null;
  await delay(3_000); // a few failed dials in, the backoff walk shows the countdown
  const reconnecting = screenshot(simUdid, "weather-reconnecting");
  console.log(`screenshot (dimmed room, quiet countdown): ${reconnecting}`);

  console.log("restarting the session service on the same port...");
  session = spawnService("session", sessionEntry, {
    DATABASE_URL: dbUrl,
    SUPABASE_ISSUER: ISSUER,
    PORT: String(SESSION_PORT),
    HOST: "127.0.0.1",
  });
  writePidfile();
  await waitForSessionReady(`http://127.0.0.1:${SESSION_PORT}/`);
  await delay(4_000); // the app's backoff dial lands and the welcome resyncs
  const reconnected = screenshot(simUdid, "weather-reconnected");
  console.log(`screenshot (redialed, board rehydrated): ${reconnected}`);

  await teardown();
  console.log(
    "room proof green: the app rendered a scripted teammate over the real wire,",
    "and rode a session drop through the reconnect weather and back.",
  );
  console.log(
    `evidence screenshots (gitignored tmp, never committed):\n  ${before}\n  ${after}\n  ${reconnecting}\n  ${reconnected}`,
  );
  process.exit(0);
}

main().catch(async (err: unknown) => {
  console.error("room proof failed:", err);
  await teardown();
  process.exit(1);
});

// Dogfood recipe (how the owner solves phone-vs-browser locally, apps/ios/ROADMAP.md I2
// exit: an iOS simulator or device and a web browser solve a real puzzle together):
//
//   1. `corepack pnpm dev:stack` boots the local stack (api, session, Postgres) on the
//      dev band (8790-8792) and prints two signed-in game urls, one per identity.
//      Open one in a browser and solve there.
//   2. Terminal 2: `corepack pnpm test:ios-room --launch '<the other printed url>'`.
//      That builds the app, boots (or reuses) a simulator, and launches it straight
//      into the same room as that url's identity: the browser and the simulator now
//      solve together. This is the phone-vs-browser dogfood the I2 exit calls for.
//   3. For a real device instead of the simulator, set the same four launch arguments
//      in the Xcode scheme's Run action ("Arguments Passed On Launch"):
//        -CROSSY_IT_API_URL   http://<the Mac's LAN address>:8790
//        -CROSSY_IT_WS_BASE   ws://<the Mac's LAN address>:8791
//        -CROSSY_IT_GAME_ID   <the game id from the printed url>
//        -CROSSY_IT_TOKEN     <the token from the printed url>
//      (RoomConfig.resolve reads these; with none set the app stays in DemoRoom. The
//      phone must reach the Mac over the LAN, so loopback won't do there.)
//      `corepack pnpm test:ios-room` with no flags is the same shape, scripted and
//      screenshotted, with teardown proven.
