// The Phase I2 exit proof (apps/ios/ROADMAP.md): the REAL room against the REAL local
// stack. Boots the two-service stack (the I1e machinery, reused by import from
// e2e/src/harness.ts), seeds a real game with two full accounts, builds the app for
// the simulator, boots an iOS 26 simulator, launches the app with the CROSSY_ROOM_*
// facts injected (simctl forwards SIMCTL_CHILD_-prefixed variables to the app), then
// drives the two-sided proof:
//
//   server-to-app  a scripted Node WebSocket client (the second account, mirroring
//                  apps/web/src/net/wsTransport.ts's frames) places letters and parks
//                  a cursor; the app's -roomScript path types only AFTER its store
//                  renders that teammate letter and cursor, so the app's own letters
//                  are the acknowledgment of receipt.
//   app-to-server  the scripted client asserts the app's letters (and its cursor
//                  relay) arrive attributed to the app's identity.
//
// Screenshots (simctl io screenshot) land after the wire-level acknowledgment, so
// they show the teammate's letters and presence rendered in the real app; pixels are
// evidence, the wire is the gate (the room-bar timer ticks at 1 Hz, so byte-stable
// screenshot polling can never settle). Teardown always runs and every run sweeps
// orphans first, exactly the integration.ts discipline; a simulator this script
// booted is shut down again, one it found running is left alone.
//
// Run it:            corepack pnpm test:ios-room          (exit code propagates)
// Sweep orphans:     corepack pnpm test:ios-room --reap
//
// Dogfood recipe (the owner's human test, no scripted anything):
//   1. Terminal 1:   corepack pnpm dev:stack
//      It prints two game URLs. Open Tab 1's URL in a browser (that is Ada).
//   2. Terminal 2:   corepack pnpm test:ios-room --launch '<the Tab 2 url>'
//      Paste Tab 2's URL verbatim (quoted; it carries api, token, and game id). The
//      script builds the app, boots an iOS 26 simulator, and launches the real room
//      as Grace against dev-stack's stable ports (session ws://127.0.0.1:8791;
//      override with CROSSY_ROOM_WS_BASE for a device pointed at the Mac's LAN
//      address, though dev-stack binds loopback only, so a simulator is the path of
//      least resistance). Everything stays up for the humans; Ctrl+C tears nothing
//      down in this mode. Solve together; letters, cursors, and the conflict flash
//      cross between browser and simulator live.
//
// Ports: 8990-8992, one band above the I1e integration harness's 8890-8892, which is
// itself one above dev-stack's 8790-8792. Each harness sweeps only its own band, so
// three distinct bands mean this proof, a live `pnpm dev:stack`, and a running
// integration suite never reap or squat each other's listeners, and all three stay
// clear of the 80xx/809x self-hosting territory dev-stack's comment records.

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get as httpGet } from "node:http";
import { createServer as createNetServer } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
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
const projectDir = join(repoRoot, "apps/ios/Crossy");
const BUNDLE_ID = "com.eamonma.Crossy";

// Fixed ports, the 899x band (see the header for why this band).
const API_PORT = Number(process.env["CROSSY_ROOM_API_PORT"] ?? "8990");
const SESSION_PORT = Number(process.env["CROSSY_ROOM_SESSION_PORT"] ?? "8991");
const JWKS_PORT = Number(process.env["CROSSY_ROOM_JWKS_PORT"] ?? "8992");

const API_URL = `http://127.0.0.1:${API_PORT}`;
const SESSION_WS_BASE = `ws://127.0.0.1:${SESSION_PORT}`;
const ISSUER = `http://127.0.0.1:${JWKS_PORT}/auth/v1`;

// Where screenshots land; never committed. The verification run points this at the
// session scratchpad.
const SHOTS_DIR =
  process.env["CROSSY_ROOM_SHOTS_DIR"] ??
  join(tmpdir(), "crossy-ios-room-shots");

// A stable derived-data path OUTSIDE the repo (nothing untracked appears in git
// status) so rebuilds are incremental across runs.
const DERIVED_DATA = join(tmpdir(), "crossy-ios-room-deriveddata");

