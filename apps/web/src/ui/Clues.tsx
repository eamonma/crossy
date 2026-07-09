// The clue surfaces. Desktop reads like v2's game screen: a quiet clue strip under the
// toolbar (number tag, then the prose) closed by the dashed rule, and a right-hand rail of
// the two lists with the gold-amber active row. Mobile keeps its own bar: prev/next steps,
// and the label opens a bottom-sheet browser. All of it is the dashed rule and the one panel
// recipe, never new chrome. Empty axes state themselves plainly.
import { useEffect, useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Cross2Icon,
  ListBulletIcon,
} from "@radix-ui/react-icons";
import type { Direction } from "@crossy/engine";
import type { Clue } from "../domain/types";
import { Divider, IconButton, cx } from "./primitives";

const DIR_ABBR: Record<Direction, string> = { across: "A", down: "D" };

/** The clue containing the cursor on a given axis, if any. */
export function clueOn(
  clues: readonly Clue[],
  direction: Direction,
  cell: number,
): Clue | undefined {
  return clues.find((c) => c.direction === direction && c.cells.includes(cell));
}

/** Desktop only: the active clue as a calm line of text. Navigation lives in the rail
 * and the keyboard, so this strip carries no controls (v2's clue bar exactly). */
export function ClueStrip({ clue }: { clue: Clue | undefined }) {
  return (
    <div className="hidden md:flex items-baseline px-4 py-1.5 border-b border-dashed border-border-dashed">
      {clue ? (
        <>
          <span className="w-[5ch] shrink-0 text-2 font-semibold text-text-muted tabular-nums">
            {clue.number}
            {DIR_ABBR[clue.direction]}
          </span>
          <span className="min-w-0 text-4 font-medium text-text">
            {clue.text ?? "—"}
          </span>
        </>
      ) : (
        <span className="text-3 text-text-subtle">No word on this axis</span>
      )}
    </div>
  );
}

/**
 * Mobile only: the active-clue bar. Prev/next step through clues on the current axis; the
 * label opens the sheet. On a mini with no word on an axis it states that plainly.
 */
export function ClueBar({
  clue,
  onOpen,
  onPrev,
  onNext,
}: {
  clue: Clue | undefined;
  onOpen: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="md:hidden flex items-stretch border-b border-dashed border-border-dashed">
      <IconButton
        variant="ghost"
        size="md"
        onClick={onPrev}
        aria-label="Previous clue"
        className="self-center"
      >
        <ChevronLeftIcon />
      </IconButton>
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 flex items-center gap-2.5 px-1 py-2 text-left"
        aria-label="Show all clues"
      >
        {clue ? (
          <>
            <span className="shrink-0 text-2 font-semibold text-text-muted tabular-nums">
              {clue.number}
              {DIR_ABBR[clue.direction]}
            </span>
            <span className="min-w-0 truncate text-3 font-medium text-text">
              {clue.text ?? "—"}
            </span>
          </>
        ) : (
          <span className="text-3 text-text-subtle">No word on this axis</span>
        )}
        <ListBulletIcon className="ml-auto shrink-0 text-text-subtle" />
      </button>
      <IconButton
        variant="ghost"
        size="md"
        onClick={onNext}
        aria-label="Next clue"
        className="self-center"
      >
        <ChevronRightIcon />
      </IconButton>
    </div>
  );
}

/** One direction's list, v2's rows: a right-aligned number gutter, then the prose. The
 * active row is amber-5 on your axis and amber-3 on the crossing one, the same language
 * as the board's active word and cross-reference tints. */
