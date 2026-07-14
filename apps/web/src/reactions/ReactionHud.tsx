// The radial reaction HUD (Wave 7.3): the `/` leader ring, drawn around the cursor cell. It is an
// HTML overlay positioned by cell PERCENTAGE inside the board wrapper, so it lands on the cell at
// any board scale without reading pixels. The five slots sit at the W / E / A / S / D compass
// points from REACTION_SET, each labelled with its key (the teaching affordance), so the ring reads
// as the keys under the hand. It is keyboard-first: the container is pointer-transparent and only
// the slots take clicks, so an errant click falls through to the board. Motion (.hud-pop) lives in
// styles.css with a reduced-motion fallback.
import type { ReactionSlot } from "./reactionSet";
import { REACTION_SET } from "./reactionSet";
import { Keycap } from "./Keycap";

// Unit compass vectors per slot; scaled by the ring radius below. Y grows downward (screen space).
const SLOT_VECTOR: Record<ReactionSlot, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  "upper-right": { x: 0.72, y: -0.72 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

// Ring radius (owner ruling 2026-07-14): large enough that the slots breathe, close enough that
// the ring still reads as belonging to its anchor cell.
const RING_RADIUS_REM = 4;

export function ReactionHud({
  cols,
  rows,
  cell,
  onReact,
}: {
  cols: number;
  rows: number;
  /** The anchor cell (the cursor cell frozen when the HUD opened). */
  cell: number;
  /** Fire the slot's emoji; the hook anchors it to this HUD's cell and dismisses the ring. */
  onReact: (emoji: string) => void;
}) {
  const leftPct = (((cell % cols) + 0.5) / cols) * 100;
  const topPct = ((Math.floor(cell / cols) + 0.5) / rows) * 100;

  return (
    <div
      // Pointer-transparent so a click that misses a slot reaches the board underneath. The slots
      // re-enable pointer events on themselves.
      className="hud-pop pointer-events-none absolute z-[var(--z-dropdown)]"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: "translate(-50%, -50%)",
      }}
      role="group"
      aria-label="Reaction ring"
    >
      {/* The anchor dot marks the cell the ring will react on. */}
      <span
        aria-hidden
        className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-9/70"
        style={{ width: "0.3rem", height: "0.3rem" }}
      />
      {REACTION_SET.map((option) => {
        const v = SLOT_VECTOR[option.slot];
        return (
          <button
            key={option.emoji}
            type="button"
            // Keep board focus (so held keys keep repeating) yet still fire on click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onReact(option.emoji)}
            className="pointer-events-auto absolute flex flex-col items-center gap-0.5 rounded-2 border border-border bg-panel px-1 py-1 shadow-md transition-transform duration-100 ease-[var(--ease-out)] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{
              left: `${v.x * RING_RADIUS_REM}rem`,
              top: `${v.y * RING_RADIUS_REM}rem`,
              transform: "translate(-50%, -50%)",
            }}
            aria-label={`React with ${option.emoji} (key ${option.keyLabel})`}
          >
            <span aria-hidden style={{ fontSize: "1.05rem", lineHeight: 1 }}>
              {option.emoji}
            </span>
            <Keycap>{option.keyLabel}</Keycap>
          </button>
        );
      })}
    </div>
  );
}
