// The solving-now block (desktop rail, above Across): who is here and which clue they
// are on, so presence reads as more than avatar dots. One row per person while the room
// is small; past GROUP_PAST solvers the rows group by clue and cap at GROUP_CAP with a
// tail line, so the block's height is bounded no matter how many people join. The block
// collapses to its header (persisted per user) and never renders in a solo game; the
// dashed rule is its only chrome, the same language as the rest of the rail.
import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@radix-ui/react-icons";
import type { Clue } from "../domain/types";
import type { Roster, SolverEntry } from "./roster";
import { GROUP_CAP, GROUP_PAST, canJump } from "./roster";
import { ClueText } from "./ClueText";
import { CapsLabel, cx } from "./primitives";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const COLLAPSE_KEY = "crossy:solving-now:collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(next: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    // Private-mode storage failures only cost persistence, never the toggle.
  }
}

/**
 * One person's avatar dot. When they hold a live cursor (`canJump`, PROTOCOL.md §4, §9) and
 * the caller wired `onGoTo`, the dot becomes the roster's "Go to" action: a tap moves the
 * camera to their cursor (the same `setSelection` a clue-browser jump already drives, so the
 * grid follows through the ordinary selection-change path). No cursor, or no `onGoTo` wired
 * (PartyView's read-only rail), and the dot stays a plain decorative avatar.
 */
function Dot({
  entry,
  ring = false,
  onGoTo,
}: {
  entry: SolverEntry;
  ring?: boolean;
  onGoTo?: ((entry: SolverEntry) => void) | undefined;
}) {
  // Render the avatar when present; null, loading, and load errors fall back to the colored initial
  // (PROTOCOL.md §4). The color-backed fallback keeps the existing look when there is no image.
  const avatar = (
    <Avatar
      aria-hidden={onGoTo === undefined}
      className={cx("h-5 w-5 shrink-0", ring && "ring-2 ring-panel")}
    >
      {entry.avatarUrl !== null && <AvatarImage src={entry.avatarUrl} alt="" />}
      <AvatarFallback
        className="text-[10px] font-bold text-white"
        style={{ background: entry.color }}
      >
        {entry.initial}
      </AvatarFallback>
    </Avatar>
  );
  if (onGoTo === undefined || !canJump(entry)) return avatar;
  return (
    <button
      type="button"
      onClick={() => onGoTo(entry)}
      className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      aria-label={`Go to ${entry.name}'s cursor`}
    >
      {avatar}
    </button>
  );
}

function ClueTag({ clue }: { clue: Clue }) {
  return (
    <span className="shrink-0 text-1 font-bold text-text-accent tabular-nums">
      {clue.number}
      {clue.direction === "across" ? "A" : "D"}
    </span>
  );
}

function WatchingLine({ watching }: { watching: readonly string[] }) {
  if (watching.length === 0) return null;
  return (
    <div className="pl-7 text-1 text-text-subtle">
      {watching.length === 1
        ? `${watching[0]} is watching`
        : `${watching.length} watching`}
    </div>
  );
}

/**
 * The block's pre-welcome stand-in (LiveApp: REST has landed, the socket is still
 * connecting): the same chrome at the same row heights, sized from REST membership, so
 * the welcome swaps people into a frame that is already standing instead of shoving the
 * clue lists down (or, in the ultra dock, shoving the axes sideways). Membership is the
 * only pre-welcome truth: roles predict the rows, connectedness arrives with the
 * welcome, so a room whose other members are all offline over-reserves and releases the
 * space at the welcome, the rarer path. Renders nothing for a solo room and honors the
 * persisted collapse, exactly like the real block.
 */
