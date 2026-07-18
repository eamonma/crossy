// The clue surfaces. Desktop reads like v2's game screen: a quiet clue strip under the
// toolbar (number tag, then the prose) closed by the dashed rule, and a right-hand rail of
// the two lists with the gold-amber active row. Mobile keeps its own bar: prev/next steps,
// and the label opens a bottom-sheet browser. Both active-clue bars remain after completion;
// Analysis joins the clue panel instead of replacing its entry point. All of it is the dashed
// rule and the one panel recipe, never new chrome. Empty axes state themselves plainly.
import { useEffect, useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Cross2Icon,
  ListBulletIcon,
} from "@radix-ui/react-icons";
import type { Direction } from "@crossy/engine";
import type { Clue } from "../domain/types";
import type { CluePresence, SolverEntry } from "./roster";
import { ClueText } from "./ClueText";
import { Divider, cx } from "./primitives";
import { PanelTabs, type PanelTab } from "./PanelTabs";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const DIR_ABBR: Record<Direction, string> = { across: "A", down: "D" };

/** Clues the active clue cross-references, keyed `${direction}-${number}` (LiveApp filters to
 * entries this puzzle actually has). A row in this set gets a quiet amber wash so "See 42-Down"
 * and its friends read at a glance, always weaker than the active row's own amber. */
export type ReferencedClues = ReadonlySet<string>;

/**
 * The tab wiring the clue surfaces gain once a room is completed. When absent (mid-solve), every
 * surface is byte-identical to today: no header, no tab, the clue lists exactly as they were. When
 * present, a [Clues | Analysis] header caps the panel and the active tab's body cross-fades in place
 * of the clue lists (the Clues body is unchanged; only the sibling Analysis panel is added). The
 * content is passed in as a node so this module stays free of the analysis data plumbing.
 */
export interface AnalysisTab {
  /** The active tab. */
  readonly value: PanelTab;
  readonly onChange: (tab: PanelTab) => void;
  /** The Analysis panel body (AnalysisPanel or its placeholder). */
  readonly content: React.ReactNode;
}

/**
 * The panel body switch, keyed so React remounts the incoming body and the cross-fade re-arms per
 * tab. `.panel-fade` fades ONLY this inner content (reduced motion snaps); the panel frame and the
 * board never move, so the frozen Clues view stays pixel-identical, it just fades. `idBase`
 * namespaces the aria tabpanel ids so aria-labelledby resolves per surface.
 */
