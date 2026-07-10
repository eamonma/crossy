// Party view: a read-only projector screen for a TV across the room (design round 2, Concept N).
// The board is the hero, full and live; a quiet side rail carries the game's name, the shared
// timer, a fill-progress race bar, the solving-now roster, and a QR code that joins the game from
// a phone. It reuses LiveApp's loader and store, so board fills animate in live today and teammate
// cursors light up the moment the presence fan-out track lands (read straight from `store.cursors`
// / `store.participants`). It performs no writes: no key handler, no cursor relay, no upgrade path,
// so the same screen that watches a solve can never nudge it. No app chrome, no sidebar, no
// toolbar; type is scaled off the viewport (one em base per rail) so it reads from a distance,
// while every color, font, and dashed rule stays in the shared token vocabulary.
//
// The QR encodes the game's join-as-solver invite link (domain/invite `buildShareUrl`), the exact
// URL a host would share: a phone scans it, the scanner signs in, and a full account is seated as
// a solver at once (apps/api seatJoiner). See the report for the invite-model note: that invite
// code is one long-lived game-wide capability, so anyone who can see the screen can join.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { renderSVG } from "uqr";
import type { GameStore } from "../store/gameStore";
import type { Clue, Puzzle } from "../domain/types";
import { CrosswordGrid } from "./CrosswordGrid";
import type { FlashEntry, PresenceEntry } from "./CrosswordGrid";
import { buildRoster, GROUP_CAP, GROUP_PAST } from "./roster";
import type { ClueGroup, SolverEntry } from "./roster";
import { partyProgress } from "./partyProgress";
import { buildShareUrl } from "../domain/invite";
import { useElapsedSeconds, formatDuration } from "./gameTime";
import { useWakeLock } from "./useWakeLock";
import { CapsLabel, Logo } from "./primitives";