function ClueList({
  title,
  clues,
  activeNumber,
  isCurrentAxis,
  onJump,
}: {
  title: string;
  clues: readonly Clue[];
  activeNumber: number | null;
  isCurrentAxis: boolean;
  onJump: (clue: Clue) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeNumber, isCurrentAxis]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-2 pb-1.5">
        <span className="text-2 font-bold uppercase tracking-[var(--tracking-caps)] text-text">
          {title}
        </span>
      </div>
      <Divider />
      <ul className="list-none m-0 p-0 overflow-y-auto flex-1">
        {clues.length === 0 && (
          <li className="px-4 py-2 text-2 text-text-subtle">
            No clues on this axis.
          </li>
        )}
        {clues.map((c) => {
          const active = c.number === activeNumber;
          return (
            <li key={`${c.direction}-${c.number}`}>
              <button
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => onJump(c)}
                className={cx(
                  "grid grid-cols-[3.2ch_1fr] w-full text-left cursor-pointer",
                  active
                    ? isCurrentAxis
                      ? "bg-amber-5"
                      : "bg-amber-3"
                    : "hover:bg-amber-3",
                )}
              >
                <span
                  className={cx(
                    "py-1 pr-1.5 text-right text-2 tabular-nums",
                    active
                      ? "font-semibold text-text"
                      : "font-semibold text-text-muted",
                  )}
                >
                  {c.number}
                </span>
                <span className="py-1 pl-2 pr-4 text-2 text-text">
                  {c.text ?? "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Desktop rail: the two lists stacked, framed off the board by the dashed rule. */
export function ClueRail({
  across,
  down,
  activeAcross,
  activeDown,
  currentDirection,
  onJump,
}: {
  across: readonly Clue[];
  down: readonly Clue[];
  activeAcross: number | null;
  activeDown: number | null;
  currentDirection: Direction;
  onJump: (clue: Clue) => void;
}) {
  return (
    <div className="hidden md:grid grid-rows-2 min-h-0 h-full border-l border-dashed border-border-dashed">
      <div className="flex min-h-0 border-b border-dashed border-border-dashed">
        <ClueList
          title="Across"
          clues={across}
          activeNumber={activeAcross}
          isCurrentAxis={currentDirection === "across"}
          onJump={onJump}
        />
      </div>
      <div className="flex min-h-0">
        <ClueList
          title="Down"
          clues={down}
          activeNumber={activeDown}
          isCurrentAxis={currentDirection === "down"}
          onJump={onJump}
        />
      </div>
    </div>
  );
}

/** Mobile bottom sheet: both lists, a drag-handle header, dismissed by the scrim or the close. */
export function ClueSheet({
  open,
  onClose,
  across,
  down,
  activeAcross,
  activeDown,
  currentDirection,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  across: readonly Clue[];
  down: readonly Clue[];
  activeAcross: number | null;
  activeDown: number | null;
  currentDirection: Direction;
  onJump: (clue: Clue) => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const jumpAndClose = (clue: Clue): void => {
    onJump(clue);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-sheet)] md:hidden"
      role="dialog"
      aria-label="Clues"
    >
      <button
        type="button"
        aria-label="Close clues"
        onClick={onClose}
        className="absolute inset-0 bg-sand-a8"
      />
      <div className="sheet-in absolute inset-x-0 bottom-0 h-[75dvh] flex flex-col bg-panel border-t border-border rounded-t-[12px] shadow-xl">
        <div className="relative flex items-center justify-between pl-4 pr-2 pt-3 pb-1">
          <span className="absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-9 rounded-full bg-border-strong" />
          <span className="font-display text-5 font-medium">Clues</span>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
          >
            <Cross2Icon />
          </IconButton>
        </div>
        <div className="grid grid-rows-2 min-h-0 flex-1">
          <div className="flex min-h-0 border-b border-dashed border-border-dashed">
            <ClueList
              title="Across"
              clues={across}
              activeNumber={activeAcross}
              isCurrentAxis={currentDirection === "across"}
              onJump={jumpAndClose}
            />
          </div>
          <div className="flex min-h-0">
            <ClueList
              title="Down"
              clues={down}
              activeNumber={activeDown}
              isCurrentAxis={currentDirection === "down"}
              onJump={jumpAndClose}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
