// The Analysis tab's content: the solve, read back. It renders the bundle GET /games/{id}/analysis
// ships (owners + momentum + moments) in the app's panel language:
//   - a caps eyebrow ("SOLVED TOGETHER") over a three-cell stat block (time, solvers, squares), the
//     salient headline the retired completion popup used to carry.
//   - a legend of solvers in the mosaic's exact colors (self reads "You")
//   - the momentum ribbon with a plain gloss of what the shaded pause and the marker mean
//   - two moment cards, "First square" and "Last square", each just the author's colored dot and
//     name. Neither shows a time: on real data firstToFall is always at t=0 and lastSquare is always
//     the full duration (already in the stat block), so a number there would be meaningless or
//     redundant (engine analysis.ts, vectors/analysis/moments.json). "The unlock" is a fast-follow
//     with no v1 data, so it is NOT rendered; the turning point lives on the ribbon as the marker.
//
// The one law (ANALYSIS.md): moments may be judged, people are never scored against each other. No
// leaderboard, no rate, no ranking; a name appears only as the incidental author of a moment.
//
// Degenerate solves collapse cleanly: a null moment hides its card (never a gap where a third was),
// an all-zero momentum draws a flat ribbon, and the stat block's time reads a real M:SS, never NaN.
import { useMemo } from "react";
import { PauseIcon, PlayIcon } from "@radix-ui/react-icons";
import type { StackMember } from "./primitives";
import { CapsLabel, cx, Divider } from "./primitives";
import { rosterOf } from "./completionAttribution";
import type { AnalysisResponse } from "./completionAttribution";
import {
  analysisSummary,
  colorOf,
  legendSolvers,
  momentumHasSignal,
  nameOf,
} from "./analysisReadout";
import { MomentumRibbon } from "./MomentumRibbon";
import { useTheme } from "./useTheme";
import { Button } from "@/components/ui/button";

/** The replay transport wired into the panel: the shared clock's current head, whether it is
 * running, and the two controls. Optional and inert when absent, so the phone sheet (which cannot
 * show the board beside the ribbon) renders the panel with no transport. */
export interface ReplayControls {
  /** The head in relative seconds, or null when not replaying (board rests on the full mosaic). */
  readonly time: number | null;
  readonly playing: boolean;
  /** The solve's real length, so the transport can hide for a single-instant solve. */
  readonly durationSeconds: number;
  onToggle(): void;
  onSeek(t: number): void;
}

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
  idBase,
  className,
  replay,
}: {
  bundle: AnalysisResponse;
  members: readonly StackMember[];
  selfId: string | null;
  /** Namespaces the ribbon's gradient def so two instances never collide. */
  idBase: string;
  className?: string;
  /** The replay transport, present only where the board and ribbon are co-visible (the rail and the
   * dock). Absent on the phone sheet, which covers the board, so the ribbon shows no playhead. */
  replay?: ReplayControls | undefined;
}) {
  // The ground the identity palette resolves against: the mosaic, the legend, and the moment dots all
  // read the same theme so they paint one player one color (and match iOS). Rebuilds on a theme flip.
  const isDark = useTheme().theme === "dark";
  const roster = useMemo(() => rosterOf(members, isDark), [members, isDark]);
  const summary = useMemo(() => analysisSummary(bundle), [bundle]);
  const legend = useMemo(
    () => legendSolvers(bundle, members, selfId, isDark),
    [bundle, members, selfId, isDark],
  );

  const { firstToFall, lastSquare } = bundle.moments;

  // The transport rides only where there is a solve to replay: a real duration and a shaped series.
  // A single-instant solve has one instant, so no play button and no scrub (nothing to fill in).
  const canReplay =
    replay !== undefined &&
    replay.durationSeconds > 0 &&
    momentumHasSignal(bundle.momentum.samples);

  // The salient headline the retired completion popup used to carry: time, solvers, squares. Sourced
  // from the bundle (not the wire stats), so the tab and the mosaic can never disagree on the counts.
  const stats: { key: string; label: string; value: string }[] = [
    { key: "time", label: "Time", value: summary.durationLabel },
    { key: "solvers", label: "Solvers", value: String(summary.solverCount) },
    { key: "squares", label: "Squares", value: String(summary.entryCount) },
  ];

  return (
    <div className={cx("min-h-0 flex-1 overflow-y-auto px-4 py-4", className)}>
      <CapsLabel className="text-gold-11">Solved together</CapsLabel>

      {/* The stat block: three cells split by the app's dashed rule, big tabular numerals. This is the
          headline of the tab, so it reads at a glance the way the popup's stat row did. */}
      <dl className="m-0 mt-3 grid grid-cols-3 overflow-hidden rounded-3 border border-border">
        {stats.map((cell, i) => (
          <div
            key={cell.key}
            className={cx(
              "flex flex-col items-center gap-1 px-2 py-3.5",
              i > 0 && "border-l border-dashed border-border-dashed",
            )}
          >
            <dt>
              <CapsLabel className="text-text-subtle">{cell.label}</CapsLabel>
            </dt>
            <dd className="m-0 font-mono text-5 text-text tabular-nums">
              {cell.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Legend: the room in the mosaic's exact colors, so the board's wash is legible by name. */}
      <ul className="mt-4 flex flex-wrap gap-x-3.5 gap-y-1.5 m-0 p-0 list-none">
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
      <p className="mt-2 text-1 leading-relaxed text-text-subtle">
        Each square shows who solved it first.
      </p>

      {/* Momentum: the tempo, plus a plain gloss so the shaded pause and the marker read on their own.
          Where the board is co-visible (the rail and the dock) the ribbon doubles as a replay
          transport: a play button and a draggable playhead fill the board in solve order. */}
      <div className="mt-6 mb-2.5 flex items-center justify-between gap-2">
        <CapsLabel className="block text-text-subtle">
          The room's tempo
        </CapsLabel>
        {canReplay && replay !== undefined && (
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={replay.onToggle}
            aria-label={
              replay.playing ? "Pause the replay" : "Play the solve replay"
            }
          >
            {replay.playing ? <PauseIcon /> : <PlayIcon />}
          </Button>
        )}
      </div>
      <MomentumRibbon
        bundle={bundle}
        idBase={idBase}
        durationSeconds={canReplay ? replay!.durationSeconds : 0}
        replayTime={canReplay ? replay!.time : null}
        playing={canReplay ? replay!.playing : false}
        onSeek={canReplay ? replay!.onSeek : undefined}
      />
      <p className="mt-2 text-1 leading-relaxed text-text-subtle">
        Height tracks solving speed. The shaded span is the room's longest
        pause; the marker is where solving picked back up.
        {canReplay ? " Play or drag the ribbon to replay the solve." : ""}
      </p>

      {/* Moments: only the cards with data. Never a placeholder for the absent unlock. */}
      {(firstToFall !== null || lastSquare !== null) && (
        <>
          <CapsLabel className="mt-6 mb-1 block text-text-subtle">
            Moments
          </CapsLabel>
          <div>
            {firstToFall !== null && (
              <Moment
                label="First square"
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