/** One presence chip in the roster, the solving-now Dot at projector scale (em-relative). */
function Dot({ entry, ring = false }: { entry: SolverEntry; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-[1.7em] w-[1.7em] shrink-0 items-center justify-center rounded-full text-[0.85em] font-bold text-white${
        ring ? " ring-2 ring-panel" : ""
      }`}
      style={{ background: entry.color }}
    >
      {entry.initial}
    </span>
  );
}

/** Overlapping chips for a clue worked by more than one solver, capped with a quiet +N. */
function Cluster({ people }: { people: readonly SolverEntry[] }) {
  const shown = people.slice(0, 2);
  const extra = people.length - shown.length;
  return (
    <span className="flex shrink-0 items-center">
      <span className="flex -space-x-[0.55em]">
        {shown.map((s) => (
          <Dot key={s.userId} entry={s} ring />
        ))}
      </span>
      {extra > 0 && (
        <span className="ml-[0.4em] text-[0.85em] font-semibold text-text-subtle tabular-nums">
          +{extra}
        </span>
      )}
    </span>
  );
}

function ClueTag({ clue }: { clue: Clue }) {
  return (
    <span className="shrink-0 text-[0.95em] font-bold text-text-accent tabular-nums">
      {clue.number}
      {clue.direction === "across" ? "A" : "D"}
    </span>
  );
}

export function PartyView({
  store,
  puzzle,
  gameId,
  code,
  name,
}: {
  store: GameStore;
  puzzle: Puzzle;
  gameId: string;
  code: string | null;
  name: string | null;
}) {
  // The screen is meant to stay lit for hours; hold a screen wake lock while it is mounted.
  useWakeLock(true);

  const version = useSyncExternalStore(store.subscribe, store.getVersion);

  const [flashes, setFlashes] = useState<ReadonlyMap<number, FlashEntry>>(
    new Map(),
  );
  const flashNonce = useRef(0);
  useEffect(
    () =>
      store.subscribeFlash(({ cell, by }) => {
        const color =
          store.participants.find((p) => p.userId === by)?.color ?? "#3e63dd";
        flashNonce.current += 1;
        const nonce = flashNonce.current;
        setFlashes((prev) => new Map(prev).set(cell, { color, nonce }));
      }),
    [store],
  );
  const onFlashEnd = useCallback((cell: number, nonce: number) => {
    setFlashes((prev) => {
      if (prev.get(cell)?.nonce !== nonce) return prev;
      const next = new Map(prev);
      next.delete(cell);
      return next;
    });
  }, []);

  // Live fills, the same render path the solve screen uses (INV-10 composite via renderValue).
  const fills = useMemo(() => {
    void version;
    const map = new Map<number, string>();
    for (let cell = 0; cell < puzzle.cols * puzzle.rows; cell += 1) {
      const value = store.renderValue(cell);
      if (value !== null) map.set(cell, value);
    }
    return map;
  }, [store, version, puzzle]);
  const filled = useMemo(() => new Set(fills.keys()), [fills]);

  // Teammate presence from the store's cursors (best-effort, PROTOCOL.md section 9). Empty until
  // the presence fan-out track lands; then the board lights up with no change here.
  const presence = useMemo(() => {
    void version;
    const byCell = new Map<number, PresenceEntry[]>();
    for (const cursor of store.cursors.values()) {
      if (cursor.userId === store.selfUserId) continue;
      const participant = store.participants.find(
        (p) => p.userId === cursor.userId,
      );
      const entry: PresenceEntry = {
        userId: cursor.userId,
        initial: participant?.displayName.charAt(0) ?? "?",
        color: participant?.color ?? "#3e63dd",
        direction: cursor.direction,
      };
      const list = byCell.get(cursor.cell);
      if (list === undefined) byCell.set(cursor.cell, [entry]);
      else list.push(entry);
    }
    return byCell;
  }, [store, version]);

  // The solving-now roster in the shared vocabulary. The projector is not a solving seat, so
  // self contributes no row (selfSelection null) and is filtered out of the display below.
  const roster = useMemo(() => {
    void version;
    return buildRoster({
      participants: store.participants,
      cursors: store.cursors,
      selfUserId: store.selfUserId,
      selfSelection: null,
      across: puzzle.acrossClues,
      down: puzzle.downClues,
    });
  }, [store, version, puzzle]);
  const others = useMemo(() => roster.solvers.filter((s) => !s.self), [roster]);

  const progress = useMemo(
    () => partyProgress(puzzle.acrossClues, puzzle.downClues, filled),
    [puzzle, filled],
  );
  const elapsed = useElapsedSeconds(store.firstFillAt, store.completedAt);

  // The QR target is the game's shareable invite link, byte-identical to the host's Share link
  // (no party flag): scanning it joins as a solver, never opens another projector.
  const joinUrl = useMemo(
    () =>
      buildShareUrl({
        origin: window.location.origin,
        gameId,
        code,
        name,
      }),
    [gameId, code, name],
  );
  const qrMarkup = useMemo(
    () =>
      joinUrl === null
        ? null
        : renderSVG(joinUrl, {
            ecc: "M",
            border: 2,
            // Dark modules on white, regardless of theme, the way a scannable code must be.
            whiteColor: "#ffffff",
            blackColor: "#21201c",
          }),
    [joinUrl],
  );

  const title = name ?? `${puzzle.cols} × ${puzzle.rows}`;
  const live = store.sync === "live" || store.sync === "connecting";

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-text">
      <div
        className="board-stage flex h-full min-w-0 flex-1 items-center justify-center border-r border-dashed border-border-dashed p-[3vmin]"
        style={{
          ["--board-cols" as string]: puzzle.cols,
          ["--board-aspect" as string]: `${puzzle.cols} / ${puzzle.rows}`,
          // Double the game view's per-cell cap: this board is read across a room, so a
          // small grid grows into the stage instead of holding the at-your-desk size.
          ["--cell-cap" as string]: "128px",
        }}
      >
        <div
          className="board-fit"
          style={{ aspectRatio: `${puzzle.cols} / ${puzzle.rows}` }}
        >
          <div className="board-wrap">
            <CrosswordGrid
              puzzle={puzzle}
              fills={fills}
              selection={null}
              presence={presence}
              flashes={flashes}
              onCellClick={NOOP}
              onFlashEnd={onFlashEnd}
            />
          </div>
        </div>
      </div>

      <aside
        className="flex h-full w-[36%] min-w-[20rem] max-w-[38rem] shrink-0 flex-col overflow-hidden p-[4vmin]"
        style={{ fontSize: "clamp(0.9rem, 1.7vmin, 1.55rem)" }}
      >
        <Logo size={46} />

        <h1 className="mt-[0.7em] text-balance font-display text-[2.7em] font-medium leading-[1.03] tracking-[-0.01em]">
          {title}
        </h1>

        <div className="mt-[0.9em] flex items-baseline gap-[1em]">
          <span className="font-mono text-[2.1em] leading-none tabular-nums">
            {formatDuration(elapsed)}
          </span>
          <span className="text-[1.05em] text-text-muted">
            {progress.solved} of {progress.total} clues
          </span>
        </div>
        {!live && (
          <div
            className="mt-[0.4em] text-[0.9em] text-text-subtle"
            aria-live="polite"
          >
            Reconnecting...
          </div>
        )}

        <div className="mt-[0.9em] h-[0.5em] overflow-hidden rounded-full bg-sand-4">
          <div
            className="h-full rounded-full bg-gold-9 transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
          />
        </div>

        <div className="mt-[1.6em] flex min-h-0 flex-1 flex-col">
          <CapsLabel className="text-[0.9em] text-text">Solving now</CapsLabel>
          <Roster
            others={others}
            groups={roster.groups}
            watching={roster.watching}
          />
        </div>

        <div className="mt-[1.4em] flex items-center gap-[1.4em]">
          {qrMarkup === null ? (
            <p className="text-[1.05em] text-text-muted">
              An invite link will appear here once this game has one.
            </p>
          ) : (
            <>
              <div
                role="img"
                aria-label="QR code to join this game"
                className="shrink-0 rounded-[0.6em] bg-white p-[0.6em] leading-none shadow-sm [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                style={{ width: "clamp(9rem, 15vmin, 15rem)" }}
                dangerouslySetInnerHTML={{ __html: qrMarkup }}
              />
              <div className="min-w-0">
                <div className="text-[1.3em] font-semibold">Scan to join</div>
                {code !== null && (
                  <div className="mt-[0.3em] break-all font-mono text-[1.1em] text-text-accent">
                    {code}
                  </div>
                )}
                <div className="mt-[0.3em] text-[0.95em] text-text-muted">
                  Point your phone camera to solve along.
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

const NOOP = (): void => {};

/**
 * The roster body in the solving-now vocabulary: one row per person while the room is small,
 * grouped by clue past GROUP_PAST solvers and capped at GROUP_CAP with a tail line, so the rail
 * never overflows no matter how many phones join. Self is already excluded upstream.
 */
function Roster({
  others,
  groups,
  watching,
}: {
  others: readonly SolverEntry[];
  groups: readonly ClueGroup[];
  watching: readonly string[];
}) {
  if (others.length === 0 && watching.length === 0) {
    return (
      <p className="mt-[0.6em] text-[1em] text-text-subtle">
        Waiting for the first solver to join.
      </p>
    );
  }
  return (
    <div className="mt-[0.6em] flex min-h-0 flex-col gap-[0.45em] overflow-hidden">
      {others.length <= GROUP_PAST
        ? others.map((s) => (
            <div
              key={s.userId}
              className="flex min-w-0 items-center gap-[0.6em]"
            >
              <Dot entry={s} />
              <span className="shrink-0 text-[1.15em] font-semibold">
                {s.name}
              </span>
              {s.clue !== null && (
                <>
                  <ClueTag clue={s.clue} />
                  <span className="min-w-0 truncate text-[1.1em] text-text-muted">
                    {s.clue.text ?? "—"}
                  </span>
                </>
              )}
            </div>
          ))
        : groups.slice(0, GROUP_CAP).map((g) => (
            <div
              key={`${g.clue.direction}-${g.clue.number}`}
              className="flex min-w-0 items-center gap-[0.6em]"
            >
              <Cluster people={g.people} />
              <ClueTag clue={g.clue} />
              <span className="min-w-0 truncate text-[1.1em] text-text-muted">
                {g.clue.text ?? "—"}
              </span>
            </div>
          ))}
      {others.length > GROUP_PAST && groups.length > GROUP_CAP && (
        <div className="pl-[2.3em] text-[1em] text-text-subtle">
          + {groups.length - GROUP_CAP} more clues in progress
        </div>
      )}
      {watching.length > 0 && (
        <div className="pl-[2.3em] text-[1em] text-text-subtle">
          {watching.length === 1
            ? `${watching[0]} is watching`
            : `${watching.length} watching`}
        </div>
      )}
    </div>
  );
}