// The dev-stack seed puzzle, verbatim (integration.ts carries the same fixture): a
// real 5x5 double word square, XWord Info document shape. The solution letters stay
// server-side (INV-6); the proof places arbitrary letters, not these.
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

// The contract with RealRoom.swift's -roomScript: the scripted teammate writes HI
// into row 2 and parks a cursor beside it; the app answers APP into the first
// across word (cells 0-2, empty by construction since the teammate stays off row 0).
const TEAMMATE_LETTERS: Array<[number, string]> = [
  [10, "H"],
  [11, "I"],
];
const TEAMMATE_CURSOR_CELL = 12;
const APP_WORD: Array<[number, string]> = [
  [0, "A"],
  [1, "P"],
  [2, "P"],
];

// ---------------------------------------------------------------------------
// Orphan reaping: the integration.ts pattern verbatim (pidfile + port sweep with
// the ownership check; ps/lsof because this harness's home is a Mac), plus one
// extra recorded fact: the simulator this script booted, so a crashed run's next
// invocation can shut it down again.
// ---------------------------------------------------------------------------

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
  bootedSimUdid?: string;
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

/** True only when `pid` is ours: its command line carries the repo path. */
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

/** Pids listening on `port`: lsof where available (darwin), ss otherwise. */
function portOwners(port: number): number[] {
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

/** Reap what a previous run recorded (its simulator too), then drop the pidfile. */
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
  if (data.bootedSimUdid !== undefined) {
    console.log(`shutting down the simulator a prior run booted...`);
    simctl(["shutdown", data.bootedSimUdid], { allowFailure: true });
  }
  rmSync(PIDFILE, { force: true });
}

/** Reap whatever of ours holds a stack port, catching orphans with no pidfile. */
async function reapFromPorts(): Promise<void> {
  for (const [port, label] of STACK_PORTS) {
    for (const pid of portOwners(port)) {
      await reapProcess(pid, `${label} :${port}`);
    }
  }
}

/** Reject if a loopback port is taken, probing both loopback families. */
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