export function SolvingNowPlaceholder({
  solverRows,
  watching,
}: {
  /** Solver rows if every member connects: host and solver members, GROUP_PAST-capped. */
  solverRows: number;
  /** True when other members are spectators (reserves the watching line). */
  watching: boolean;
}) {
  const [collapsed] = useState(readCollapsed);
  if (solverRows === 0 && !watching) return null;
  return (
    <div aria-hidden className="border-b border-dashed border-border-dashed">
      <div className="flex items-center gap-2 px-4 py-1">
        <CapsLabel className="text-text">Solving now</CapsLabel>
        {collapsed && (
          <span className="flex -space-x-1.5">
            {Array.from({ length: Math.min(solverRows, 5) }).map((_, i) => (
              <span
                key={i}
                className="skeleton skeleton-shimmer h-5 w-5 shrink-0 rounded-full ring-2 ring-panel"
              />
            ))}
          </span>
        )}
        {/* The collapse chevron's footprint (icon-xs), inert until the block is real. */}
        <span className="ml-auto flex size-[1.25rem] items-center justify-center text-text-subtle">
          {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </span>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-0.5 px-4 pb-2">
          {Array.from({ length: solverRows }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 min-w-0">
              <span className="skeleton skeleton-shimmer h-5 w-5 shrink-0 rounded-full" />
              <span className="skeleton skeleton-shimmer h-3.5 w-24 rounded-1" />
              {/* A real text-2 line box, so this row stands exactly a solver row tall. */}
              <span className="text-2 font-semibold">{"\u00A0"}</span>
            </div>
          ))}
          {watching && (
            <div className="pl-7 text-1 text-text-subtle">{"\u00A0"}</div>
          )}
        </div>
      )}
    </div>
  );
}

export function SolvingNow({
  roster,
  onGoTo,
}: {
  roster: Roster;
  /** Move the camera to a teammate's live cursor (owner's jump-to-friend-cell). Optional: a
   * caller with no camera to move (there is none today) simply leaves every dot decorative. */
  onGoTo?: (entry: SolverEntry) => void;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { solvers, watching, groups } = roster;

  // Solo games carry no presence story: the block only exists once someone else is here.
  const others = solvers.filter((s) => !s.self).length + watching.length;
  if (others === 0) return null;

  const toggle = (): void => {
    setCollapsed((prev) => {
      writeCollapsed(!prev);
      return !prev;
    });
  };

  return (
    <div className="border-b border-dashed border-border-dashed">
      <div className="flex items-center gap-2 px-4 py-1">
        <CapsLabel className="text-text">Solving now</CapsLabel>
        {collapsed && (
          <>
            <span className="flex -space-x-1.5">
              {solvers.slice(0, 5).map((s) => (
                <Dot key={s.userId} entry={s} ring />
              ))}
            </span>
            <span className="text-1 text-text-subtle">
              {solvers.length} solving
              {watching.length > 0 && ` · ${watching.length} watching`}
            </span>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand solving now" : "Collapse solving now"}
          // 44px hit box on the 20px chevron; alone at the row end, so a full square is safe
          // (hit-target, styles.css).
          className="ml-auto text-text-subtle hit-target"
        >
          {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </Button>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-0.5 px-4 pb-2">
          {solvers.length <= GROUP_PAST ? (
            solvers.map((s) => (
              <div key={s.userId} className="flex items-center gap-2 min-w-0">
                <Dot entry={s} onGoTo={onGoTo} />
                <span className="shrink-0 text-2 font-semibold text-text">
                  {s.name}
                </span>
                {s.clue !== null && (
                  <>
                    <ClueTag clue={s.clue} />
                    <span className="min-w-0 truncate text-2 text-text-muted">
                      <ClueText clue={s.clue} />
                    </span>
                  </>
                )}
              </div>
            ))
          ) : (
            <>
              {groups.slice(0, GROUP_CAP).map((g) => (
                <div
                  key={`${g.clue.direction}-${g.clue.number}`}
                  className="flex items-center gap-2 min-w-0"
                >
                  <span className="flex shrink-0 -space-x-1.5">
                    {g.people.slice(0, 2).map((s) => (
                      <Dot key={s.userId} entry={s} ring onGoTo={onGoTo} />
                    ))}
                  </span>
                  {g.people.length > 2 && (
                    <span className="shrink-0 text-1 text-text-subtle tabular-nums">
                      +{g.people.length - 2}
                    </span>
                  )}
                  <ClueTag clue={g.clue} />
                  <span className="min-w-0 truncate text-2 text-text-muted">
                    <ClueText clue={g.clue} />
                  </span>
                </div>
              ))}
              {groups.length > GROUP_CAP && (
                <div className="pl-7 text-1 text-text-subtle">
                  + {groups.length - GROUP_CAP} more clues in progress
                </div>
              )}
            </>
          )}
          <WatchingLine watching={watching} />
        </div>
      )}
    </div>
  );
}