function TabbedBody({
  tab,
  idBase,
  clues,
}: {
  tab: AnalysisTab;
  idBase: string;
  clues: React.ReactNode;
}) {
  const isAnalysis = tab.value === "analysis";
  return (
    <div
      key={tab.value}
      role="tabpanel"
      id={`${idBase}-panel-${tab.value}`}
      aria-labelledby={`${idBase}-tab-${tab.value}`}
      className="panel-fade flex min-h-0 flex-1 flex-col motion-reduce:animate-none"
    >
      {isAnalysis ? tab.content : clues}
    </div>
  );
}

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
export function ClueStrip({
  clue,
  hidden = false,
}: {
  clue: Clue | undefined;
  /** Hidden on desktop while the check-vote Proscenium takes the strip's band (it replaces this
   * chrome, then returns it on close). The mobile clue bar is untouched. */
  hidden?: boolean;
}) {
  return (
    <div
      className={`${hidden ? "md:hidden" : "md:flex"} hidden items-baseline px-4 py-1.5 border-b border-dashed border-border-dashed`}
    >
      {clue ? (
        <>
          <span className="w-[5ch] shrink-0 text-2 font-semibold text-text-muted tabular-nums">
            {clue.number}
            {DIR_ABBR[clue.direction]}
          </span>
          <span className="min-w-0 text-4 font-medium text-text">
            <ClueText clue={clue} />
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
 *
 * Completion does not replace this bar: clue navigation stays live on a frozen board (DESIGN.md
 * section 5), and Analysis is available beside Clues in the sheet's completed-state tabs.
 */
export function ClueBar({
  clue,
  completed,
  onOpen,
  onPrev,
  onNext,
}: {
  clue: Clue | undefined;
  completed?: boolean | undefined;
  onOpen: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="md:hidden flex items-stretch border-b border-dashed border-border-dashed">
      <Button
        variant="ghost"
        size="icon-lg"
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
        aria-label={
          completed ? "Show all clues and analysis" : "Show all clues"
        }
      >
        {clue ? (
          <>
            <span className="shrink-0 text-2 font-semibold text-text-muted tabular-nums">
              {clue.number}
              {DIR_ABBR[clue.direction]}
            </span>
            <span className="min-w-0 truncate text-3 font-medium text-text">
              <ClueText clue={clue} />
            </span>
          </>
        ) : (
          <span className="text-3 text-text-subtle">No word on this axis</span>
        )}
        <ListBulletIcon className="ml-auto shrink-0 text-text-subtle" />
      </button>
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={onNext}
        aria-label="Next clue"
        className="self-center"
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

/** The responsive active-clue chrome. It is deliberately status-stable: completing a room freezes
 * mutations, not clue navigation, so neither the desktop strip nor mobile bar is unmounted. */
export function ActiveClueHeader({
  clue,
  completed,
  hideStripOnDesktop = false,
  onOpen,
  onPrev,
  onNext,
}: {
  clue: Clue | undefined;
  completed: boolean;
  /** Hide the desktop clue strip while the vote Proscenium occupies its band. */
  hideStripOnDesktop?: boolean;
  onOpen: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <ClueStrip clue={clue} hidden={hideStripOnDesktop} />
      <ClueBar
        clue={clue}
        completed={completed}
        onOpen={onOpen}
        onPrev={onPrev}
        onNext={onNext}
      />
    </>
  );
}

/** Past this many teammates on one clue the row shows a +N instead of more dots. Matches the
 * solving-now block's grouped-cluster cap so the two presence surfaces count crowds alike. */
const PRESENCE_CAP = 2;

/** Teammate presence at a clue row's right edge: one small colored dot per person on the clue,
 * capped with a +N, the same overlap-and-count vocabulary the solving-now block uses for a
 * crowded clue, shrunk to a marker. No initial (color alone reads at this size; the block above
 * owns names) and no self (your position is the amber row). It is absolutely positioned so it
 * rides the prose column's right padding without narrowing it: the clue text still wraps as it
 * did and the whole row stays the click target. Rendered at full strength even on a dimmed
 * (solved) row, since "someone is here" outranks the crossed-off treatment. */
function PresenceDots({ people }: { people: readonly SolverEntry[] }) {
  const shown = people.slice(0, PRESENCE_CAP);
  const extra = people.length - shown.length;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center"
    >
      <span className="flex -space-x-1">
        {shown.map((s) => (
          <span
            key={s.userId}
            className="h-[7px] w-[7px] rounded-full ring-1 ring-panel"
            style={{ background: s.color }}
          />
        ))}
      </span>
      {extra > 0 && (
        <span className="ml-0.5 text-1 font-semibold leading-none text-text-subtle tabular-nums">
          +{extra}
        </span>
      )}
    </span>
  );
}

/** One direction's list, v2's rows: a right-aligned number gutter, then the prose. The
 * active row is amber-5 on your axis and amber-3 on the crossing one, the same language
 * as the board's active word and cross-reference tints. A clue the active clue references
 * gets a quiet amber-3/40 wash, a step below the crossing row's solid amber-3, so it reads
 * as "look here" without competing with the selection. A solved row (every cell filled)
 * sits back like a crossed-off newsprint entry and recovers on hover; the active and
 * crossing rows never dim. Teammate presence dots ride the row's right edge (see
 * PresenceDots) and outlast the dimming. */
function ClueList({
  title,
  clues,
  activeNumber,
  isCurrentAxis,
  filled,
  presence,
  referenced,
  onJump,
}: {
  title: string;
  clues: readonly Clue[];
  activeNumber: number | null;
  isCurrentAxis: boolean;
  filled?: ReadonlySet<number> | undefined;
  presence?: CluePresence | undefined;
  referenced?: ReferencedClues | undefined;
  onJump: (clue: Clue) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeNumber, isCurrentAxis]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 py-1 text-center">
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
          const isRef =
            !active && referenced?.has(`${c.direction}-${c.number}`);
          const solved =
            !active &&
            filled !== undefined &&
            c.cells.every((cell) => filled.has(cell));
          const onClue = presence?.get(`${c.direction}-${c.number}`);
          // The dimming lives on the content spans, not the whole button, so presence dots
          // keep full strength on a solved row (a child can never exceed its parent's opacity).
          const dim = solved && "opacity-40 group-hover:opacity-100";
          return (
            <li key={`${c.direction}-${c.number}`}>
              <button
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => onJump(c)}
                className={cx(
                  "group relative grid grid-cols-[3.2ch_1fr] w-full text-left cursor-pointer",
                  active
                    ? isCurrentAxis
                      ? "bg-amber-5"
                      : "bg-amber-3"
                    : isRef
                      ? "bg-amber-3/40 hover:bg-amber-3"
                      : "hover:bg-amber-3",
                )}
              >
                <span
                  className={cx(
                    "py-1 pr-1.5 text-right text-2 font-semibold tabular-nums",
                    active ? "text-text" : "text-text-muted",
                    dim,
                  )}
                >
                  {c.number}
                </span>
                <span className={cx("py-1 pl-2 pr-4 text-2 text-text", dim)}>
                  <ClueText clue={c} />
                </span>
                {onClue !== undefined && <PresenceDots people={onClue} />}
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
  presence,
  referenced,
  solvingNow,
  analysisTab,
  onJump,
}: {
  across: readonly Clue[];
  down: readonly Clue[];
  activeAcross: number | null;
  activeDown: number | null;
  currentDirection: Direction;
  filled?: ReadonlySet<number> | undefined;
  presence?: CluePresence | undefined;
  referenced?: ReferencedClues | undefined;
  solvingNow?: React.ReactNode;
  /** Present only once the room is completed; absent leaves the rail byte-identical to today. */
  analysisTab?: AnalysisTab | undefined;
  onJump: (clue: Clue) => void;
}) {
  // The frozen Clues body, unchanged. When the tab exists it becomes the "clues" child of the fade
  // switch; when it does not, it renders directly, so the solving rail is exactly as it was.
  const cluesBody = (
    <div className="grid grid-rows-2 wide:grid-rows-1 wide:grid-cols-2 min-h-0 flex-1">
      <div className="flex min-h-0 border-b border-dashed border-border-dashed wide:border-b-0 wide:border-r">
        <ClueList
          title="Across"
          clues={across}
          activeNumber={activeAcross}
          isCurrentAxis={currentDirection === "across"}
          filled={filled}
          presence={presence}
          referenced={referenced}
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
          presence={presence}
          referenced={referenced}
          onJump={onJump}
        />
      </div>
    </div>
  );

  return (
    <div className="hidden md:flex ultra:hidden flex-col min-h-0 h-full border-l border-dashed border-border-dashed">
      {analysisTab !== undefined ? (
        <>
          <PanelTabs
            value={analysisTab.value}
            onChange={analysisTab.onChange}
            variant="rail"
            idBase="rail"
          />
          {analysisTab.value === "clues" && solvingNow}
          <TabbedBody tab={analysisTab} idBase="rail" clues={cluesBody} />
        </>
      ) : (
        <>
          {solvingNow}
          {cluesBody}
        </>
      )}
    </div>
  );
}

/** One axis inside the dock: the caps label, the dashed rule, then a newspaper block of
 * clue rows (styles.css `.clue-dock-list`). The block is fixed-height and multi-column, so
 * clues fill a column top to bottom and flow rightward, wrapping to two or three lines and
 * never eliding; past the region's width the columns overflow and the block scrolls sideways.
 * The active row is scrolled into view horizontally (`inline: "nearest"`), the dock's answer
 * to the rail's vertical auto-scroll. Each region owns its own scroll, so Across and Down
 * never fight over one scroll position.
 *
 * The row markup is a deliberate twin of ClueList's row, not a shared extraction: a sibling
 * track is adding presence dots inside ClueList's row, so keeping the dock's row separate
 * lets both land without a merge across the same JSX. It speaks the same vocabulary (right
 * gutter, amber-5 on your axis, amber-3 crossing, solved rows dimmed with hover recovery). */
function DockAxis({
  title,
  clues,
  activeNumber,
  isCurrentAxis,
  filled,
  presence,
  referenced,
  onJump,
  className,
}: {
  title: string;
  clues: readonly Clue[];
  activeNumber: number | null;
  isCurrentAxis: boolean;
  filled?: ReadonlySet<number> | undefined;
  presence?: CluePresence | undefined;
  referenced?: ReferencedClues | undefined;
  onJump: (clue: Clue) => void;
  className?: string;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeNumber, isCurrentAxis]);

  return (
    <div className={cx("flex flex-col min-h-0 min-w-0 flex-1", className)}>
      <div className="px-4 py-1 text-center">
        <span className="text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-text">
          {title}
        </span>
      </div>
      <Divider />
      <ul className="clue-dock-list list-none m-0 p-0 min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-3 py-1">
        {clues.length === 0 && (
          <li className="px-1 py-2 text-2 text-text-subtle">
            No clues on this axis.
          </li>
        )}
        {clues.map((c) => {
          const active = c.number === activeNumber;
          const isRef =
            !active && referenced?.has(`${c.direction}-${c.number}`);
          const solved =
            !active &&
            filled !== undefined &&
            c.cells.every((cell) => filled.has(cell));
          const onClue = presence?.get(`${c.direction}-${c.number}`);
          // Same treatment as ClueList: dimming on the content spans, not the button, so a
          // solved row's presence dots keep full strength.
          const dim = solved && "opacity-40 group-hover:opacity-100";
          return (
            <li
              key={`${c.direction}-${c.number}`}
              className="break-inside-avoid"
            >
              <button
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => onJump(c)}
                className={cx(
                  "group relative grid grid-cols-[3.2ch_1fr] w-full text-left cursor-pointer",
                  active
                    ? isCurrentAxis
                      ? "bg-amber-5"
                      : "bg-amber-3"
                    : isRef
                      ? "bg-amber-3/40 hover:bg-amber-3"
                      : "hover:bg-amber-3",
                )}
              >
                <span
                  className={cx(
                    "py-1 pr-1.5 text-right text-2 font-semibold tabular-nums",
                    active ? "text-text" : "text-text-muted",
                    dim,
                  )}
                >
                  {c.number}
                </span>
                <span className={cx("py-1 pl-2 pr-4 text-2 text-text", dim)}>
                  <ClueText clue={c} />
                </span>
                {onClue !== undefined && <PresenceDots people={onClue} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The ultrawide response (only at `ultra`): the rail rotates into a full-width dock under
 * the board, separated by the same dashed rule. Solving-now leads as a column, then Across
 * and Down as their own newspaper regions, each split off by the dashed vertical rule. The
 * board math (why `ultra` is 137.5rem, why the dock is bounded at 22rem) lives with the token
 * in styles.css. The solving-now column collapses out entirely in a solo game, where the
 * SolvingNow block renders nothing and `empty:hidden` takes its rule with it. */
export function ClueDock({
  across,
  down,
  activeAcross,
  activeDown,
  currentDirection,
  filled,
  presence,
  referenced,
  solvingNow,
  analysisTab,
  onJump,
}: {
  across: readonly Clue[];
  down: readonly Clue[];
  activeAcross: number | null;
  activeDown: number | null;
  currentDirection: Direction;
  filled?: ReadonlySet<number> | undefined;
  presence?: CluePresence | undefined;
  referenced?: ReferencedClues | undefined;
  solvingNow?: React.ReactNode;
  /** Present only once the room is completed; absent leaves the dock byte-identical to today. */
  analysisTab?: AnalysisTab | undefined;
  onJump: (clue: Clue) => void;
}) {
  // The frozen dock body, unchanged: solving-now column, then the two newspaper axes.
  const dockBody = (
    <div className="flex min-h-0 flex-1">
      <div className="empty:hidden shrink-0 w-[20rem] overflow-y-auto border-r border-dashed border-border-dashed">
        {solvingNow}
      </div>
      <DockAxis
        title="Across"
        clues={across}
        activeNumber={activeAcross}
        isCurrentAxis={currentDirection === "across"}
        filled={filled}
        presence={presence}
        referenced={referenced}
        onJump={onJump}
        className="border-r border-dashed border-border-dashed"
      />
      <DockAxis
        title="Down"
        clues={down}
        activeNumber={activeDown}
        isCurrentAxis={currentDirection === "down"}
        filled={filled}
        presence={presence}
        referenced={referenced}
        onJump={onJump}
      />
    </div>
  );

  if (analysisTab === undefined) {
    return (
      <div className="clue-dock hidden ultra:flex min-h-0 border-t border-dashed border-border-dashed">
        {dockBody}
      </div>
    );
  }

  // Completed: the tab header caps the dock, and the Analysis panel replaces the axes. The Analysis
  // body is centered to a readable measure so it does not stretch across the whole ultrawide dock.
  return (
    <div className="clue-dock hidden ultra:flex min-h-0 flex-col border-t border-dashed border-border-dashed">
      <PanelTabs
        value={analysisTab.value}
        onChange={analysisTab.onChange}
        variant="rail"
        idBase="dock"
      />
      {analysisTab.value === "clues" ? (
        <TabbedBody tab={analysisTab} idBase="dock" clues={dockBody} />
      ) : (
        <div
          key="analysis"
          role="tabpanel"
          id="dock-panel-analysis"
          aria-labelledby="dock-tab-analysis"
          className="panel-fade flex min-h-0 flex-1 justify-center motion-reduce:animate-none"
        >
          <div className="w-full max-w-[34rem]">{analysisTab.content}</div>
        </div>
      )}
    </div>
  );
}

/** Mobile bottom sheet: both lists, a drag-handle header, dismissed by the scrim or the close. Once
 * a room is completed it carries the same [Clues | Analysis] segmented control at its head and the
 * Analysis panel, the iOS-style sheet the mock shows; mid-solve it is byte-identical to today. */
export function ClueSheet({
  open,
  onClose,
  across,
  down,
  activeAcross,
  activeDown,
  currentDirection,
  filled,
  presence,
  referenced,
  analysisTab,
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
  presence?: CluePresence | undefined;
  referenced?: ReferencedClues | undefined;
  /** Present only once the room is completed; absent leaves the sheet byte-identical to today. */
  analysisTab?: AnalysisTab | undefined;
  onJump: (clue: Clue) => void;
}) {
  const jumpAndClose = (clue: Clue): void => {
    onJump(clue);
    onClose();
  };

  // The frozen two-list Clues body, unchanged.
  const cluesBody = (
    <div className="grid grid-rows-2 min-h-0 flex-1">
      <div className="flex min-h-0 border-b border-dashed border-border-dashed">
        <ClueList
          title="Across"
          clues={across}
          activeNumber={activeAcross}
          isCurrentAxis={currentDirection === "across"}
          filled={filled}
          presence={presence}
          referenced={referenced}
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
          presence={presence}
          referenced={referenced}
          onJump={jumpAndClose}
        />
      </div>
    </div>
  );

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
        {analysisTab !== undefined ? (
          // Completed: the grabber, the segmented control at the head, then the faded body. The
          // title collapses into the SheetTitle for a11y (screen readers still announce the sheet)
          // while the segmented control is the visible header the mock shows.
          <>
            <SheetHeader className="relative gap-0 p-0 px-3 pt-3 pb-1">
              <span className="absolute left-1/2 -translate-x-1/2 top-1.5 h-1 w-9 rounded-full bg-border-strong" />
              <SheetTitle className="sr-only">Clues and Analysis</SheetTitle>
              <div className="mt-2 flex items-center gap-2">
                <PanelTabs
                  value={analysisTab.value}
                  onChange={analysisTab.onChange}
                  variant="segment"
                  idBase="sheet"
                  className="flex-1"
                />
                <SheetClose asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Close">
                    <Cross2Icon />
                  </Button>
                </SheetClose>
              </div>
            </SheetHeader>
            <TabbedBody tab={analysisTab} idBase="sheet" clues={cluesBody} />
          </>
        ) : (
          <>
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
            {cluesBody}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
