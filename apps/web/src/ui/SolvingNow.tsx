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
import { GROUP_CAP, GROUP_PAST } from "./roster";
import { CapsLabel, cx } from "./primitives";
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

function Dot({ entry, ring = false }: { entry: SolverEntry; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
        ring && "ring-2 ring-panel",
      )}
      style={{ background: entry.color }}
    >
      {entry.initial}
    </span>
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

export function SolvingNow({ roster }: { roster: Roster }) {
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
                <Dot entry={s} />
                <span className="shrink-0 text-2 font-semibold text-text">
                  {s.name}
                </span>
                {s.clue !== null && (
                  <>
                    <ClueTag clue={s.clue} />
                    <span className="min-w-0 truncate text-2 text-text-muted">
                      {s.clue.text ?? "—"}
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
                      <Dot key={s.userId} entry={s} ring />
                    ))}
                  </span>
                  {g.people.length > 2 && (
                    <span className="shrink-0 text-1 text-text-subtle tabular-nums">
                      +{g.people.length - 2}
                    </span>
                  )}
                  <ClueTag clue={g.clue} />
                  <span className="min-w-0 truncate text-2 text-text-muted">
                    {g.clue.text ?? "—"}
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
