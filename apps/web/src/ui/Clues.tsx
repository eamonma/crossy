// The clue surfaces. On mobile the active-clue bar is the whole story: it shows the current
// clue and, tapped, opens a bottom-sheet browser of every clue. On desktop the same bar sits
// over a two-list rail. All of it is built from the dashed rule and the one panel recipe, never
// new chrome. Empty and cross-reference cases are handled explicitly (audit gaps 3 and 6).
import { useEffect, useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Cross2Icon,
  ListBulletIcon,
} from "@radix-ui/react-icons";
import type { Direction } from "@crossy/engine";
import type { Clue } from "../domain/types";
import { CapsLabel, Divider, IconButton, cx } from "./primitives";

const DIR_ABBR: Record<Direction, string> = { across: "A", down: "D" };

/** The clue containing the cursor on a given axis, if any. */
export function clueOn(
  clues: readonly Clue[],
  direction: Direction,
  cell: number,
): Clue | undefined {
  return clues.find((c) => c.direction === direction && c.cells.includes(cell));
}

/**
 * The active-clue bar. Prev/next step through clues on the current axis; the number tag jumps to
 * the clue start; the whole label opens the sheet on touch. On a themeless or a mini with no word
 * on an axis it states that plainly rather than going blank.
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
    <div className="flex items-stretch gap-1 border-b border-dashed border-border-dashed bg-panel">
      <IconButton
        variant="ghost"
        size="md"
        onClick={onPrev}
        aria-label="Previous clue"
      >
        <ChevronLeftIcon />
      </IconButton>
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 flex items-baseline gap-3 px-1 py-2 text-left"
        aria-label="Show all clues"
      >
        {clue ? (
          <>
            <span className="shrink-0 text-2 font-semibold text-text-muted tabular-nums">
              {clue.number}
              {DIR_ABBR[clue.direction]}
            </span>
            <span className="min-w-0 truncate text-4 text-text">
              {clue.text ?? "—"}
            </span>
          </>
        ) : (
          <span className="text-3 text-text-subtle">No word on this axis</span>
        )}
        <ListBulletIcon className="ml-auto shrink-0 self-center text-text-subtle" />
      </button>
      <IconButton
        variant="ghost"
        size="md"
        onClick={onNext}
        aria-label="Next clue"
      >
        <ChevronRightIcon />
      </IconButton>
    </div>
  );
}

/** One direction's list. The active row is amber-5 when it is the axis you are on, amber-3 when
 * it is the crossing clue, matching the board's own active-word / cross-reference language. */
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
      <div className="px-4 py-2">
        <CapsLabel>{title}</CapsLabel>
      </div>
      <Divider />
      <ul className="list-none m-0 p-0 overflow-y-auto flex-1">
        {clues.length === 0 && (
          <li className="px-4 py-3 text-2 text-text-subtle">No clues.</li>
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
                  "grid grid-cols-[2.6ch_1fr] gap-2 w-full text-left px-4 py-1.5",
                  "transition-colors hover:bg-sand-3",
                  active && (isCurrentAxis ? "bg-amber-5" : "bg-amber-3"),
                )}
              >
                <span
                  className={cx(
                    "text-2 tabular-nums text-right",
                    active ? "text-text font-semibold" : "text-text-muted",
                  )}
                >
                  {c.number}
                </span>
                <span className="text-2 text-text">{c.text ?? "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Desktop rail: the two lists stacked, dashed rule between, framing the grid on the right. */
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
        className="absolute inset-0 bg-sand-12/30"
      />
      <div className="sheet-in absolute inset-x-0 bottom-0 max-h-[75dvh] flex flex-col bg-panel border-t border-border rounded-t-[16px] shadow-xl">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="mx-auto absolute left-1/2 -translate-x-1/2 top-2 h-1 w-9 rounded-full bg-border-strong" />
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
        <Divider />
        <div className="grid grid-rows-2 min-h-0 flex-1 divide-y divide-dashed divide-border-dashed">
          <div className="flex min-h-0">
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
