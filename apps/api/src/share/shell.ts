// The share page shell (design/post-game/SHARE.md wave S3; PROTOCOL.md §12 `GET /s/{token}`): the
// OpenGraph tags the unfurlers read, and the human page whose hero is the replay loop. The mosaic
// draws itself in solve order, each square washing in with its owner's roster tint (or the solo gold
// ramp), holds on the finished board, dissolves, and loops.
//
// The whole loop is CSS; the page carries ZERO script and fetches nothing (it renders offline-cached).
// The board is the same `@crossy/share-card` mosaic the card PNG rasterizes (completionBoardSvg), so
// the animated hero and the unfurl image agree visually: same idiom, same OWNER_TINT wash, same solo
// ramp, both brand grounds. The animation lives ONLY inside a `prefers-reduced-motion: no-preference`
// media block: a reduced-motion viewer gets the finished static mosaic, full stop, because the SVG's
// static state IS the finished board and the keyframes only ever modulate per-cell opacity over it.
//
// The loop (the motion contract, recorded in SHARE.md S3):
//   lead 0.8s   the blank grid gets a beat before the first square lands;
//   reveal 11.6s the solve replays: REAL relative timing, linearly compressed, with any single
//               stall clamped at STALL_CAP_SECONDS of active time so one long stare cannot flatten
//               the rest into a blur — bursts read as bursts, stalls read as beats;
//   hold 3.0s   the finished mosaic gets its moment;
//   fade 0.6s   the board breathes out to blank, and the loop restarts.
// Every cell shares one LOOP_SECONDS period with zero animation-delay (the reveal moment lives in
// each cell's own keyframes), so the wrap clears the whole board in a single beat and the loop can
// never drift out of phase.
//
// INV-6 by construction: the inputs are the assembly's card data (owners, counts, display metadata)
// and the bundle's sequence (cells + active seconds). No letter-shaped field exists, and the board
// SVG emits no text nodes at all, so nothing on this page can spoil the puzzle.
import {
  BRAND,
  completionBoardSvg,
  escapeXml,
  type ShareCardData,
} from "@crossy/share-card";
import type { ShareAssembly } from "./cardData";
import { OG_HEIGHT, OG_WIDTH } from "./render";

/** One full replay loop, seconds. The segments below partition it exactly (shell.test.ts pins the
 * sum), so the keyframe percentages are derived, never hand-tuned twice. */
export const LOOP_SECONDS = 16;
/** The blank grid's beat before the first square lands. */
export const LEAD_SECONDS = 0.8;
/** The reveal window the whole solve compresses into. */
export const REVEAL_SECONDS = 11.6;
/** The finished mosaic's moment before the loop breathes out. */
export const HOLD_SECONDS = 3;
/** The dissolve back to the blank grid at the loop's wrap. */
export const FADE_SECONDS = 0.6;
/** One square's wash-in, an ease-out settle. */
export const WASH_SECONDS = 0.5;
/** A single inter-fill stall is clamped at this many ACTIVE seconds before the linear compression,
 * so one long stare reads as the maximum beat instead of eating the reveal window. Sittings and idle
 * gaps are already collapsed to active seconds upstream (D29); this only tempers within-sitting
 * stalls. */
export const STALL_CAP_SECONDS = 90;

/** The wash's settle: fast in, gentle landing (an ease-out cubic-bezier). */
const WASH_EASE = "cubic-bezier(0.22,0.61,0.36,1)";

/**
 * Map the bundle's sequence onto the loop: each step's reveal delay in seconds from loop start,
 * same order and length as `sequence`. Real relative timing, linearly compressed: gaps are clamped
 * at STALL_CAP_SECONDS (and floored at 0 defensively), the clamped span is scaled onto
 * REVEAL_SECONDS, and everything shifts by LEAD_SECONDS. A single-step (or zero-span) sequence
 * lands wholly at LEAD_SECONDS. Monotone nondecreasing by construction.
 */
export function revealDelays(
  sequence: readonly { cell: number; atSeconds: number }[],
): number[] {
  if (sequence.length === 0) return [];
  const clamped: number[] = [0];
  for (let i = 1; i < sequence.length; i += 1) {
    const gap = sequence[i]!.atSeconds - sequence[i - 1]!.atSeconds;
    clamped.push(
      clamped[i - 1]! + Math.min(Math.max(gap, 0), STALL_CAP_SECONDS),
    );
  }
  const span = clamped[clamped.length - 1]!;
  return clamped.map(
    (u) => LEAD_SECONDS + (span > 0 ? (u / span) * REVEAL_SECONDS : 0),
  );
}

/** Cells sharing one reveal moment (delays quantized to 0.01% of the loop, 1.6ms: a burst's
 * same-instant fills share one keyframes block, so the emitted CSS stays small). Ascending by
 * startPct, named k0, k1, ... in that order. */
export interface RevealGroup {
  readonly name: string;
  /** The reveal moment as a percentage of LOOP_SECONDS, rounded to 2 decimals. */
  readonly startPct: number;
  readonly cells: readonly number[];
}

