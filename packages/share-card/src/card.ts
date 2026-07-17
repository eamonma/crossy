// The completion share card, three variants over one visual system (SHARE.md; the
// ratified mosaic-card mock is the visual spec):
//
//   portrait (1080x1620)  the flagship: lockup header, puzzle title + byline, the
//                         owners mosaic, the stats strip, the film-credits block.
//   og (1200x630)         grid left, text right, credits compressed to titles only.
//   solo                  portrait geometry, mosaic painted by fill order (the gold
//                         ramp), a first/last ramp key instead of credits.
//
// Rendering rules this file pins:
//   - No text measurement exists here, so every run is anchored (start/middle/end),
//     flowed through tspans on one line, or truncated against the grapheme budgets in
//     BUDGETS below.
//   - The board is the og.svg idiom: square cells, no rounded corners, gridlines and
//     frame in the board chrome tones. Open cells carry OWNER_TINT of the owner's
//     roster hex over the card face; blocks are ink on light and near-black on dark.
//   - Gold appears only where the brand puts it: the mark's Y cell and the solo ramp.
//     Never in text or chrome.
import type {
  RenderedCard,
  ShareCardData,
  ShareCardOptions,
  ShareCardSolver,
} from "./types";
import { BRAND, lockupSvg } from "./brand";
import { boardStrokes, boardSvg } from "./board";
import { mixHex } from "./color";
import { escapeXml, formatClock, truncate } from "./text";

/** The share of the owner's roster hex in an open cell; the rest is card face. The
 * mock's dial: full-strength hex is a loud quilt, 80% keeps the wash legible. */
export const OWNER_TINT = 0.8;

/** The dark board chrome, judged against Observatory (#121118), verbatim from the
 * ratified mock: blocks sink near-black, gridlines and frame lift a step above them
 * so the lattice reads. Light uses brand ink for all three. */
export const DARK_BOARD = {
  block: "#0A0910",
  line: "#33313A",
  frame: "#3A3742",
} as const;

/** An open cell nobody owns (defensive; a completed grid owns all): a whisper off the
 * face so the board never reads as holes. From the mock's cell base tones. */
const BARE_CELL = { light: "#F7F5F0", dark: "#1B1A21" } as const;

/** The solo ramp's pale end (the FIRST end is pale, the LAST square lands full gold),
 * per ground; the gold end is the brand gold itself. Light is the mock's hex. */
const RAMP_FROM = { light: "#E6DFCD", dark: "#2F2A29" } as const;

/**
 * The grapheme budgets (code points, conservative) for every truncated run. The layout
 * cannot measure text, so each budget is sized for the run's font at its widest
 * plausible advance; anything longer ellipsizes (SHARE.md documents the same table).
 */
export const BUDGETS = {
  /** Portrait puzzle title, Newsreader 500 at 54px across 936px. */
  portraitTitle: 30,
  /** Portrait byline ("by ..."), Schibsted 26px, sharing the line with the dims. */
  portraitAuthor: 38,
  /** Credits name, Schibsted 600 at 30px sharing its line with the title label. */
  creditName: 16,
  /** Credits title label, Newsreader italic at 28px, after the name on one line. */
  creditLabel: 24,
  /** Credits evidence line, Schibsted 21px across a 420px column. */
  creditDetail: 36,
  /** The solvedOn date slot, both variants. */
  date: 20,
  /** OG title, Newsreader 500 at 44px across ~450px. */
  ogTitle: 22,
  /** OG byline. */
  ogAuthor: 28,
  /** OG credit line name / title label (one flowed line carries both). */
  ogCreditName: 14,
  ogCreditLabel: 22,
} as const;

/** The most credit entries a portrait card seats (2 columns x 4 rows); the rest are
 * dropped from the card, never squeezed (the caller sends ladder order, so what
 * survives is the most memorable). */
export const MAX_CREDITS = 8;

/** The most credit lines the og card seats. */
export const MAX_OG_CREDITS = 5;

// Family stacks only; the caller may inject @font-face CSS via options.fontCss, and a
// consumer without it falls down the stack instead of blanking.
const F_DISPLAY = "Newsreader, Georgia, 'Times New Roman', serif";
const F_GROTESK = "'Schibsted Grotesk', 'Helvetica Neue', Arial, sans-serif";
const F_MONO = "'Geist Mono', Menlo, Consolas, monospace";

interface Palette {
  readonly face: string;
  readonly ink: string;
  readonly muted: string;
  readonly hairline: string;
  readonly board: { block: string; line: string; frame: string };
  readonly bareCell: string;
}

