// The reaction sticker layer as an HTML overlay above the board SVG (settle-pop fix, owner report
// 2026-07-14). The stickers used to be SVG <text> nodes animated inside the grid, and on hardware
// GPUs the sticker visibly popped ~1px rightward when the entry animation ended: an SVG text
// transform animation is rasterized by the compositor against a fill-box-resolved origin, the
// static repaint after demotion resolves glyph geometry slightly differently, and the raster swap
// at the animation boundary lands as a deterministic directional shift. Layout values never move
// (rect sampling is blind to it), and software rasterization does not reproduce it, so the fix is
// structural: render stickers as HTML, where transform-origin is plain border-box, and hold ONE
// compositor layer per sticker for its whole life (will-change on the animated node), so there is
// no promote/demote handoff to swap rasters at settle.
//
// Everything else is unchanged from the SVG layer it replaces: placement, tilt, and scatter derive
// only from the entry's own stable key (fixed at creation, so pile arrivals, coalesces, and
// expiries never move an incumbent), the loud entrance and delayed shrink-fade exit live in
// styles.css, a coalesced re-tap remounts the inner node to replay the shout in place, piles cap
// at the newest four, and reduced motion falls back to fade-only with the tilt zeroed. Resize
// tracking is pure CSS: positions are cell percentages of the overlay (which fills the board
// wrapper), and the glyph size is container-query units against the overlay (styles.css), so no
// script measures anything.
import type { ReactionEntry } from "./reactionModel";

// The grid's 36-unit cell module (CrosswordGrid CELL) and the sticker geometry retuned by the
// owner rulings 2026-07-14: ~64% of the module, near-centered with a slight lower-left bias,
// ±8-unit seeded scatter (bleed possible, not a goal), ±8-12° seeded tilt.
const MODULE = 36;
const STICKER_CENTER_X = 17;
const STICKER_CENTER_Y = 20;
const STICKER_SCATTER = 8;
const STICKER_PILE_CAP = 4;

// A stable unsigned hash of the sprite key (FNV-1a), so a sprite's tilt and scatter are
// deterministic across re-renders and unique per sprite.
function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function Sticker({
  entry,
  cols,
  rows,
}: {
  entry: ReactionEntry;
  cols: number;
  rows: number;
}) {
  const seed = seedOf(entry.key);
  const magnitude = 8 + (seed % 5); // 8..12 degrees
  const rot = (seed & 1) === 0 ? magnitude : -magnitude;
  const spread = STICKER_SCATTER * 2 + 1;
  const jitterX = ((seed >> 1) % spread) - STICKER_SCATTER;
  const jitterY = ((seed >> 4) % spread) - STICKER_SCATTER;
  const col = entry.cell % cols;
  const row = Math.floor(entry.cell / cols);
  const leftPct =
    ((col * MODULE + STICKER_CENTER_X + jitterX) / (MODULE * cols)) * 100;
  const topPct =
    ((row * MODULE + STICKER_CENTER_Y + jitterY) / (MODULE * rows)) * 100;
  return (
    <div
      className="sticker"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        // The tilt feeds the static CSS `rotate` through --tilt (styles.css), never the animated
        // `transform`; the reduced-motion rule zeroes it (an inline `rotate` would win over that
        // rule, a custom property does not).
        ["--tilt" as string]: `${rot}deg`,
      }}
    >
      {/* The animated node, remounted by the pulse key so a coalesced re-tap replays the whole
          loud entrance in place: a repeat shout is the grammar, not a softer echo (owner ruling
          2026-07-14). will-change (styles.css) pins its compositor layer from mount to unmount,
          so the entry animation's end swaps no rasters: the settle-pop fix proper. */}
      <span
        key={`${entry.key}:${entry.pulse}`}
        className="sticker-pop sticker-pop--in"
        aria-hidden
      >
        {entry.emoji}
      </span>
    </div>
  );
}

export function ReactionStickers({
  cols,
  rows,
  blocks,
  reactions,
}: {
  cols: number;
  rows: number;
  /** Black squares: a reaction anchored on one never renders (same rule the SVG layer had). */
  blocks: ReadonlySet<number>;
  reactions: readonly ReactionEntry[];
}) {
  // Group by cell; oldest first so the newest paints on top; cap at the newest four. Ordering
  // only picks paint order and the shown set, never placement, so a re-sort (a coalesce
  // refreshing `at`) or an eviction cannot move an incumbent.
  const byCell = new Map<number, ReactionEntry[]>();
  for (const entry of reactions) {
    if (blocks.has(entry.cell)) continue;
    const list = byCell.get(entry.cell);
    if (list === undefined) byCell.set(entry.cell, [entry]);
    else list.push(entry);
  }
  const shown: ReactionEntry[] = [];
  for (const list of byCell.values()) {
    const ordered = [...list].sort((a, b) => a.at - b.at);
    shown.push(...ordered.slice(-STICKER_PILE_CAP));
  }
  if (shown.length === 0) return null;

  return (
    // --board-cols feeds the pure-CSS glyph sizing (styles.css): the overlay is an inline-size
    // container, so 100cqi / cols is one cell in CSS pixels at any board scale.
    <div
      className="board-stickers"
      style={{ ["--board-cols" as string]: cols }}
      aria-hidden
    >
      {shown.map((entry) => (
        <Sticker key={entry.key} entry={entry} cols={cols} rows={rows} />
      ))}
    </div>
  );
}
