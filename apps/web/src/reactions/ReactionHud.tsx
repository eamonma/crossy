// The radial reaction HUD (Wave 7.3): the `/` leader ring, drawn around the cursor cell. A
// zero-size anchor sits at the cell by PERCENTAGE inside the board wrapper (so it lands at any
// board scale), and the ring itself renders through a portal at the anchor's screen point: the
// board stage clips its overflow for sizing, and a ring on an edge cell must ride over that edge
// (and the dashed rule beyond it) uncut. The five slots sit at the W / E / A / S / D compass
// points of the caller's resolved personal set (§12), each labelled with its key (the teaching
// affordance), so the ring reads as the keys under the hand. It is keyboard-first: the container is
// pointer-transparent and only the slots take clicks, so an errant click falls through to the
// board. Motion (.hud-pop) lives in styles.css with a reduced-motion fallback.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactionOption, ReactionSlot } from "./reactionSet";
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
  options,
  onReact,
}: {
  cols: number;
  rows: number;
  /** The anchor cell (the cursor cell frozen when the HUD opened). */
  cell: number;
  /** The caller's resolved reaction options in slot order (the personal set, §12). */
  options: readonly ReactionOption[];
  /** Fire the slot's emoji; the hook anchors it to this HUD's cell and dismisses the ring. */
  onReact: (emoji: string) => void;
}) {
  const leftPct = (((cell % cols) + 0.5) / cols) * 100;
  const topPct = ((Math.floor(cell / cols) + 0.5) / rows) * 100;

  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  // Project the anchor to viewport coordinates for the portal, and track it while the ring is
  // open: the stage scrolls on small screens and the window can resize under a 3s ring.
  useLayoutEffect(() => {
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPoint({ x: rect.left, y: rect.top });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [cell, cols, rows]);

  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden
        className="absolute"
        style={{ left: `${leftPct}%`, top: `${topPct}%` }}
      />
      {point !== null &&
        createPortal(
          <Ring point={point} options={options} onReact={onReact} />,
          document.body,
        )}
    </>
  );
}

function Ring({
  point,
  options,
  onReact,
}: {
  point: { x: number; y: number };
  options: readonly ReactionOption[];
  onReact: (emoji: string) => void;
}) {
  return (
    <div
      // Pointer-transparent so a click that misses a slot reaches the board underneath. The slots
      // re-enable pointer events on themselves. The translate centers the (zero-size) ring origin
      // on the anchor point; .hud-pop's keyframes carry the same translate.
      className="hud-pop pointer-events-none fixed z-[var(--z-dropdown)]"
      style={{
        left: point.x,
        top: point.y,
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
      {options.map((option) => {
        const v = SLOT_VECTOR[option.slot];
        return (
          <button
            // Keyed on the slot (its fixed key), not the emoji: a live set change re-renders the
            // slot in place rather than remounting the ring.
            key={option.leaderKey}
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
