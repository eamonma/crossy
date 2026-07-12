// The room hydrates without moving (owner repro, 2026-07-12): B is already in the room
// with fill on the board and a live cursor; A then arrives cold. Nothing may shift as A's
// client walks skeleton -> REST-hydrated -> first welcome: the toolbar row holds its
// height when the avatar stack populates (avatar.tsx rem-literal sizes vs the theme's
// Radix spacing steps), and the SolvingNow block swaps into its membership-sized
// placeholder instead of shoving the clue lists down (rail) or the axes sideways (the
// ultra dock's 20rem column). The Layout Instability API observes the whole arrival;
// any layout-shift entry above noise fails.

import { chromium, expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { SmokeHarness } from "./harness";
import type { CreatedGame } from "./harness";

interface ShiftEntry {
  t: number;
  value: number;
  hadRecentInput: boolean;
  sources: { node: string | null; prev: string; curr: string }[];
}

// smoke.spec.ts already augments Window.__crossy globally with its own local interface;
// a second augmentation here would collide (TS2717), so these hooks are read via casts.
type HookedWindow = Window & {
  __crossy?: { store: { sync: string } };
  __shifts?: ShiftEntry[];
};

let harness: SmokeHarness;
let browser: Browser;

test.beforeAll(async () => {
  harness = new SmokeHarness();
  await harness.start();
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  await harness?.stop();
});

function gameUrl(game: CreatedGame, token: string): string {
  return (
    `${harness.webUrl}/game/${game.gameId}` +
    `?api=${encodeURIComponent(harness.apiUrl)}` +
    `&token=${encodeURIComponent(token)}`
  );
}

function waitLive(page: Page): Promise<unknown> {
  return page.waitForFunction(
    () => (window as HookedWindow).__crossy?.store.sync === "live",
    null,
    { timeout: 30_000 },
  );
}

/** Buffered layout-shift observer, installed before any document script runs. */
const OBSERVER = `
  window.__shifts = [];
  const rect = (r) => (r ? Math.round(r.x) + "," + Math.round(r.y) + " " + Math.round(r.width) + "x" + Math.round(r.height) : "none");
  const name = (n) => {
    if (!n) return null;
    if (n.nodeType === 3) return "#text(" + (n.textContent || "").slice(0, 40) + ")";
    const cls = typeof n.className === "string" ? n.className : "";
    return n.tagName + "." + cls.split(" ").slice(0, 6).join(".");
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__shifts.push({
        t: Math.round(e.startTime),
        value: e.value,
        hadRecentInput: e.hadRecentInput,
        sources: (e.sources || []).map((s) => ({
          node: name(s.node),
          prev: rect(s.previousRect),
          curr: rect(s.currentRect),
        })),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
`;

/** Open A's browser cold at the given viewport and collect every shift through settle. */
async function arrivalShifts(
  game: CreatedGame,
  width: number,
  height: number,
): Promise<ShiftEntry[]> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript(OBSERVER);
  await page.goto(gameUrl(game, game.hostToken));
  await waitLive(page);
  // Let fonts, post-welcome paints, and any straggling reflow settle before reading.
  await page.waitForTimeout(1500);
  const shifts = await page.evaluate(
    () => (window as HookedWindow).__shifts ?? [],
  );
  await page.close();
  return shifts.filter((s) => !s.hadRecentInput);
}

test("a member's arrival hydrates the room without layout shift (rail and ultra dock)", async () => {
  test.setTimeout(240_000);
  const game = await harness.createGame();

  // B settles in first as a solver: connected, three letters down, a live cursor. This is
  // the state whose late arrival used to nudge A's whole room (toolbar +8px) and shove the
  // clue lists (SolvingNow mounting with no placeholder).
  const upgrade = await fetch(`${harness.apiUrl}/games/${game.gameId}/role`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${game.bToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "solver" }),
  });
  expect(upgrade.ok).toBe(true);
  const b = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await b.goto(gameUrl(game, game.bToken));
  await waitLive(b);
  await b.locator("[data-testid=grid]").focus();
  await b.keyboard.type("HEL", { delay: 40 });

  // The rail regime (md and wide) and the ultra dock regime each hold still.
  for (const [width, height] of [
    [1440, 900],
    [2400, 1200],
  ] as const) {
    const shifts = (await arrivalShifts(game, width, height)).filter(
      (s) => s.value > 0.005,
    );
    expect(
      shifts,
      `layout shifted during arrival at ${width}x${height}: ` +
        JSON.stringify(shifts, null, 2),
    ).toEqual([]);
  }

  await b.close();
});