function paletteOf(ground: "light" | "dark"): Palette {
  const face = ground === "light" ? BRAND.studio : BRAND.observatory;
  const ink = ground === "light" ? BRAND.ink : BRAND.bone;
  return {
    face,
    ink,
    muted: mixHex(ink, face, 0.35),
    hairline: mixHex(ink, face, 0.82),
    board:
      ground === "light"
        ? { block: BRAND.ink, line: BRAND.ink, frame: BRAND.ink }
        : DARK_BOARD,
    bareCell: BARE_CELL[ground],
  };
}

/** The solo mosaic's gold ramp: pale at the first square, the brand gold at the last,
 * linear in fill order and monotone by construction. Exported for the ramp key and the
 * monotonicity test. */
export function soloRampColor(t: number, ground: "light" | "dark"): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return mixHex(RAMP_FROM[ground], BRAND.gold, clamped);
}

interface TextOpts {
  readonly anchor?: "start" | "middle" | "end";
  readonly weight?: number;
  readonly italic?: boolean;
  readonly spacing?: number;
}

function textEl(
  x: number,
  y: number,
  size: number,
  family: string,
  fill: string,
  raw: string,
  o: TextOpts = {},
): string {
  const anchor = o.anchor !== undefined ? ` text-anchor="${o.anchor}"` : "";
  const weight = o.weight !== undefined ? ` font-weight="${o.weight}"` : "";
  const italic = o.italic === true ? ` font-style="italic"` : "";
  const spacing =
    o.spacing !== undefined ? ` letter-spacing="${o.spacing}"` : "";
  return (
    `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}"` +
    ` fill="${fill}"${weight}${italic}${anchor}${spacing}>${escapeXml(raw)}</text>`
  );
}

/** A tspan for a flowed line (name then title label, or the og statline): the browser
 * lays the runs end to end, the one text-flow SVG gives us without measuring. */
function span(
  family: string,
  fill: string,
  raw: string,
  o: TextOpts = {},
): string {
  const weight = o.weight !== undefined ? ` font-weight="${o.weight}"` : "";
  const italic = o.italic === true ? ` font-style="italic"` : "";
  return `<tspan font-family="${family}" fill="${fill}"${weight}${italic}>${escapeXml(raw)}</tspan>`;
}

function flowedText(x: number, y: number, size: number, spans: string): string {
  return `<text x="${x}" y="${y}" font-size="${size}">${spans}</text>`;
}

function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width = 1.5,
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"/>`;
}

function solverHex(s: ShareCardSolver, ground: "light" | "dark"): string {
  return ground === "light" ? s.colorLight : s.colorDark;
}

/** The mosaic fill for a white cell under the owners painting. */
function ownersFill(
  data: ShareCardData,
  ground: "light" | "dark",
  p: Palette,
): (cell: number) => string {
  return (cell) => {
    const idx = data.ownersByCell[cell];
    const solver = idx === undefined ? undefined : data.solvers[idx];
    if (solver === undefined) return p.bareCell;
    return mixHex(p.face, solverHex(solver, ground), OWNER_TINT);
  };
}

/** The mosaic fill under the solo (fill order) painting. */
function soloFill(
  data: ShareCardData,
  ground: "light" | "dark",
  p: Palette,
): (cell: number) => string {
  const order = data.fillOrderByCell;
  return (cell) => {
    const t = order?.[cell];
    if (t === undefined) return p.bareCell;
    return soloRampColor(t, ground);
  };
}

