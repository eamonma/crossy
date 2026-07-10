// The M1 proof (DESIGN.md §13 M1 exit; ROADMAP Wave 2.2). Real API + real session
// service + Testcontainers Postgres + two real Chromium pages on the BUILT web client.
//
// Scenario 1: a game is created through the API, both browsers join over real sockets,
// browser A types letters mid-word that appear in browser B, A's socket is killed, A
// reconnects, and both boards converge including the mid-word letters.
//
// Scenario 2: the SESSION SERVICE is restarted mid-word (SIGTERM drains the tail to
// Postgres); both clients reconnect and converge from the rehydrated snapshot.
//
// The browsers read convergence through the store hook LiveApp exposes on window.

import { chromium, expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { SmokeHarness } from "./harness";
import type { CreatedGame } from "./harness";

interface CrossyStore {
  readonly sync: string;
  readonly seq: number;
  readonly status: string;
  renderValue(cell: number): string | null;
}

declare global {
  interface Window {
    __crossy?: { store: CrossyStore; drop: () => void };
  }
}

let harness: SmokeHarness;
let browser: Browser;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  harness = new SmokeHarness();
  await harness.start();
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await harness?.stop();
});

/** Open the built web client in live mode (the path route) and wait until its store is live. */
async function openGame(
  page: Page,
  game: CreatedGame,
  token: string,
): Promise<void> {
  const url =
    `${harness.webUrl}/game/${game.gameId}` +
    `?api=${encodeURIComponent(harness.apiUrl)}` +
    `&token=${encodeURIComponent(token)}`;
  await page.goto(url);
  await page.waitForFunction(
    () => window.__crossy?.store.sync === "live",
    null,
    {
      timeout: 30_000,
    },
  );
}

/** Open the client through the LEGACY query-string URL (`/?game=<id>&...`): old invite links
 * are in the wild, and the router must redirect once to the path form, preserving overrides. */
async function openGameLegacy(
  page: Page,
  game: CreatedGame,
  token: string,
): Promise<void> {
  const url =
    `${harness.webUrl}/?api=${encodeURIComponent(harness.apiUrl)}` +
    `&game=${game.gameId}&token=${encodeURIComponent(token)}`;
  await page.goto(url);
  await page.waitForFunction(
    () => window.__crossy?.store.sync === "live",
    null,
    {
      timeout: 30_000,
    },
  );
}

/** The rendered value (sequenced plus overlay, INV-10) of cells 0..n-1 in one page. */
function readBoard(page: Page, n: number): Promise<(string | null)[]> {
  return page.evaluate((count) => {
    const store = window.__crossy?.store;
    if (store === undefined) return [];
    return Array.from({ length: count }, (_, i) => store.renderValue(i));
  }, n);
}

async function typeInto(page: Page, text: string): Promise<void> {
  await page.locator("[data-testid=grid]").focus();
  await page.keyboard.type(text, { delay: 40 });
}

function waitLive(page: Page, timeout = 60_000): Promise<unknown> {
  return page.waitForFunction(
    () => window.__crossy?.store.sync === "live",
    null,
    { timeout },
  );
}

test("two browsers converge after one socket is killed mid-word (M1 exit)", async () => {
  const game = await harness.createGame();
  const a = await browser.newPage();
  const b = await browser.newPage();
  // A enters through an old-style query URL to prove the back-compat redirect end to end;
  // B uses the canonical path route.
  await openGameLegacy(a, game, game.hostToken);
  await openGame(b, game, game.bToken);

  // The legacy URL canonicalized to the path form, keeping the api/token overrides.
  const aUrl = new URL(a.url());
  expect(aUrl.pathname).toBe(`/game/${game.gameId}`);
  expect(aUrl.searchParams.get("api")).toBe(harness.apiUrl);
  expect(aUrl.searchParams.get("token")).toBe(game.hostToken);
  expect(aUrl.searchParams.get("game")).toBeNull();

  // A types a mid-word partial (3 of the 5-cell first word); it appears in B.
  await typeInto(a, "HEL");
  await expect.poll(() => readBoard(b, 3)).toEqual(["H", "E", "L"]);

  // Kill A's socket mid-word; the transport reconnects and resyncs on its own.
  await a.evaluate(() => window.__crossy?.drop());
  await waitLive(a, 30_000);

  // Both boards converge, including the mid-word letters.
  await expect.poll(() => readBoard(a, 3)).toEqual(["H", "E", "L"]);
  await expect.poll(() => readBoard(b, 3)).toEqual(["H", "E", "L"]);

  // Liveness after reconnect: A finishes the word, B sees it.
  await typeInto(a, "LO");
  await expect.poll(() => readBoard(b, 5)).toEqual(["H", "E", "L", "L", "O"]);

  await a.close();
  await b.close();
});

test("two browsers converge after the session service restarts mid-word (rehydrate)", async () => {
  const game = await harness.createGame();
  const a = await browser.newPage();
  const b = await browser.newPage();
  await openGame(a, game, game.hostToken);
  await openGame(b, game, game.bToken);

  await typeInto(a, "CAT");
  await expect.poll(() => readBoard(b, 3)).toEqual(["C", "A", "T"]);

  // Graceful restart: SIGTERM drains the accepted tail to Postgres, the respawn rehydrates.
  await harness.restartSession();

  // Both sockets dropped when the server exited; they reconnect and reconcile on their own.
  await waitLive(a);
  await waitLive(b);

  // Converge from the rehydrated snapshot, losing nothing that was accepted.
  await expect
    .poll(() => readBoard(a, 3), { timeout: 30_000 })
    .toEqual(["C", "A", "T"]);
  await expect
    .poll(() => readBoard(b, 3), { timeout: 30_000 })
    .toEqual(["C", "A", "T"]);

  await a.close();
  await b.close();
});
