// The M1 smoke harness: it stands up the real two-service shape for the Playwright test.
//
// - Testcontainers Postgres, migrated by a tsx child (so nothing here imports the
//   workspace's TypeScript sources, which Playwright's transform would not transpile).
// - A JWKS HTTP server plus jose token minting, so the real services verify real ES256
//   tokens exactly as they would against Supabase (SP2), with zero vendor network.
// - The API and the session service each spawned as a REAL child process via tsx (apps
//   never import apps; this orchestrates processes, not imports).
// - A tiny static server for the built web client (apps/web/dist).
//
// It also creates a game through the API (the M1 script) and can restart the session
// service, which the second smoke scenario uses to prove rehydrate-on-restart.

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../..");
const tsxBin = join(repoRoot, "node_modules/.bin/tsx");
export const apiEntry = join(repoRoot, "apps/api/src/server.ts");
export const sessionEntry = join(repoRoot, "apps/session/src/main.ts");
const migrateScript = join(here, "..", "scripts", "migrate.ts");
const webDist = join(repoRoot, "apps/web/dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

/** An OS-assigned free TCP port on the loopback interface. */
function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createNetServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

/** Poll until a URL answers with any non-5xx status, or throw after the timeout. */
export async function waitForHttp(
  url: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "connection refused";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = String(err);
    }
    await delay(150);
  }
  throw new Error(`timed out waiting for ${url} (${lastError})`);
}

/** ES256 token minting plus the matching JWKS, mirroring the Supabase token shape (SP2). */
export async function makeAuth(issuer: string): Promise<{
  jwks: { keys: unknown[] };
  mint: (sub: string, isAnonymous?: boolean) => Promise<string>;
}> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const kid = randomUUID();
  const jwk = await exportJWK(publicKey);
  const jwks = {
    keys: [{ ...jwk, kid, alg: "ES256", use: "sig", key_ops: ["verify"] }],
  };
  const mint = (sub: string, isAnonymous = false): Promise<string> => {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({ role: "authenticated", is_anonymous: isAnonymous })
      .setProtectedHeader({ alg: "ES256", kid })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 3600)
      .sign(privateKey);
  };
  return { jwks, mint };
}

function listen(server: Server, port: number): Promise<Server> {
  return new Promise((resolveServer) => {
    server.listen(port, "127.0.0.1", () => resolveServer(server));
  });
}

/** A minimal static file server for the built SPA, with an index.html fallback. */
function staticServer(distDir: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === "/") pathname = "/index.html";
        let filePath = join(distDir, pathname);
        if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
          filePath = join(distDir, "index.html");
        }
        const body = await readFile(filePath);
        res.writeHead(200, {
          "content-type":
            CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    })();
  });
  return listen(server, port);
}

/** Serve the JWKS on every path; the service fetches the well-known URL under this issuer. */
export function jwksServer(jwks: unknown, port: number): Promise<Server> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(jwks));
  });
  return listen(server, port);
}

/** Spawn a workspace service entrypoint under tsx as a real child process. */
export function spawnService(
  name: string,
  entrypoint: string,
  env: Record<string, string>,
): ChildProcess {
  const child = spawn(tsxBin, [entrypoint], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group (pgid === child.pid). tsx spawns a node grandchild that actually
    // holds the port, so a plain child.kill would orphan it; killChild signals the group.
    detached: true,
  });
  child.stdout?.on("data", (d: Buffer) =>
    process.stdout.write(`[${name}] ${d}`),
  );
  child.stderr?.on("data", (d: Buffer) =>
    process.stderr.write(`[${name}] ${d}`),
  );
  return child;
}

