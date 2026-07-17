// The Analysis tab's content: the solve, read back. It renders the bundle GET /games/{id}/analysis
// ships (owners + momentum + moments) in the app's panel language:
//   - a caps eyebrow ("SOLVED TOGETHER") over a three-cell stat block (time, solvers, squares), the
//     salient headline the retired completion popup used to carry.
//   - a legend of solvers in the mosaic's exact colors (self reads "You")
//   - the momentum ribbon with a plain gloss of what the shaded pause and the marker mean
//   - the Titles section (TITLES.md): one card per titled solver, dot + name + the title's caps
//     label + its evidence line. Titles replaced the person moment cards ("First square", "Last
//     square"), whose stories live on as the quick-starter and closer rungs; the turning point
//     stays on the ribbon as the marker. Copy and evidence formatting live in titlesReadout.ts;
//     an unknown key from a newer server is dropped there (PROTOCOL §12), and an empty titles
//     array (a solo solve, or an older API) renders no section at all.
//
// The one law (ANALYSIS.md, amended for titles): titles count, they never interpret, and people
// are never scored against each other. No leaderboard, no rate, no shared axis; a card cites only
// its own number.
//
// Degenerate solves collapse cleanly: an empty titles array hides the section, an all-zero
// momentum draws a flat ribbon, and the stat block's time reads a real M:SS, never NaN.
import { Fragment, useMemo } from "react";
import { PauseIcon, PlayIcon } from "@radix-ui/react-icons";
import type { StackMember } from "./primitives";
import { CapsLabel, cx, Divider } from "./primitives";
import { rosterOf } from "./completionAttribution";
import type { AnalysisResponse } from "./completionAttribution";
import {
  analysisSummary,
  legendSolvers,
  momentumHasSignal,
} from "./analysisReadout";
import { titleCards } from "./titlesReadout";
import type { TitleCard } from "./titlesReadout";
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

/** The legend's isolation wiring (owner ruling): tapping a solver's row spotlights their squares
 * on the mosaic; the same row again clears, a different row switches. The state lives on the
 * parent (LiveGame) beside the replay clock, so every copy of the panel — rail, dock, sheet —
 * drives the one mosaic. Optional and inert when absent: the legend renders plain rows. */
export interface IsolationControl {
  /** The solver currently isolated on the mosaic, or null when the full wash shows. */
  readonly isolatedId: string | null;
  /** Toggle isolation for a tapped legend row (nextIsolation semantics, mosaicIsolation.ts). */
  onToggle(userId: string): void;
}

/** A colored presence dot, the legend's and the title card's shared marker. Falls back to a neutral
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

/** One title card: the caps label ("THE SABOTEUR"), the solver's dot + name, and the evidence
 * line, the exact idiom the moment cards carried (dot + eyebrow + name) plus one subtle line for
 * the number the title cites. The amended law: a title cites its own evidence and nothing else, so
 * the detail is a single fact ("Overwrote 7 correct squares"), never a rate or two people's
 * numbers together. A rung with no evidence (the wanderer) carries its fixed line; a numeric rung
 * whose number is missing drops the line rather than printing a blank. */
function TitleRow({ card }: { card: TitleCard }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Dot color={card.color} size={10} />
      <div className="min-w-0">
        <CapsLabel className="text-text-subtle">{card.label}</CapsLabel>
        <div className="mt-0.5 text-2 text-text font-medium">{card.name}</div>
        {card.detail !== null && (
          <div className="mt-0.5 text-1 leading-relaxed text-text-subtle">
            {card.detail}
          </div>
        )}
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
  isolation,
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
  /** The legend's isolation wiring, shared across every copy of the panel. Absent (a caller with
   * no mosaic to drive) leaves the legend as plain rows. */
  isolation?: IsolationControl | undefined;
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

  // The titles, resolved to render-ready cards (wire order = ladder rank; unknown keys dropped,
  // the PROTOCOL §12 MUST-ignore rule). Empty means no section, never an empty-state box.
  const titles = useMemo(
    () => titleCards(bundle.titles, members, selfId, roster),
    [bundle, members, selfId, roster],
  );

  // The transport rides only where there is a solve to replay: a real duration and a shaped series.
  // A single-instant solve has one instant, so no play button and no scrub (nothing to fill in).
  const canReplay =
    replay !== undefined &&
    replay.durationSeconds > 0 &&
    momentumHasSignal(bundle.momentum.samples);

  // The salient headline the retired completion popup used to carry: time, solvers, squares. Sourced
  // from the bundle (not the wire stats), so the tab and the mosaic can never disagree on the counts.
  // Time is active time (D29: the bundle's durationSeconds is on the active axis by contract), with
  // the sitting count as quiet context under it, never a second stat.
  const stats: {
    key: string;
    label: string;
    value: string;
    context: string | null;
  }[] = [
    {
      key: "time",
      label: "Time",
      value: summary.durationLabel,
      context: summary.sittingsContext,
    },
    {
      key: "solvers",
      label: "Solvers",
      value: String(summary.solverCount),
      context: null,
    },
    {
      key: "squares",
      label: "Squares",
      value: String(summary.entryCount),
      context: null,
    },
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
            {/* The sitting count, quiet context under the headline time, never a second stat
                (D29): present only when the room sat down more than once. */}
            {cell.context !== null && (
              <div className="text-1 text-text-subtle">{cell.context}</div>
            )}
          </div>
        ))}
      </dl>

      {/* Legend: the room in the mosaic's exact colors, so the board's wash is legible by name.
          With isolation wired, each row is a toggle button: pressing it spotlights that solver's
          squares on the mosaic (the same row again clears, another row switches; your own row is
          how you isolate yourself). The pressed state is the app's quiet sand-3 tint (the ghost
          button's expanded face), no new chrome. */}
      <ul className="mt-4 flex flex-wrap gap-x-3.5 gap-y-1.5 m-0 p-0 list-none">
        {legend.map((s) => {
          const chip = (
            <>
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: s.color }}
              />
              <span className={cx(s.self ? "text-text font-medium" : "")}>
                {s.name}
              </span>
            </>
          );
          return (
            <li key={s.userId}>
              {isolation !== undefined ? (
                <button
                  type="button"
                  aria-pressed={isolation.isolatedId === s.userId}
                  onClick={() => isolation.onToggle(s.userId)}
                  className={cx(
                    // Negative margins offset the padding so the resting legend keeps its exact
                    // optical rhythm; the padding exists for the hover/pressed tint and hit area.
                    "-mx-1.5 -my-0.5 inline-flex cursor-pointer items-center gap-1.5 rounded-2 px-1.5 py-0.5 text-2 text-text-muted",
                    "transition-colors duration-[var(--duration-fast)]",
                    "hover:bg-sand-3 hover:text-text aria-pressed:bg-sand-3 aria-pressed:text-text",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                  )}
                >
                  {chip}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-2 text-text-muted">
                  {chip}
                </span>
              )}
            </li>
          );
        })}
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

      {/* Titles: everyone's superlative, one card per titled solver, in ladder-rank order (the
          wire's order; the server walks the pinned ladder, most memorable first). A solo solve
          (or an older API) ships an empty array and the section vanishes entirely, never an
          empty-state box. */}
      {titles.length > 0 && (
        <>
          <CapsLabel className="mt-6 mb-1 block text-text-subtle">
            Titles
          </CapsLabel>
          <div>
            {titles.map((card, i) => (
              <Fragment key={card.userId}>
                {i > 0 && <Divider />}
                <TitleRow card={card} />
              </Fragment>
            ))}
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
