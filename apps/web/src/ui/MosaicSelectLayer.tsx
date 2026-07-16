// The completed board's selection and aim layer (reactions-11): an HTML overlay above the mosaic
// SVG that restores what the mosaic dropped when it replaced the interactive grid, namely a movable
// selection to anchor reactions to. It carries per-cell pointer targets and the selection ring; it
// never repaints the mosaic (CompletedMosaic owns the art, and its bloom must not re-fire), it only
// sits over it, the same overlay idiom the sticker layer uses inside the board wrapper.
//
// Keyboard navigation and the `/` HUD live on the wrapper the caller owns (the shared onKeyDown and
// the frozen keyEffect path, so letters stay inert post-completion); this layer is the pointer half.
import type { Grid } from "@crossy/engine";
import { cellBox, isMosaicSelectable, mosaicTargets } from "./mosaicSelect";

export function MosaicSelectLayer({
  grid,
  selectedCell,
  onSelect,
}: {
  grid: Grid;
  /** The current selection cell (LiveApp/DemoApp's shared `selection.cell`). */
  selectedCell: number;
  /** Move the selection to a clicked cell; the caller relays moveCursor off the resulting selection
   * change, exactly as the live grid does (PROTOCOL.md §9). */
  onSelect: (cell: number) => void;
}) {
  const targets = mosaicTargets(grid);
  const ring = isMosaicSelectable(selectedCell, grid)
    ? cellBox(selectedCell, grid.cols, grid.rows)
    : null;
  return (
    // Pointer-transparent container so a block (which gets no target) and any gap fall through to the
    // mosaic beneath; each target re-enables pointer events on itself. aria-hidden: the mosaic SVG
    // already carries the board's accessible label, and these are pointer conveniences (the targets
    // are out of the tab order too), so they add no duplicate cells to the a11y tree.
    <div className="mosaic-select" aria-hidden>
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
      {ring !== null && (
        <div
          className="mosaic-select-ring"
          style={{
            left: `${ring.leftPct}%`,
            top: `${ring.topPct}%`,
            width: `${ring.widthPct}%`,
            height: `${ring.heightPct}%`,
          }}
        />
      )}
    </div>
  );
}
