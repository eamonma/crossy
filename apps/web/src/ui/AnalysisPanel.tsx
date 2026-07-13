// The Analysis tab's content: the solve, read back. It renders the bundle GET /games/{id}/analysis
// ships (owners + momentum + moments) in the app's panel language, matching the ratified mock:
//   - a caps eyebrow ("SOLVED TOGETHER") over a tabular stat line (duration, solvers, entries)
//   - a legend of solvers in the mosaic's exact colors (self reads "You")
//   - the momentum ribbon with the stall and the break
//   - two moment cards, "First to fall" and "Last square", each just the author's colored dot and
//     name. Neither shows a time: on real data firstToFall is always at t=0 and lastSquare is always
//     the full duration (already in the header), so a number there would be meaningless or redundant
//     (engine analysis.ts, vectors/analysis/moments.json). "The unlock"
//     is a fast-follow with no v1 data, so it is NOT rendered; the turning point lives on the ribbon
//     as the break.
//   - a Replay control that re-blooms the board's mosaic (the caller owns the bloom edge).
//
// The one law (ANALYSIS.md): moments may be judged, people are never scored against each other. No
// leaderboard, no rate, no ranking; a name appears only as the incidental author of a moment.
//
// Degenerate solves collapse cleanly: a null moment hides its card (never a gap where a third was),
// an all-zero momentum draws a flat ribbon, and the summary duration reads a real M:SS, never NaN.
import { useMemo } from "react";
import type { StackMember } from "./primitives";
import { CapsLabel, cx, Divider } from "./primitives";
import { rosterOf } from "./completionAttribution";
import type { AnalysisResponse } from "./completionAttribution";
import {
  analysisSummary,
  colorOf,
  legendSolvers,
  nameOf,
} from "./analysisReadout";
import { MomentumRibbon } from "./MomentumRibbon";

/** A colored presence dot, the legend's and the moment card's shared marker. Falls back to a neutral
 * sand dot when the id resolves to no color (a member who left the snapshot), never a crash. */
function Dot({ color, size = 10 }: { color: string | null; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color ?? "var(--color-sand-8)",
      }}
    />
  );
}

/** One moment card: the caps label and the author's dot + name.
 *
 * No numeric time here on purpose. On real data (engine analysis.ts, vectors/analysis/moments.json)
 * both beats are timing-degenerate: firstToFall.atSeconds is always 0 (the earliest fill, measured
 * relative to itself), and lastSquare.atSeconds always equals momentum.durationSeconds (the last
 * fill = tEnd), which the summary header already shows. Rendering either number would print a
 * meaningless "0:00" or a second copy of the duration. So a moment names only the person and the beat
 * (the label carries the meaning). The one law: moments may be judged, people are never scored
 * against each other, so this stays celebratory, never a rate or a rank.
 *
 * Rendered only when its datum exists, so a degenerate solve simply shows fewer cards, never an
 * empty row. */
function Moment({
  label,
  members,
  roster,
  selfId,
  userId,
}: {
  label: string;
  members: readonly StackMember[];
  roster: ReturnType<typeof rosterOf>;
  selfId: string | null;
  userId: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Dot color={colorOf(roster, userId)} size={10} />
      <div className="min-w-0">
        <CapsLabel className="text-text-subtle">{label}</CapsLabel>
        <div className="mt-0.5 text-2 text-text font-medium">
          {nameOf(members, userId, selfId)}
        </div>
      </div>
    </div>
  );
}

/**
 * The Analysis tab body. Scrolls within the panel; the caller frames it (the rail replaces its clue
 * lists with this, the sheet stacks it under the segmented control). `onReplay` re-blooms the board.
 */
export function AnalysisPanel({
  bundle,
  members,
  selfId,
  onReplay,
  idBase,
  className,
}: {
  bundle: AnalysisResponse;
  members: readonly StackMember[];
  selfId: string | null;
  /** Re-trigger the board's mosaic bloom. Absent surfaces (a preview with no board) omit it. */
  onReplay?: (() => void) | undefined;
  /** Namespaces the ribbon's gradient def so two instances never collide. */
  idBase: string;
  className?: string;
}) {
  const roster = useMemo(() => rosterOf(members), [members]);
  const summary = useMemo(() => analysisSummary(bundle), [bundle]);
  const legend = useMemo(
    () => legendSolvers(bundle, members, selfId),
    [bundle, members, selfId],
  );

  const { firstToFall, lastSquare } = bundle.moments;

  return (
    <div className={cx("min-h-0 flex-1 overflow-y-auto px-4 py-4", className)}>
      {/* Eyebrow + the tabular stat line. */}
      <div className="flex items-baseline justify-between gap-3">
        <CapsLabel className="text-gold-11">Solved together</CapsLabel>
        <span className="font-mono text-1 text-text-subtle tabular-nums">
          {summary.durationLabel} · {summary.solverCount}{" "}
          {summary.solverCount === 1 ? "solver" : "solvers"} ·{" "}
          {summary.entryCount} {summary.entryCount === 1 ? "entry" : "entries"}
        </span>
      </div>

      {/* Legend + Replay: the room in the mosaic's colors, and the button to re-bloom the board. */}
      <div className="mt-3 flex items-start justify-between gap-3">
        <ul className="flex flex-wrap gap-x-3.5 gap-y-1.5 m-0 p-0 list-none">
          {legend.map((s) => (
            <li
              key={s.userId}
              className="inline-flex items-center gap-1.5 text-2 text-text-muted"
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: s.color }}
              />
              <span className={cx(s.self ? "text-text font-medium" : "")}>
                {s.name}
              </span>
            </li>
          ))}
        </ul>
        {onReplay !== undefined && (
          <button
            type="button"
            onClick={onReplay}
            className={cx(
              "shrink-0 whitespace-nowrap rounded-full border border-border px-2.5 py-1 text-1 font-medium text-text",
              "hover:bg-gold-3 hover:border-focus-ring transition-colors duration-[var(--duration-fast)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1",
            )}
          >
            Replay
          </button>
        )}
      </div>
      <p className="mt-2 text-1 leading-relaxed text-text-subtle">
        Each square shows who solved it first.
      </p>

      {/* Momentum. */}
      <CapsLabel className="mt-6 mb-2.5 block text-text-subtle">
        The room's tempo
      </CapsLabel>
      <MomentumRibbon bundle={bundle} idBase={idBase} />

      {/* Moments: only the cards with data. Never a placeholder for the absent unlock. */}
      {(firstToFall !== null || lastSquare !== null) && (
        <>
          <CapsLabel className="mt-6 mb-1 block text-text-subtle">
            Moments
          </CapsLabel>
          <div>
            {firstToFall !== null && (
              <Moment
                label="First to fall"
                members={members}
                roster={roster}
                selfId={selfId}
                userId={firstToFall.userId}
              />
            )}
            {firstToFall !== null && lastSquare !== null && <Divider />}
            {lastSquare !== null && (
              <Moment
                label="Last square"
                members={members}
                roster={roster}
                selfId={selfId}
                userId={lastSquare.userId}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The loading and absent states, in the same panel padding, so the tab never flashes empty or errors
 * out to a player who just finished. Absent is the never-completed 404 or a failed fetch. */
export function AnalysisPanelPlaceholder({
  state,
}: {
  state: "loading" | "absent";
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
      <CapsLabel className="text-gold-11">Solved together</CapsLabel>
      <p className="mt-2 text-2 text-text-subtle">
        {state === "loading"
          ? "Loading…"
          : "Analysis isn't available for this game."}
      </p>
    </div>
  );
}