function svgRoot(
  w: number,
  h: number,
  face: string,
  fontCss: string | undefined,
  body: string,
): string {
  const style =
    fontCss !== undefined ? `<defs><style>${fontCss}</style></defs>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    style +
    `<rect width="${w}" height="${h}" fill="${face}"/>` +
    body +
    `</svg>`
  );
}

/** The byline under the title: "by {author} · {cols}×{rows}", or just the dims when
 * the author is unknown (the mock's line). Returns null when there is nothing to say. */
function bylineOf(data: ShareCardData, budget: number): string | null {
  const dims = `${data.cols}×${data.rows}`;
  if (data.puzzle.author !== null) {
    return `by ${truncate(data.puzzle.author, budget)} · ${dims}`;
  }
  return data.puzzle.title !== null ? dims : null;
}

/** The three-cell stats strip, hairline-separated, shared by the portrait variants.
 * Solo swaps the SOLVERS cell for SITTINGS (a solo card's solver count says nothing)
 * and the sittings sub-line moves into that cell. */
function statsStrip(
  data: ShareCardData,
  p: Palette,
  x: number,
  y: number,
  width: number,
  height: number,
  solo: boolean,
): string {
  const colW = width / 3;
  const cells: { label: string; value: string; sub: string | null }[] = [
    {
      label: "ACTIVE TIME",
      value: formatClock(data.stats.activeSeconds),
      sub:
        !solo && data.stats.sittingCount >= 2
          ? `${data.stats.sittingCount} sittings`
          : null,
    },
    solo
      ? { label: "SITTINGS", value: String(data.stats.sittingCount), sub: null }
      : { label: "SOLVERS", value: String(data.stats.solverCount), sub: null },
    { label: "SQUARES", value: String(data.stats.squareCount), sub: null },
  ];
  const parts: string[] = [
    line(x, y, x + width, y, p.hairline),
    line(x, y + height, x + width, y + height, p.hairline),
    line(x + colW, y + 16, x + colW, y + height - 16, p.hairline),
    line(x + 2 * colW, y + 16, x + 2 * colW, y + height - 16, p.hairline),
  ];
  cells.forEach((cell, i) => {
    const cx = x + colW * (i + 0.5);
    parts.push(
      textEl(cx, y + 42, 20, F_GROTESK, p.muted, cell.label, {
        anchor: "middle",
        weight: 600,
        spacing: 2.5,
      }),
      textEl(cx, y + 100, 52, F_MONO, p.ink, cell.value, {
        anchor: "middle",
        weight: 500,
      }),
    );
    if (cell.sub !== null) {
      parts.push(
        textEl(cx, y + 130, 20, F_GROTESK, p.muted, cell.sub, {
          anchor: "middle",
        }),
      );
    }
  });
  return parts.join("");
}

/** Portrait and solo: the 1080x1620 flagship layout. */
function portraitCard(
  data: ShareCardData,
  options: ShareCardOptions,
): RenderedCard {
  const W = 1080;
  const H = 1620;
  const M = 72;
  const solo = options.variant === "solo";
  const p = paletteOf(options.ground);
  const parts: string[] = [];

  // Header: the bona fide lockup (never re-set in live text on a brand surface,
  // docs/design/logo/README.md), the date quiet on the right.
  let cy = M;
  parts.push(lockupSvg(M, cy, 44, options.ground).svg);
  if (data.solvedOn !== null) {
    parts.push(
      textEl(
        W - M,
        cy + 30,
        22,
        F_GROTESK,
        p.muted,
        truncate(data.solvedOn, BUDGETS.date),
        { anchor: "end" },
      ),
    );
  }
  cy += 44 + 44;

  // Title block: the puzzle's own name in the display serif, the byline under it.
  if (data.puzzle.title !== null) {
    parts.push(
      textEl(
        M,
        cy + 44,
        54,
        F_DISPLAY,
        p.ink,
        truncate(data.puzzle.title, BUDGETS.portraitTitle),
        { weight: 500 },
      ),
    );
    cy += 66;
  }
  const byline = bylineOf(data, BUDGETS.portraitAuthor);
  if (byline !== null) {
    parts.push(textEl(M, cy + 24, 26, F_GROTESK, p.muted, byline));
    cy += 40;
  }
  cy += 24;

  // Everything below the board has a fixed height, so the board takes what remains.
  const statsH = 148;
  const boardGap = 40;
  const belowGap = 44;
  const credits = solo ? [] : data.solvers.slice(0, MAX_CREDITS);
  const creditRows = Math.ceil(credits.length / 2);
  const creditRowH = 92;
  const tailH = solo ? 64 : creditRows > 0 ? 40 + creditRows * creditRowH : 0;
  const boardMaxH =
    H - cy - (boardGap + statsH + (tailH > 0 ? belowGap : 0) + tailH + M);
  const cell = Math.max(
    12,
    Math.floor(Math.min((W - 2 * M) / data.cols, boardMaxH / data.rows)),
  );
  const bx = Math.round((W - data.cols * cell) / 2);
  const blocks = new Set(data.blocks);
  const fillOf = solo
    ? soloFill(data, options.ground, p)
    : ownersFill(data, options.ground, p);
  parts.push(
    boardSvg(bx, cy, data.cols, data.rows, cell, blocks, fillOf, p.board),
  );
  cy += data.rows * cell + boardGap;

  parts.push(statsStrip(data, p, M, cy, W - 2 * M, statsH, solo));
  cy += statsH + belowGap;

  if (solo) {
    // The ramp key: FIRST SQUARE, the pale-to-gold bar, LAST SQUARE. The bar sits in
    // a fixed slot (no measuring); the one other place gold is allowed to live.
    const labelSlot = 190;
    parts.push(
      `<defs><linearGradient id="solo-ramp" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="${soloRampColor(0, options.ground)}"/>` +
        `<stop offset="1" stop-color="${soloRampColor(1, options.ground)}"/>` +
        `</linearGradient></defs>`,
      textEl(M, cy + 27, 19, F_GROTESK, p.muted, "FIRST SQUARE", {
        weight: 600,
        spacing: 2,
      }),
      `<rect x="${M + labelSlot}" y="${cy + 16}" width="${W - 2 * (M + labelSlot)}" height="10" rx="5" fill="url(#solo-ramp)"/>`,
      textEl(W - M, cy + 27, 19, F_GROTESK, p.muted, "LAST SQUARE", {
        anchor: "end",
        weight: 600,
        spacing: 2,
      }),
    );
  } else if (credits.length > 0) {
    // Film credits: chip, then one flowed line (name in the grotesk, the title label
    // in the display italic right after it), the evidence line quiet under it. Caller
    // order IS ladder order; never sorted here.
    parts.push(
      textEl(M, cy + 20, 20, F_GROTESK, p.muted, "SOLVED BY", {
        weight: 600,
        spacing: 2.5,
      }),
    );
    const colGap = 48;
    const colW = (W - 2 * M - colGap) / 2;
    credits.forEach((s, k) => {
      const col = k % 2;
      const row = Math.floor(k / 2);
      const x = M + col * (colW + colGap);
      const top = cy + 44 + row * creditRowH;
      const nameSpan = span(
        F_GROTESK,
        p.ink,
        truncate(s.name, BUDGETS.creditName),
        { weight: 600 },
      );
      const labelSpan =
        s.title !== undefined
          ? span(
              F_DISPLAY,
              p.ink,
              `  ${truncate(s.title.label, BUDGETS.creditLabel)}`,
              { weight: 500, italic: true },
            )
          : "";
      parts.push(
        `<rect x="${x}" y="${top + 8}" width="18" height="18" rx="5" fill="${solverHex(s, options.ground)}"/>`,
        flowedText(x + 32, top + 24, 29, nameSpan + labelSpan),
      );
      if (s.title?.detail !== undefined) {
        parts.push(
          textEl(
            x + 32,
            top + 56,
            21,
            F_GROTESK,
            p.muted,
            truncate(s.title.detail, BUDGETS.creditDetail),
          ),
        );
      }
    });
  }

  return {
    svg: svgRoot(W, H, p.face, options.fontCss, parts.join("")),
    width: W,
    height: H,
  };
}

/** OG: 1200x630, grid left, text right, credits compressed to titles only. */
function ogCard(data: ShareCardData, options: ShareCardOptions): RenderedCard {
  const W = 1200;
  const H = 630;
  const M = 60;
  const p = paletteOf(options.ground);
  const parts: string[] = [];

  // Grid left, vertically centered in a square stage.
  const side = H - 2 * M;
  const cell = Math.max(
    8,
    Math.floor(Math.min(side / data.cols, side / data.rows)),
  );
  const bx = M + Math.round((side - data.cols * cell) / 2);
  const by = Math.round((H - data.rows * cell) / 2);
  const blocks = new Set(data.blocks);
  parts.push(
    boardSvg(
      bx,
      by,
      data.cols,
      data.rows,
      cell,
      blocks,
      ownersFill(data, options.ground, p),
      p.board,
    ),
  );

  const textX = M + side + 56;

  // Header: lockup, then the date on the far right.
  parts.push(lockupSvg(textX, M, 30, options.ground).svg);
  if (data.solvedOn !== null) {
    parts.push(
      textEl(
        W - M,
        M + 21,
        18,
        F_GROTESK,
        p.muted,
        truncate(data.solvedOn, BUDGETS.date),
        { anchor: "end" },
      ),
    );
  }

  let cy = M + 30 + 34;
  if (data.puzzle.title !== null) {
    parts.push(
      textEl(
        textX,
        cy + 40,
        44,
        F_DISPLAY,
        p.ink,
        truncate(data.puzzle.title, BUDGETS.ogTitle),
        { weight: 500 },
      ),
    );
    cy += 58;
  }
  const byline = bylineOf(data, BUDGETS.ogAuthor);
  if (byline !== null) {
    parts.push(textEl(textX, cy + 22, 22, F_GROTESK, p.muted, byline));
    cy += 36;
  }
  cy += 12;

  // Stats, compressed to the mock's one mono statline: time · solvers · sittings
  // (squares stand in when the room sat only once, so the line never reads "1 sitting").
  const third =
    data.stats.sittingCount >= 2
      ? `${data.stats.sittingCount} sittings`
      : `${data.stats.squareCount} squares`;
  parts.push(
    flowedText(
      textX,
      cy + 24,
      24,
      span(F_MONO, p.ink, formatClock(data.stats.activeSeconds), {
        weight: 500,
      }) +
        span(F_MONO, p.muted, " · ", { weight: 500 }) +
        span(F_MONO, p.ink, `${data.stats.solverCount} solvers`, {
          weight: 500,
        }) +
        span(F_MONO, p.muted, " · ", { weight: 500 }) +
        span(F_MONO, p.ink, third, { weight: 500 }),
    ),
  );
  cy += 58;

  // Credits compressed to titles only: chip, then the flowed name + title line.
  const titled = data.solvers
    .filter((s) => s.title !== undefined)
    .slice(0, MAX_OG_CREDITS);
  titled.forEach((s, k) => {
    const ly = cy + 22 + k * 38;
    parts.push(
      `<rect x="${textX}" y="${ly - 13}" width="15" height="15" rx="4" fill="${solverHex(s, options.ground)}"/>`,
      flowedText(
        textX + 26,
        ly,
        22,
        span(F_GROTESK, p.ink, truncate(s.name, BUDGETS.ogCreditName), {
          weight: 600,
        }) +
          span(
            F_DISPLAY,
            p.muted,
            `  ${truncate(s.title!.label, BUDGETS.ogCreditLabel)}`,
            { weight: 500, italic: true },
          ),
      ),
    );
  });

  return {
    svg: svgRoot(W, H, p.face, options.fontCss, parts.join("")),
    width: W,
    height: H,
  };
}

/**
 * Build the completion card. A pure function of its inputs: no clock, no randomness,
 * no IO; the same data and options yield the same SVG byte for byte.
 */
export function completionCardSvg(
  data: ShareCardData,
  options: ShareCardOptions,
): RenderedCard {
  return options.variant === "og"
    ? ogCard(data, options)
    : portraitCard(data, options);
}

/** The board-only render's cell size. Nominal: the SVG carries a viewBox and no
 * width/height attributes, so a page scales it freely; 40 keeps the gridline
 * arithmetic (boardStrokes) in the card variants' range. */
export const BOARD_ONLY_CELL = 40;

export interface BoardOnlyOptions {
  /** Which ground the board sits on: Studio (light) or Observatory (dark). */
  readonly ground: "light" | "dark";
  /** owners (default) paints who first solved each square; fillOrder paints the solo
   * gold ramp from `fillOrderByCell` (SHARE.md solo rule). */
  readonly painting?: "owners" | "fillOrder";
  /** Optional class token(s) stamped on each OPEN cell rect (blocks are chrome, never
   * classed), so a consumer's stylesheet can animate the mosaic (the 13.3 replay).
   * Tokens come from caller code, never display text; they are emitted verbatim. */
  readonly cellClassOf?: (cell: number) => string | undefined;
}

/**
 * The bare finished mosaic as a standalone SVG: the same board idiom, chrome, and cell
 * fills as the card variants (square cells, ink or DARK_BOARD gridlines, OWNER_TINT
 * wash or the solo ramp), with nothing else on the canvas. viewBox pads by half the
 * frame stroke so the frame never clips; there are no width/height attributes, so the
 * consumer sizes it (the share page's replay hero). Same purity contract as the card:
 * same data, same bytes. INV-6 holds as everywhere here: the input carries owners,
 * order, and colors; no letter-shaped field exists, and the board emits no text at all.
 */
export function completionBoardSvg(
  data: ShareCardData,
  options: BoardOnlyOptions,
): RenderedCard {
  const p = paletteOf(options.ground);
  const cell = BOARD_ONLY_CELL;
  const pad = boardStrokes(cell).frame / 2;
  const w = round2(data.cols * cell + 2 * pad);
  const h = round2(data.rows * cell + 2 * pad);
  const fillOf =
    options.painting === "fillOrder"
      ? soloFill(data, options.ground, p)
      : ownersFill(data, options.ground, p);
  const board = boardSvg(
    pad,
    pad,
    data.cols,
    data.rows,
    cell,
    new Set(data.blocks),
    fillOf,
    p.board,
    options.cellClassOf,
  );
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      board +
      `</svg>`,
    width: w,
    height: h,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