/** Apply the committed migrations via a tsx child (keeps workspace TS out of this process). */
export function runMigrations(dbUrl: string): Promise<void> {
  return new Promise((resolveDone, reject) => {
    const child = spawn(tsxBin, [migrateScript, dbUrl], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stdout?.on("data", (d: Buffer) =>
      process.stdout.write(`[migrate] ${d}`),
    );
    child.stderr?.on("data", (d: Buffer) => {
      err += String(d);
      process.stderr.write(`[migrate] ${d}`);
    });
    child.on("exit", (code) =>
      code === 0
        ? resolveDone()
        : reject(new Error(`migrate exited ${code}: ${err}`)),
    );
  });
}

/**
 * Signal a whole process group. `pid` is the group leader's pid (children spawned detached
 * lead their own group), so this reaps the grandchildren tsx and vite fork. Falls back to
 * signaling just the pid, and swallows ESRCH so a dead target is a no-op.
 */
export function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

export function killChild(
  child: ChildProcess | null,
  signal: NodeJS.Signals,
): Promise<void> {
  return new Promise((resolveDone) => {
    if (
      child === null ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      resolveDone();
      return;
    }
    child.once("exit", () => resolveDone());
    if (child.pid !== undefined) killGroup(child.pid, signal);
  });
}

export interface CreatedGame {
  gameId: string;
  hostToken: string;
  bToken: string;
}

export class SmokeHarness {
  private container: StartedPostgreSqlContainer | null = null;
  private dbUrl = "";
  private issuer = "";
  private apiPort = 0;
  private sessionPort = 0;
  private jwksPort = 0;
  private webPort = 0;
  private jwks: Server | null = null;
  private web: Server | null = null;
  private api: ChildProcess | null = null;
  private session: ChildProcess | null = null;
  private sessionEnv: Record<string, string> = {};
  private mint: (sub: string, isAnonymous?: boolean) => Promise<string> = () =>
    Promise.reject(new Error("harness not started"));

  get apiUrl(): string {
    return `http://127.0.0.1:${this.apiPort}`;
  }
  get webUrl(): string {
    return `http://127.0.0.1:${this.webPort}`;
  }
  get sessionWsBase(): string {
    return `ws://127.0.0.1:${this.sessionPort}`;
  }

  async start(): Promise<void> {
    if (!existsSync(webDist)) {
      throw new Error(
        `web build not found at ${webDist}; run \`pnpm --filter @crossy/web build\` first (pnpm smoke does this).`,
      );
    }
    this.container = await new PostgreSqlContainer(
      "postgres:16-alpine",
    ).start();
    this.dbUrl = this.container.getConnectionUri();
    await runMigrations(this.dbUrl);

    this.apiPort = await getFreePort();
    this.sessionPort = await getFreePort();
    this.jwksPort = await getFreePort();
    this.webPort = await getFreePort();
    this.issuer = `http://127.0.0.1:${this.jwksPort}/auth/v1`;

    const auth = await makeAuth(this.issuer);
    this.mint = auth.mint;
    this.jwks = await jwksServer(auth.jwks, this.jwksPort);
    this.web = await staticServer(webDist, this.webPort);

    this.sessionEnv = {
      DATABASE_URL: this.dbUrl,
      SUPABASE_ISSUER: this.issuer,
      PORT: String(this.sessionPort),
      HOST: "127.0.0.1",
    };
    this.session = spawnService("session", sessionEntry, this.sessionEnv);
    this.api = spawnService("api", apiEntry, {
      DATABASE_URL: this.dbUrl,
      SUPABASE_ISSUER: this.issuer,
      SESSION_WS_BASE: this.sessionWsBase,
      CORS_ORIGIN: this.webUrl,
      PORT: String(this.apiPort),
    });

    await waitForHttp(`http://127.0.0.1:${this.sessionPort}/`);
    await waitForHttp(`${this.apiUrl}/health`);
  }

  /** Create a game through the REST API: host (full account) plus a joined second player. */
  async createGame(): Promise<CreatedGame> {
    const hostToken = await this.mint(randomUUID(), false);
    const bToken = await this.mint(randomUUID(), false);
    // XWord Info document shape (G1 ingestion ACL): the grid carries the solution letters
    // ("ABCDE" per row), numbering derives from geometry (across 1/6/7/8/9, down 1-5).
    const puzzle = {
      size: { rows: 5, cols: 5 },
      grid: Array.from({ length: 25 }, (_, i) => "ABCDE"[i % 5]),
      clues: {
        across: ["1. row 1", "6. row 2", "7. row 3", "8. row 4", "9. row 5"],
        down: ["1. col 1", "2. col 2", "3. col 3", "4. col 4", "5. col 5"],
      },
    };
    const p = (await this.postJson("/puzzles", hostToken, puzzle)) as {
      puzzleId: string;
    };
    const g = (await this.postJson("/games", hostToken, {
      puzzleId: p.puzzleId,
    })) as { gameId: string; inviteCode: string };
    await this.postJson(`/games/${g.gameId}/join`, bToken, {
      code: g.inviteCode,
    });
    return { gameId: g.gameId, hostToken, bToken };
  }

  /** Graceful restart of the session service on the SAME port: SIGTERM (drain), then respawn. */
  async restartSession(): Promise<void> {
    await killChild(this.session, "SIGTERM");
    this.session = spawnService("session", sessionEntry, this.sessionEnv);
    await waitForHttp(`http://127.0.0.1:${this.sessionPort}/`);
  }

  async stop(): Promise<void> {
    await killChild(this.session, "SIGKILL");
    await killChild(this.api, "SIGKILL");
    await new Promise<void>((r) =>
      this.jwks ? this.jwks.close(() => r()) : r(),
    );
    await new Promise<void>((r) =>
      this.web ? this.web.close(() => r()) : r(),
    );
    await this.container?.stop();
  }

  private async postJson(
    path: string,
    token: string,
    body: unknown,
  ): Promise<unknown> {
    const res = await fetch(`${this.apiUrl}${path}`, {
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
}
