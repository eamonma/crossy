// Untracked overnight evidence stack (session 6b00bc71): the REAL local stack for the
// goo-on-live-data proof. Boots Testcontainers Postgres + migrations + jose auth/JWKS
// + the real session and api services FROM THIS WORKTREE (the #159 api: rows carry the
// member stack), seeds one game with a host, a full-account solver, and a guest
// spectator, prints the connection facts, and stays alive until killed. Modeled on
// apps/ios/scripts/integration.ts; never committed.

import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import {
  apiEntry,
  jwksServer,
  makeAuth,
  runMigrations,
  sessionEntry,
  spawnService,
  waitForHttp,
} from "../src/harness";

const API_PORT = 8890;
const SESSION_PORT = 8891;
const JWKS_PORT = 8892;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const SESSION_WS_BASE = `ws://127.0.0.1:${SESSION_PORT}`;
const ISSUER = `http://127.0.0.1:${JWKS_PORT}/auth/v1`;

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

async function postJson(
  path: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main(): Promise<void> {
  console.log("booting postgres + migrations...");
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const dbUrl = container.getConnectionUri();
  await runMigrations(dbUrl);

  const auth = await makeAuth(ISSUER);
  await jwksServer(auth.jwks, JWKS_PORT);

  console.log("starting session + api (this worktree's code, #159 members)...");
  // 0.0.0.0 so a phone on the LAN can reach both services (the api already binds all
  // interfaces). The JWKS stays loopback: only the Mac-side services fetch it.
  spawnService("session", sessionEntry, {
    DATABASE_URL: dbUrl,
    SUPABASE_ISSUER: ISSUER,
    PORT: String(SESSION_PORT),
    HOST: "0.0.0.0",
  });
  spawnService("api", apiEntry, {
    DATABASE_URL: dbUrl,
    SUPABASE_ISSUER: ISSUER,
    SESSION_WS_BASE,
    PORT: String(API_PORT),
  });
  await waitForHttp(`http://127.0.0.1:${SESSION_PORT}/`);
  await waitForHttp(`${API_URL}/health`);

  console.log("seeding: host A, solver B, guest-spectator C...");
  const tokenA = await auth.mint(randomUUID(), false);
  const tokenB = await auth.mint(randomUUID(), false);
  const tokenC = await auth.mint(randomUUID(), true);
  const puzzle = (await postJson("/puzzles", tokenA, PUZZLE)) as {
    puzzleId: string;
  };
  const game = (await postJson("/games", tokenA, {
    puzzleId: puzzle.puzzleId,
    name: "Goo, live",
  })) as { gameId: string; inviteCode: string };
  await postJson(`/games/${game.gameId}/join`, tokenB, {
    code: game.inviteCode,
  });
  await postJson(`/games/${game.gameId}/join`, tokenC, {
    code: game.inviteCode,
  });

  // Sanity: the list rows must carry the member stack (the #159 api).
  const listRes = await fetch(`${API_URL}/games`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  const list = (await listRes.json()) as {
    games: Array<{ members?: unknown[]; inviteCode?: string }>;
  };
  const row = list.games[0];
  console.log(
    `LIST_CHECK members=${row?.members?.length ?? "ABSENT"} inviteCode=${row?.inviteCode ? "present" : "ABSENT"}`,
  );

  console.log(`GAME_ID=${game.gameId}`);
  console.log(`TOKEN_A=${tokenA}`);
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  if (lan) {
    console.log(
      `PHONE_ARGS=-CROSSY_IT_TOKEN ${tokenA} -CROSSY_IT_API_URL http://${lan}:${API_PORT} -CROSSY_IT_WS_BASE ws://${lan}:${SESSION_PORT}`,
    );
  }
  console.log("STACK_READY");
  await new Promise(() => undefined);
}

main().catch((err: unknown) => {
  console.error("stack failed:", err);
  process.exit(1);
});