export function revealGroups(
  sequence: readonly { cell: number; atSeconds: number }[],
): RevealGroup[] {
  const delays = revealDelays(sequence);
  const byPct = new Map<number, number[]>();
  delays.forEach((delay, i) => {
    const pct = Math.round((delay / LOOP_SECONDS) * 10000) / 100;
    const cells = byPct.get(pct);
    if (cells === undefined) byPct.set(pct, [sequence[i]!.cell]);
    else cells.push(sequence[i]!.cell);
  });
  // Delays ascend, so Map insertion order IS ascending startPct.
  return [...byPct.entries()].map(([startPct, cells], k) => ({
    name: `k${k}`,
    startPct,
    cells,
  }));
}

function pct(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * The replay stylesheet: the ENTIRE animation, inside one
 * `@media (prefers-reduced-motion: no-preference)` block (reduced-motion viewers get the static
 * finished mosaic with zero motion). Every cell: one shared LOOP_SECONDS infinite animation, zero
 * delay; its own keyframes hold it invisible until its reveal moment, wash it in over WASH_SECONDS
 * with an ease-out settle, hold it through the finished board's moment, and dissolve it (all cells
 * together) over the closing FADE_SECONDS. Empty when there is nothing to replay.
 */
export function replayCss(groups: readonly RevealGroup[]): string {
  if (groups.length === 0) return "";
  const washPct = (WASH_SECONDS / LOOP_SECONDS) * 100;
  const fadeStartPct = pct(
    ((LOOP_SECONDS - FADE_SECONDS) / LOOP_SECONDS) * 100,
  );
  const rules: string[] = [
    `.rv{animation:${LOOP_SECONDS}s linear infinite both}`,
  ];
  for (const g of groups) rules.push(`.${g.name}{animation-name:${g.name}}`);
  for (const g of groups) {
    rules.push(
      `@keyframes ${g.name}{` +
        `0%,${pct(g.startPct)}%{opacity:0;animation-timing-function:${WASH_EASE}}` +
        `${pct(g.startPct + washPct)}%{opacity:1}` +
        `${fadeStartPct}%{opacity:1;animation-timing-function:ease-in}` +
        `100%{opacity:0}}`,
    );
  }
  return (
    `@media (prefers-reduced-motion: no-preference){\n` +
    rules.join("\n") +
    `\n}`
  );
}

/** The two ground boards, classes stamped for the replay: `rv` plus the cell's reveal group. The
 * static fills are the FINISHED mosaic (owners wash, or the solo gold ramp when the assembly says
 * solo), so with no animation (reduced motion, or nothing to replay) the hero is never empty: it is
 * the completed board. */
function boards(assembly: ShareAssembly): { light: string; dark: string } {
  const classByCell = new Map<number, string>();
  for (const g of revealGroups(assembly.sequence)) {
    for (const cell of g.cells) classByCell.set(cell, `rv ${g.name}`);
  }
  const options = {
    painting: assembly.solo ? ("fillOrder" as const) : ("owners" as const),
    cellClassOf: (cell: number) => classByCell.get(cell),
  };
  const data: ShareCardData = assembly.card;
  return {
    light: completionBoardSvg(data, { ...options, ground: "light" }).svg,
    dark: completionBoardSvg(data, { ...options, ground: "dark" }).svg,
  };
}

/**
 * The share page: OpenGraph tags for unfurlers (unchanged from S2: og:image stays the card PNG,
 * unfurlers run no CSS), and the replay hero for a human. `title` is display content shown back
 * verbatim, so it is XML-escaped; `cardUrl` and `appOrigin` are config- and DB-derived, never raw
 * caller input. No script, no external resource: everything inlines.
 */
export function shareShell(args: {
  title: string;
  cardUrl: string;
  appOrigin: string;
  assembly: ShareAssembly;
}): string {
  const title = escapeXml(args.title);
  const cardUrl = escapeXml(args.cardUrl);
  const appOrigin = escapeXml(args.appOrigin);
  const { light, dark } = boards(args.assembly);
  const animation = replayCss(revealGroups(args.assembly.sequence));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Crossy">
<meta property="og:title" content="${title}">
<meta property="og:description" content="A finished crossword on Crossy.">
<meta property="og:image" content="${cardUrl}">
<meta property="og:image:width" content="${OG_WIDTH}">
<meta property="og:image:height" content="${OG_HEIGHT}">
<meta name="twitter:card" content="summary_large_image">
<title>${title} · Crossy</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;background:${BRAND.studio};color:${BRAND.ink};font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:600px;margin:0 auto;padding:48px 24px 56px}
.board{max-width:520px;margin:0 auto}
.board svg{display:block;width:100%;height:auto}
.g-dark{display:none}
h1{margin:28px 0 2px;font-size:22px;font-weight:600;text-align:center}
main p{margin:6px 0 0;text-align:center;opacity:.65}
a{color:inherit}
@media (prefers-color-scheme: dark){
body{background:${BRAND.observatory};color:${BRAND.bone}}
.g-light{display:none}
.g-dark{display:block}
}
${animation}
</style>
</head>
<body>
<main>
<div class="board" role="img" aria-label="${title}: the finished grid, replayed square by square">
<div class="g-light">${light}</div>
<div class="g-dark">${dark}</div>
</div>
<h1>${title}</h1>
<p><a href="${appOrigin}">Open Crossy</a></p>
</main>
</body>
</html>
`;
}