async function ensurePortsFree(): Promise<void> {
  const preflight = (): Promise<void> =>
    Promise.all(
      STACK_PORTS.map(([port, label]) => checkPortFree(port, label)),
    ).then(() => undefined);
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

// ---------------------------------------------------------------------------
// Simulator plumbing
// ---------------------------------------------------------------------------

function simctl(
  args: string[],
  opts: { allowFailure?: boolean; env?: NodeJS.ProcessEnv } = {},
): string {
  try {
    return execFileSync("xcrun", ["simctl", ...args], {
      encoding: "utf8",
      env: opts.env ?? process.env,
      // Piped, not inherited: an allowed failure (terminating an app that is not
      // running) must not spray simctl noise; a real failure still throws with
      // the captured stderr on the error object.
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (opts.allowFailure === true) return "";
    throw err;
  }
}

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

/** The best available iOS 26 simulator: an iPhone on the newest 26.x runtime. */
function pickSimulator(): SimDevice {
  const raw = simctl(["list", "--json", "devices", "available"]);
  const parsed = JSON.parse(raw) as {
    devices: Record<
      string,
      Array<{ udid: string; name: string; state: string }>
    >;
  };
  const candidates: SimDevice[] = [];
  for (const [runtime, devices] of Object.entries(parsed.devices)) {
    if (!/SimRuntime\.iOS-26-/.test(runtime)) continue;
    for (const d of devices) {
      if (!d.name.startsWith("iPhone")) continue;
      candidates.push({ udid: d.udid, name: d.name, state: d.state, runtime });
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      "no available iOS 26 iPhone simulator; install one via Xcode > Settings > Components",
    );
  }
  // Newest runtime first; a booted device wins within a runtime (no boot cost),
  // then prefer the plain Pro for a representative screenshot.
  candidates.sort((a, b) => {
    if (a.runtime !== b.runtime) return b.runtime.localeCompare(a.runtime);
    if ((a.state === "Booted") !== (b.state === "Booted")) {
      return a.state === "Booted" ? -1 : 1;
    }
    return a.name === "iPhone 17 Pro" ? -1 : b.name === "iPhone 17 Pro" ? 1 : 0;
  });
  return candidates[0]!;
}

/** Boot if needed; true when this run did the booting (and so owns the shutdown). */
function bootSimulator(sim: SimDevice): boolean {
  const bootedByUs = sim.state !== "Booted";
  if (bootedByUs) {
    console.log(`booting simulator ${sim.name} (${sim.udid})...`);
    simctl(["boot", sim.udid], { allowFailure: true }); // racing a manual boot is fine
  }
  // -b blocks until the boot completes, whoever started it.
  execFileSync("xcrun", ["simctl", "bootstatus", sim.udid, "-b"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  return bootedByUs;
}

/** Build the app for the simulator (CI's form: no signing) and return the .app. */
function buildApp(): string {
  console.log("building the app for the simulator (xcodebuild)...");
  execFileSync(
    "xcodebuild",
    [
      "build",
      "-project",
      join(projectDir, "Crossy.xcodeproj"),
      "-scheme",
      "Crossy",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      DERIVED_DATA,
      "-quiet",
      "CODE_SIGNING_ALLOWED=NO",
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  const app = join(
    DERIVED_DATA,
    "Build/Products/Debug-iphonesimulator/Crossy.app",
  );
  if (!existsSync(app)) {
    throw new Error(`xcodebuild succeeded but ${app} is missing`);
  }
  return app;
}

/** Install and launch the app with the CROSSY_ROOM_* facts in its environment. */
function launchApp(
  udid: string,
  appPath: string,
  facts: { apiUrl: string; wsBase: string; gameId: string; token: string },
  launchArgs: string[],
): void {
  simctl(["terminate", udid, BUNDLE_ID], { allowFailure: true });
  simctl(["install", udid, appPath]);
  // simctl forwards SIMCTL_CHILD_-prefixed variables into the app's environment.
  simctl(["launch", udid, BUNDLE_ID, ...launchArgs], {
    env: {
      ...process.env,
      SIMCTL_CHILD_CROSSY_ROOM_API_URL: facts.apiUrl,
      SIMCTL_CHILD_CROSSY_ROOM_WS_BASE: facts.wsBase,
      SIMCTL_CHILD_CROSSY_ROOM_GAME_ID: facts.gameId,
      SIMCTL_CHILD_CROSSY_ROOM_TOKEN: facts.token,
    },
  });
}

function screenshot(udid: string, name: string): string {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const path = join(SHOTS_DIR, name);
  simctl(["io", udid, "screenshot", path]);
  console.log(`screenshot: ${path}`);
  return path;
}

// ---------------------------------------------------------------------------
// Session readiness, pool-free
// ---------------------------------------------------------------------------

/**
 * Readiness poll for the SESSION origin specifically, via node:http with
 * `agent: false` so no keep-alive socket outlives the probe. The harness's
 * fetch-based `waitForHttp` parks a pooled keep-alive connection in undici's
 * global agent; the session's Node server reaps it after its idle timeout, and
 * when the first-ever WebSocket dial to that origin lands minutes later (the
 * simulator boot sits in between), undici reuses the stale pooled socket for the
 * upgrade and the dial dies as close 1006 with no frames. Diagnosed live in this
 * harness; a socket that never enters the pool cannot go stale in it.
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

// ---------------------------------------------------------------------------
// The scripted WebSocket client (PROTOCOL.md §2, §5; Node's global WebSocket)
// ---------------------------------------------------------------------------

interface ServerFrame {
  type: string;
  [key: string]: unknown;
}

class ScriptedClient {
  readonly frames: ServerFrame[] = [];
  private ws: WebSocket | null = null;
  private waiters: Array<() => void> = [];
  private closed = false;
  private closeDetail = "";

  /**
   * Dial and complete the §2 handshake; resolves once the welcome lands. One
   * redial when the socket dies before ANY frame arrived: that is a transport
   * accident (a machine under simulator load), never a protocol answer, which
   * always sends at least an error frame before closing (PROTOCOL.md §2).
   */
  async connect(url: string, token: string): Promise<ServerFrame> {
    try {
      return await this.dial(url, token);
    } catch (err) {
      if (this.frames.length > 0) throw err;
      console.log(`first dial failed (${this.closeDetail}); redialing once...`);
      this.closed = false;
      this.closeDetail = "";
      await delay(1_000);
      return this.dial(url, token);
    }
  }

  private dial(url: string, token: string): Promise<ServerFrame> {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "hello", protocolVersion: 1, token }));
    });
    ws.addEventListener("message", (event: MessageEvent) => {
      try {
        const frame = JSON.parse(String(event.data)) as ServerFrame;
        this.frames.push(frame);
        for (const wake of this.waiters.splice(0)) wake();
      } catch {
        // Malformed inbound is drop-and-log territory; the proof never sends any.
      }
    });
    ws.addEventListener("error", (event) => {
      const message = (event as { message?: string }).message ?? "";
      if (message !== "") this.closeDetail = `error: ${message}`;
    });
    ws.addEventListener("close", (event: CloseEvent) => {
      this.closed = true;
      if (this.closeDetail === "") {
        this.closeDetail = `close ${event.code}${event.reason !== "" ? ` (${event.reason})` : ""}`;
      }
      for (const wake of this.waiters.splice(0)) wake();
    });
    return this.waitFor(
      (f) => f.type === "welcome",
      "the welcome snapshot",
      15_000,
    );
  }

  send(frame: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(frame));
  }

  placeLetter(cell: number, value: string): string {
    const commandId = randomUUID();
    this.send({ type: "placeLetter", commandId, cell, value });
    return commandId;
  }

  /** The first frame matching `pred`, waiting for arrivals up to `timeoutMs`. */
  async waitFor(
    pred: (f: ServerFrame) => boolean,
    what: string,
    timeoutMs: number,
  ): Promise<ServerFrame> {
    const deadline = Date.now() + timeoutMs;
    let scanned = 0;
    for (;;) {
      for (; scanned < this.frames.length; scanned++) {
        const frame = this.frames[scanned]!;
        if (pred(frame)) return frame;
      }
      const seen = this.frames.map((f) => f.type).join(", ") || "none";
      if (this.closed) {
        throw new Error(
          `socket closed while waiting for ${what} (${this.closeDetail}; frames seen: ${seen})`,
        );
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${what} (frames seen: ${seen})`);
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 200);
      });
    }
  }

  close(): void {
    this.closed = true;
    this.ws?.close(1000);
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// REST seeding (the integration.ts shapes)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let container: StartedPostgreSqlContainer | null = null;
let jwks: Server | null = null;
let api: ChildProcess | null = null;
let session: ChildProcess | null = null;
let scripted: ScriptedClient | null = null;
let simUdid: string | null = null;
let simBootedByUs = false;
let appLaunched = false;
let toreDown = false;

function writePidfile(): void {
  const groups: Record<string, number> = {};
  if (session?.pid !== undefined) groups["session"] = session.pid;
  if (api?.pid !== undefined) groups["api"] = api.pid;
  const data: Pidfile = {
    startedAt: Date.now(),
    parentPid: process.pid,
    groups,
    ...(simBootedByUs && simUdid !== null ? { bootedSimUdid: simUdid } : {}),
  };
  writeFileSync(PIDFILE, JSON.stringify(data));
}

/**
 * Always-runs teardown: the scripted socket closes, the app is terminated, the
 * session drains first (SIGTERM so the accepted tail flushes, INV-5), then the api,
 * the jwks server, the container, and finally the simulator IF this run booted it.
 * Bounded: a hung drain escalates to a group SIGKILL rather than holding the ports.
 */
async function teardown(): Promise<void> {
  if (toreDown) return;
  toreDown = true;
  scripted?.close();
  if (simUdid !== null && appLaunched) {
    simctl(["terminate", simUdid, BUNDLE_ID], { allowFailure: true });
  }
  const drain = (async () => {
    await killChild(session, "SIGTERM");
    await killChild(api, "SIGKILL");
    await new Promise<void>((r) => (jwks ? jwks.close(() => r()) : r()));
    await container?.stop();
  })();
  await Promise.race([drain, delay(DRAIN_TIMEOUT_MS)]);
  for (const child of [session, api]) {
    if (child?.pid !== undefined) killGroup(child.pid, "SIGKILL");
  }
  if (simUdid !== null && simBootedByUs) {
    console.log("shutting the simulator down (this run booted it)...");
    simctl(["shutdown", simUdid], { allowFailure: true });
  }
  rmSync(PIDFILE, { force: true });
}

async function shutdownOnSignal(signal: string): Promise<void> {
  console.log(`\n${signal} received, tearing the stack down...`);
  await teardown();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// --launch: dev-stack-compatible mode (the dogfood one-command; see the header)
// ---------------------------------------------------------------------------

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

  const appPath = buildApp();
  const sim = pickSimulator();
  bootSimulator(sim); // left running for the human either way
  launchApp(sim.udid, appPath, { apiUrl, wsBase, gameId, token }, []);
  console.log(
    [
      "",
      `The real room is live on ${sim.name} as this token's player.`,
      "Open the OTHER printed dev-stack url in a browser and solve together.",
      "Nothing was started by this mode, so nothing is torn down; Ctrl+C in the",
      "dev-stack terminal stops the stack as usual.",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

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
    console.log("reaped any orphaned room-proof processes.");
    return;
  }

  // Sweep first, every run; then the build, before any service exists to leak.
  await reapFromPidfile();
  await ensurePortsFree();
  const appPath = buildApp();

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
  await waitForSessionReady(`http://127.0.0.1:${SESSION_PORT}/`);
  await waitForHttp(`${API_URL}/health`);

  console.log("seeding one game through the api (two full-account members)...");
  const userApp = randomUUID();
  const userMate = randomUUID();
  const tokenApp = await auth.mint(userApp, false);
  const tokenMate = await auth.mint(userMate, false);
  const puzzle = (await postJson("/puzzles", tokenApp, PUZZLE)) as {
    puzzleId: string;
  };
  const game = (await postJson("/games", tokenApp, {
    puzzleId: puzzle.puzzleId,
    name: "I2 exit",
  })) as { gameId: string; inviteCode: string };
  await postJson(`/games/${game.gameId}/join`, tokenMate, {
    code: game.inviteCode,
  });
  // Display names, so presence shows real initials instead of "former
  // participant" (users.display_name is null after the JIT upsert). psql inside
  // the Testcontainer keeps this script free of a driver dependency; awaited so
  // the app's welcome cannot race an unnamed participant list.
  const psql = async (sql: string): Promise<void> => {
    const result = await container!.exec([
      "psql",
      "-U",
      container!.getUsername(),
      "-d",
      container!.getDatabase(),
      "-c",
      sql,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`psql failed (${result.exitCode}): ${result.output}`);
    }
  };
  await psql(
    `update users set display_name = 'Ada' where user_id = '${userApp}'`,
  );
  await psql(
    `update users set display_name = 'Grace' where user_id = '${userMate}'`,
  );

  const sim = pickSimulator();
  simBootedByUs = bootSimulator(sim);
  simUdid = sim.udid;
  writePidfile(); // again, now that the simulator fact exists

  console.log(
    `launching the app on ${sim.name} against game ${game.gameId}...`,
  );
  launchApp(
    sim.udid,
    appPath,
    {
      apiUrl: API_URL,
      wsBase: SESSION_WS_BASE,
      gameId: game.gameId,
      token: tokenApp,
    },
    ["-roomScript"],
  );
  appLaunched = true;

  console.log("connecting the scripted teammate (Grace) over the real wire...");
  scripted = new ScriptedClient();
  await scripted.connect(
    `${SESSION_WS_BASE}/games/${game.gameId}/ws`,
    tokenMate,
  );

  // Server-to-app: Grace writes her word and parks her cursor. The app's
  // -roomScript path types only after BOTH are visible in its store, so the app's
  // letters below double as the acknowledgment that these arrived and rendered.
  console.log("Grace places letters and a cursor...");
  const mateCommands = new Set(
    TEAMMATE_LETTERS.map(([cell, value]) => scripted!.placeLetter(cell, value)),
  );
  scripted.send({
    type: "moveCursor",
    cell: TEAMMATE_CURSOR_CELL,
    direction: "across",
  });
  for (const [cell, value] of TEAMMATE_LETTERS) {
    await scripted.waitFor(
      (f) =>
        f.type === "cellSet" &&
        f["cell"] === cell &&
        f["value"] === value &&
        mateCommands.has(f["commandId"] as string),
      `Grace's own echo for cell ${cell}`,
      15_000,
    );
  }

  // App-to-server: the app's scripted word, attributed to the app's identity, plus
  // at least one cursor frame from its per-keystroke relay (PROTOCOL.md §9).
  console.log("waiting for the app's typed word to land at Grace...");
  for (const [cell, value] of APP_WORD) {
    await scripted.waitFor(
      (f) =>
        f.type === "cellSet" &&
        f["cell"] === cell &&
        f["value"] === value &&
        f["by"] === userApp,
      `the app's "${value}" at cell ${cell}`,
      120_000, // cold app launch, REST fetch, handshake, then the render-gated wait
    );
  }
  await scripted.waitFor(
    (f) => f.type === "cursor" && f["userId"] === userApp,
    "the app's cursor relay",
    15_000,
  );
  console.log(
    "two-sided proof on the wire: app rendered Grace's word+cursor (typing was",
    "gated on it) and Grace observed the app's word and cursor.",
  );

  // Evidence: the live room with both words and Grace's presence. The wire ack
  // above is the gate; a short settle lets the last flash/animation finish.
  await delay(1_500);
  screenshot(sim.udid, "01-live-room.png");

  // Optional weather evidence: drop the session (SIGTERM, so the accepted tail
  // flushes, INV-5) and catch the dimmed room with the quiet countdown, then
  // restart on the same port and prove the app redials and the board rehydrated.
  console.log("dropping the session service for the reconnecting weather...");
  const sessionEnv = {
    DATABASE_URL: dbUrl,
    SUPABASE_ISSUER: ISSUER,
    PORT: String(SESSION_PORT),
    HOST: "127.0.0.1",
  };
  await killChild(session, "SIGTERM");
  await delay(3_000); // a few failed dials in, the backoff walk shows "Back in Ns"
  screenshot(sim.udid, "02-reconnecting.png");

  console.log("restarting the session service on the same port...");
  session = spawnService("session", sessionEntry, sessionEnv);
  writePidfile();
  await waitForHttp(`http://127.0.0.1:${SESSION_PORT}/`);

  // Grace's socket died with the session; a fresh client proves the rehydrated
  // board and watches for the app's redial (its playerConnected, unless the app
  // beat this connect, in which case the welcome already lists it connected).
  scripted.close();
  scripted = new ScriptedClient();
  const welcome = (await scripted.connect(
    `${SESSION_WS_BASE}/games/${game.gameId}/ws`,
    tokenMate,
  )) as {
    board?: {
      cells?: Array<{ v: string | null; by: string | null }>;
      participants?: Array<{ userId: string; connected: boolean }>;
    };
  };
  const cells = welcome.board?.cells ?? [];
  for (const [cell, value] of [...TEAMMATE_LETTERS, ...APP_WORD]) {
    if (cells[cell]?.v !== value) {
      throw new Error(
        `rehydrated board lost cell ${cell}: expected "${value}", got ${JSON.stringify(cells[cell])}`,
      );
    }
  }
  const appConnectedInWelcome = (welcome.board?.participants ?? []).some(
    (p) => p.userId === userApp && p.connected,
  );
  if (!appConnectedInWelcome) {
    await scripted.waitFor(
      (f) => f.type === "playerConnected" && f["userId"] === userApp,
      "the app's reconnect (playerConnected)",
      30_000,
    );
  }
  console.log("the app redialed and the board survived the restart (INV-5).");
  await delay(1_500); // let the app's welcome land and the dim lift
  screenshot(sim.udid, "03-reconnected.png");

  await teardown();
  console.log("room proof green.");
  process.exit(0);
}

main().catch(async (err: unknown) => {
  console.error("room proof failed:", err);
  await teardown();
  process.exit(1);
});
