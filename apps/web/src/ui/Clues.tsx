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
import { Divider, cx } from "./primitives";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

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
      <Button
        variant="ghost"
        size="icon"
        onClick={onPrev}
        aria-label="Previous clue"
        className="self-center"
      >
        <ChevronLeftIcon />
      </Button>
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
      <Button
        variant="ghost"
        size="icon"
        onClick={onNext}
        aria-label="Next clue"
        className="self-center"
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

/** One direction's list, v2's rows: a right-aligned number gutter, then the prose. The
 * active row is amber-5 on your axis and amber-3 on the crossing one, the same language
 * as the board's active word and cross-reference tints. A solved row (every cell filled)
 * sits back like a crossed-off newsprint entry and recovers on hover; the active and
 * crossing rows never dim. */
function ClueList({
  title,
  clues,
  activeNumber,
  isCurrentAxis,
  filled,
  onJump,
}: {
  title: string;
  clues: readonly Clue[];
  activeNumber: number | null;
  isCurrentAxis: boolean;
  filled?: ReadonlySet<number> | undefined;
  onJump: (clue: Clue) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeNumber, isCurrentAxis]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-2 pb-1.5">
        <span className="text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-text">
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
          const solved =
            !active &&
            filled !== undefined &&
            c.cells.every((cell) => filled.has(cell));
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
                  solved && "opacity-40 hover:opacity-100 transition-opacity",
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

/** Desktop rail: the two lists framed off the board by the dashed rule, with the optional
 * solving-now block docked above them at full rail width. Below the `wide` breakpoint the
 * lists stack (Across over Down, a horizontal rule between). At `wide` the rail column
 * widens (LiveApp's grid template) and the lists sit side by side at full height, split by
 * a vertical rule of the same dashed language: by then the board is height-bound, so the
 * second column spends the board's horizontal slack, not the board itself. Both forms keep
 * the active-row scroll and the solved-row dimming identically. */
export function ClueRail({
  across,
  down,
  activeAcross,
  activeDown,
  currentDirection,
  filled,
  solvingNow,
  onJump,
}: {
  across: readonly Clue[];
  down: readonly Clue[];
  activeAcross: number | null;
  activeDown: number | null;
  currentDirection: Direction;
  filled?: ReadonlySet<number> | undefined;
  solvingNow?: React.ReactNode;
  onJump: (clue: Clue) => void;
}) {
  return (
    <div className="hidden md:flex flex-col min-h-0 h-full border-l border-dashed border-border-dashed">
      {solvingNow}
      <div className="grid grid-rows-2 wide:grid-rows-1 wide:grid-cols-2 min-h-0 flex-1">
        <div className="flex min-h-0 border-b border-dashed border-border-dashed wide:border-b-0 wide:border-r">
          <ClueList
            title="Across"
            clues={across}
            activeNumber={activeAcross}
            isCurrentAxis={currentDirection === "across"}
            filled={filled}
            onJump={onJump}
          />
        </div>
        <div className="flex min-h-0">
          <ClueList
            title="Down"
            clues={down}
            activeNumber={activeDown}
            isCurrentAxis={currentDirection === "down"}
            filled={filled}
            onJump={onJump}
          />
        </div>
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
  filled,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  across: readonly Clue[];
  down: readonly Clue[];
  activeAcross: number | null;
  activeDown: number | null;
  currentDirection: Direction;
  filled?: ReadonlySet<number> | undefined;
  onJump: (clue: Clue) => void;
}) {
  const jumpAndClose = (clue: Clue): void => {
    onJump(clue);
    onClose();
  };

  // The panel is md:hidden, but shadcn's overlay renders through a portal and cannot inherit
  // that class; close on a live resize past the desktop breakpoint so a stray scrim never
  // outlives the mobile-only trigger that opened it (the old bespoke sheet hid both as one).
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(min-width: 48rem)");
    if (mq.matches) {
      onClose();
      return;
    }
    const onChange = (e: MediaQueryListEvent): void => {
      if (e.matches) onClose();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open, onClose]);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="md:hidden gap-0 p-0 rounded-t-2xl data-[side=bottom]:h-[75dvh]"
      >
        <SheetHeader className="relative flex-row items-center justify-between gap-0 p-0 pl-4 pr-2 pt-3 pb-1">
          <span className="absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-9 rounded-full bg-border-strong" />
          <SheetTitle className="font-display text-5 font-medium">
            Clues
          </SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <Cross2Icon />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="grid grid-rows-2 min-h-0 flex-1">
          <div className="flex min-h-0 border-b border-dashed border-border-dashed">
            <ClueList
              title="Across"
              clues={across}
              activeNumber={activeAcross}
              isCurrentAxis={currentDirection === "across"}
              filled={filled}
              onJump={jumpAndClose}
            />
          </div>
          <div className="flex min-h-0">
            <ClueList
              title="Down"
              clues={down}
              activeNumber={activeDown}
              isCurrentAxis={currentDirection === "down"}
              filled={filled}
              onJump={jumpAndClose}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
