// The completed board's selection and aim layer (reactions-11): an HTML overlay above the mosaic
// SVG that restores what the mosaic dropped when it replaced the interactive grid, namely a movable
// selection to anchor reactions to. It carries per-cell pointer targets and the liquid-glass word
// loupe; it never repaints the mosaic (CompletedMosaic owns the art, and its bloom must not re-fire),
// it only sits over it, the same overlay idiom the sticker layer uses inside the board wrapper.
//
// Keyboard navigation and the `/` HUD live on the wrapper the caller owns (the shared onKeyDown and
// the frozen keyEffect path, so letters stay inert post-completion); this layer is the pointer half.
import { useRef } from "react";
import type { Direction, Grid } from "@crossy/engine";
import { mosaicTargets } from "./mosaicSelect";
import { wordLoupeForSelection } from "./wordLoupe";

export function MosaicSelectLayer({
  grid,
  selectedCell,
  direction,
  onSelect,
  showsLoupe = true,
}: {
  grid: Grid;
  /** The current selection cell (LiveApp/DemoApp's shared `selection.cell`). */
  selectedCell: number;
  /** The current axis determines which answer the liquid-glass loupe spans. */
  direction: Direction;
  /** Move the selection to a clicked cell; the caller relays moveCursor off the resulting selection
   * change, exactly as the live grid does (PROTOCOL.md §9). */
  onSelect: (cell: number) => void;
  /** Whether the loupe visual renders (showsWordLoupe: settled record only, never over the reveal
   * arc or a running replay, the iOS/Android parity). The pointer targets stay live either way,
   * so reactions keep an anchor in any game status (PROTOCOL.md §9). Default true. */
  showsLoupe?: boolean | undefined;
}) {
  const lensRef = useRef<HTMLDivElement>(null);
  const targets = mosaicTargets(grid);
  const loupe = showsLoupe
    ? wordLoupeForSelection(grid, direction, selectedCell)
    : null;

  const moveLight = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (loupe === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const boardX = ((event.clientX - rect.left) / rect.width) * 100;
    const boardY = ((event.clientY - rect.top) / rect.height) * 100;
    const lensX = ((boardX - loupe.lens.left) / loupe.lens.width) * 100;
    const lensY = ((boardY - loupe.lens.top) / loupe.lens.height) * 100;
    lensRef.current?.style.setProperty(
      "--loupe-light-x",
      `${Math.max(-25, Math.min(125, lensX))}%`,
    );
    lensRef.current?.style.setProperty(
      "--loupe-light-y",
      `${Math.max(-40, Math.min(140, lensY))}%`,
    );
  };

  const resetLight = (): void => {
    lensRef.current?.style.removeProperty("--loupe-light-x");
    lensRef.current?.style.removeProperty("--loupe-light-y");
  };

  return (
    // Pointer-transparent container so a block (which gets no target) and any gap fall through to the
    // mosaic beneath; each target re-enables pointer events on itself. aria-hidden: the mosaic SVG
    // already carries the board's accessible label, and these are pointer conveniences (the targets
    // are out of the tab order too), so they add no duplicate cells to the a11y tree.
    <div
      className="mosaic-select"
      aria-hidden
      onPointerMove={moveLight}
      onPointerLeave={resetLight}
    >
      {targets.map((box) => (
        <button
          key={box.cell}
          type="button"
          tabIndex={-1}
          className="mosaic-select-target"
          style={{
            left: `${box.leftPct}%`,
            top: `${box.topPct}%`,
            width: `${box.widthPct}%`,
            height: `${box.heightPct}%`,
          }}
          onClick={() => onSelect(box.cell)}
        />
      ))}
      {loupe !== null && (
        <>
          <div
            ref={lensRef}
            className="word-loupe"
            data-mode="refraction"
            style={{
              left: `${loupe.lens.left}%`,
              top: `${loupe.lens.top}%`,
              width: `${loupe.lens.width}%`,
              height: `${loupe.lens.height}%`,
              ["--loupe-strength" as string]: 0.58,
            }}
          >
            <div className="word-loupe-surface" />
          </div>
          <div
            className="word-loupe-focus"
            data-focus="etched"
            style={{
              left: `${loupe.focus.left}%`,
              top: `${loupe.focus.top}%`,
              width: `${loupe.focus.width}%`,
              height: `${loupe.focus.height}%`,
            }}
          >
            <i />
            <i />
            <i />
            <i />
          </div>
        </>
      )}
    </div>
  );
}
