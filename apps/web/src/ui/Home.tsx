// The signed-in content surfaces inside the shell (AppShell owns the sidebar and chrome). One
// idea runs through both: a crossword's black-square pattern is its face. The API ships that
// pattern as a solution-free `mask` (PROTOCOL section 12) on every list row, and the Silhouette
// component renders it small in the board's own ink-on-paper tokens.
//
// `/` is the shelf: the rooms you're in as physical objects, cards whose material is the puzzle's
// silhouette, the serif welcome above and the one gold New game action beside it. Each card
// carries the room name, the human facts (players, your role, when it started), and its
// completion state (the base branch's `completedAt`); finished rooms gather in a trailing, quiet
// "Solved" shelf so the live rooms stay up top. Newest first throughout.
//
// `/puzzles` is the hybrid gallery: the few most recent uploads as larger silhouette cards, the
// deeper archive as the existing tight index rows below (date-led, byline, size). Every entry
// starts a fresh game (POST /games), the replay-without-reupload path. The /new dropzone is a
// separate decision and is not absorbed here.
//
// Titles and authors come off the API where ingestion parsed them; nothing here invents a
// lifecycle status, because status is session-owned and the API reports only completion
// (DESIGN.md section 9). Both reads are solution-free (INV-6). Fetch shapes and the pure
// formatters live in homeData; the silhouette is the artwork, typography does the rest.
import { useState } from "react";
import { PlusIcon } from "@radix-ui/react-icons";
import type { IdentitySession } from "../identity";
import { cx, CapsLabel, Divider } from "./primitives";
import { Silhouette } from "./Silhouette";
import { useResource } from "./useResource";
import type { Resource } from "./useResource";
import {
  featureLabels,
  fetchPuzzles,
  gameTitle,
  geometry,
  isCompleted,
  puzzleTitle,
  relativeTime,
  startGameFromPuzzle,
  type GameSummary,
  type PuzzleSummary,
} from "./homeData";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";

export type HomeSurface = "games" | "puzzles";

export function Home({
  surface,
  apiBase,
  token,
  session,
  games,
  reloadGames,
  onOpenGame,
  onStartGame,
  onCreate,
}: {
  surface: HomeSurface;
  apiBase: string;
  token: string | null | undefined;
  session: IdentitySession | null;
  /** The games read is shared with the sidebar (one GET /games, owned by the Router). */
  games: Resource<GameSummary[]>;
  reloadGames: () => void;
  onOpenGame: (gameId: string) => void;
  /** A fresh game just created from a puzzle row: open it, carrying its invite code. */
  onStartGame: (gameId: string, code: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="h-full min-w-0 p-4 md:p-3 md:pl-0">
      <div className="flex h-full flex-col overflow-hidden rounded-3 border border-border-strong bg-panel shadow-sm">
        {/* The sidebar toggle, anchored in the panel's top-left so a collapse never slides it
            out from under the cursor. Desktop only; the phone header owns the sheet trigger. */}
        <div className="hidden shrink-0 px-3 pt-2 md:block">
          <SidebarTrigger className="text-text-subtle hover:text-text" />
        </div>
        <div className="min-h-0 flex-1">
          {surface === "games" ? (
            <GamesPanel
              state={games}
              reload={reloadGames}
              session={session}
              onOpen={onOpenGame}
              onCreate={onCreate}
            />
          ) : (
            <PuzzlesPanel
              apiBase={apiBase}
              token={token}
              onNewGame={onStartGame}
              onCreate={onCreate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Panel scaffolding ---- */

function PanelShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 md:pt-2">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-6 text-text">{title}</h1>
          {subtitle !== undefined && (
            <p className="mt-1 text-2 text-text-muted">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <Divider className="mt-3" />
      {children}
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="px-5 py-12 text-center text-2 text-text-subtle">
      {label}
    </div>
  );
}

function PanelError({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-2 text-text-muted">{label}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function PanelEmpty({
  sentence,
  actionLabel,
  onAction,
}: {
  sentence: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <p className="max-w-[24rem] text-3 text-text-muted">{sentence}</p>
      <Button variant="default" onClick={onAction}>
        <PlusIcon />
        {actionLabel}
      </Button>
    </div>
  );
}

/* ---- Home: your games ---- */

/** "Welcome back, Ada." with graceful fallbacks; guests get the plain form. */
function welcome(session: IdentitySession | null): string {
  const name = session?.displayName.trim();
  if (
    session === null ||
    session.isAnonymous ||
    name === undefined ||
    name === ""
  ) {
    return "Welcome back.";
  }
  return `Welcome back, ${name}.`;
}

function players(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

function GamesPanel({
  state,
  reload,
  session,
  onOpen,
  onCreate,
}: {
  state: Resource<GameSummary[]>;
  reload: () => void;
  session: IdentitySession | null;
  onOpen: (gameId: string) => void;
  onCreate: () => void;
}) {
  return (
    <PanelShell
      title={welcome(session)}
      subtitle="Pick up a game you're in, or start a new one."
      action={
        <Button variant="default" onClick={onCreate}>
          <PlusIcon />
          New game
        </Button>
      }
    >
      {state.phase === "loading" && (
        <PanelLoading label="Loading your games..." />
      )}
      {state.phase === "error" && (
        <PanelError label="We couldn't load your games." onRetry={reload} />
      )}
      {state.phase === "ready" &&
        (state.data.length === 0 ? (
          <PanelEmpty
            sentence="You're not in any games yet. Start one and share the link."
            actionLabel="New game"
            onAction={onCreate}
          />
        ) : (
          <GamesList games={state.data} onOpen={onOpen} />
        ))}
    </PanelShell>
  );
}

/**
 * One room as a physical object: the puzzle's silhouette is the card's material, the name and
 * facts sit beside it. The whole card opens the game. A completed room reads quietly done, the
 * silhouette dimmed and a small "Solved" caption in place of the started line, no loud badge.
 */
function RoomCard({
  game,
  now,
  onOpen,
}: {
  game: GameSummary;
  now: Date;
  onOpen: (gameId: string) => void;
}) {
  const title = gameTitle(game, now);
  const done = isCompleted(game);
  return (
    <button
      type="button"
      onClick={() => onOpen(game.gameId)}
      aria-label={done ? `Open ${title} (solved)` : `Open ${title}`}
      className="group flex w-full flex-col overflow-hidden rounded-4 border border-border bg-panel text-left transition-colors hover:border-border-strong focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {/* The silhouette fills the card's top: the face you recognize before the name. */}
      <span className="block border-b border-border bg-sand-2 p-4">
        <Silhouette
          mask={game.puzzle.mask}
          muted={done}
          className="mx-auto h-auto w-full max-w-[8rem]"
        />
      </span>
      <span className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-3 font-medium text-text">
            {title}
          </span>
          {game.role !== "host" && (
            <Badge variant="neutral" className="shrink-0 capitalize">
              {game.role}
            </Badge>
          )}
        </span>
        <span className="text-1 text-text-muted">
          {done ? (
            <span className="text-text-subtle">
              {players(game.memberCount)} · Solved
            </span>
          ) : (
            <>
              {players(game.memberCount)} · started{" "}
              {relativeTime(game.createdAt, now)}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/** A responsive gallery of room cards: one column on a phone, more as the panel widens. */
function RoomGrid({
  games,
  now,
  onOpen,
}: {
  games: readonly GameSummary[];
  now: Date;
  onOpen: (gameId: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {games.map((g) => (
        <RoomCard key={g.gameId} game={g} now={now} onOpen={onOpen} />
      ))}
    </div>
  );
}

/**
 * The shelf: live rooms first as silhouette cards, then a trailing "Solved" section that gathers
 * the finished rooms so the shelf reads calm and current at the top. Ordering inside each group
 * stays newest-first (the API's order is preserved). When nothing is solved, the trailing section
 * simply does not render, so an all-live shelf carries no empty header.
 */
function GamesList({
  games,
  onOpen,
}: {
  games: readonly GameSummary[];
  onOpen: (gameId: string) => void;
}) {
  const now = new Date();
  const live = games.filter((g) => !isCompleted(g));
  const solved = games.filter((g) => isCompleted(g));
  return (
    <div className="flex flex-col gap-8 px-4 pt-4">
      {live.length > 0 && <RoomGrid games={live} now={now} onOpen={onOpen} />}
      {solved.length > 0 && (
        <section className="flex flex-col gap-4">
          <CapsLabel className="text-text-subtle">Solved</CapsLabel>
          <RoomGrid games={solved} now={now} onOpen={onOpen} />
        </section>
      )}
    </div>
  );
}

/* ---- Puzzles: the library ---- */

function PuzzlesPanel({
  apiBase,
  token,
  onNewGame,
  onCreate,
}: {
  apiBase: string;
  token: string | null | undefined;
  onNewGame: (gameId: string, code: string) => void;
  onCreate: () => void;
}) {
  const [starting, setStarting] = useState<string | null>(null);
  const [state, reload] = useResource<PuzzleSummary[]>(
    token != null ? () => fetchPuzzles(apiBase, token) : null,
    [apiBase, token],
  );

  async function start(p: PuzzleSummary): Promise<void> {
    if (token == null) return;
    setStarting(p.puzzleId);
    try {
      const { gameId, inviteCode } = await startGameFromPuzzle(
        apiBase,
        token,
        p.puzzleId,
      );
      onNewGame(gameId, inviteCode);
    } catch {
      // Stay on the list and let the row's button recover; a toast would be noise here.
      setStarting(null);
    }
  }

  return (
    <PanelShell
      title="Puzzles"
      subtitle="Start a fresh game from a puzzle you've uploaded."
    >
      {state.phase === "loading" && (
        <PanelLoading label="Loading your puzzles..." />
      )}
      {state.phase === "error" && (
        <PanelError label="We couldn't load your puzzles." onRetry={reload} />
      )}
      {state.phase === "ready" &&
        (state.data.length === 0 ? (
          <PanelEmpty
            sentence="You haven't uploaded a puzzle yet. Upload one to start a game."
            actionLabel="New game"
            onAction={onCreate}
          />
        ) : (
          <PuzzlesLibrary
            puzzles={state.data}
            starting={starting}
            onStart={start}
          />
        ))}
    </PanelShell>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cx(
        "border-b border-border-strong px-4 py-2 text-left text-1 font-medium text-text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

/** How many recent uploads lead the library as larger silhouette cards; the rest is the index. */
const GALLERY_COUNT = 4;

/**
 * One recent upload as a larger silhouette card. The face leads; the parsed title, the byline,
 * and size sit beneath; the one action starts a fresh game. Same behavior as an index row, given
 * the gallery's larger frame.
 */
function PuzzleCard({
  puzzle,
  starting,
  onStart,
}: {
  puzzle: PuzzleSummary;
  starting: boolean;
  onStart: (p: PuzzleSummary) => void;
}) {
  const features = featureLabels(puzzle.features);
  return (
    <div className="flex flex-col overflow-hidden rounded-4 border border-border bg-panel">
      <div className="border-b border-border bg-sand-2 p-4">
        <Silhouette
          mask={puzzle.mask}
          className="mx-auto h-auto w-full max-w-[9rem]"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3">
        <div className="truncate text-3 font-medium text-text">
          {puzzleTitle(puzzle)}
        </div>
        {puzzle.author !== null && puzzle.author.trim() !== "" && (
          <div className="truncate text-1 text-text-muted">{puzzle.author}</div>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-1 text-text-subtle">
          <span className="font-mono tabular-nums">
            {geometry(puzzle.cols, puzzle.rows)}
          </span>
          {features.length > 0 && <span aria-hidden>·</span>}
          {features.length > 0 && <span>{features.join(" · ")}</span>}
        </div>
      </div>
      <div className="px-4 pb-4">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={starting}
          onClick={() => onStart(puzzle)}
        >
          {starting ? "Starting..." : "New game"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The library, the hybrid gallery: the most recent uploads lead as larger silhouette cards, then
 * the deeper archive follows as the tight index (date-led, byline, size). Desktop is a columned
 * table, mobile stacks each row so it never clips. Every entry's one action starts a fresh game.
 * When there are only a few uploads, they are all gallery cards and the index simply does not
 * render, so a small library reads as a clean wall of faces rather than a table of one row.
 */
function PuzzlesLibrary({
  puzzles,
  starting,
  onStart,
}: {
  puzzles: readonly PuzzleSummary[];
  starting: string | null;
  onStart: (p: PuzzleSummary) => void;
}) {
  const gallery = puzzles.slice(0, GALLERY_COUNT);
  const archive = puzzles.slice(GALLERY_COUNT);
  return (
    <div className="flex flex-col gap-8 px-4 pt-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {gallery.map((p) => (
          <PuzzleCard
            key={p.puzzleId}
            puzzle={p}
            starting={starting === p.puzzleId}
            onStart={onStart}
          />
        ))}
      </div>
      {archive.length > 0 && (
        <section className="flex flex-col gap-3">
          <CapsLabel className="text-text-subtle">Archive</CapsLabel>
          <PuzzlesIndex
            puzzles={archive}
            starting={starting}
            onStart={onStart}
          />
        </section>
      )}
    </div>
  );
}

/**
 * The deeper archive as tight index rows: desktop a columned table led by the parsed title and
 * author, mobile a stacked list so a row never clips. Unchanged behavior from the prior uploads
 * table; every row's one action starts a fresh game from that puzzle.
 */
function PuzzlesIndex({
  puzzles,
  starting,
  onStart,
}: {
  puzzles: readonly PuzzleSummary[];
  starting: string | null;
  onStart: (p: PuzzleSummary) => void;
}) {
  const now = new Date();
  return (
    <>
      <table className="hidden w-full border-collapse text-2 md:table">
        <thead>
          <tr>
            <Th>Puzzle</Th>
            <Th>Size</Th>
            <Th>Features</Th>
            <Th>Uploaded</Th>
            <Th className="text-right">
              <span className="sr-only">Start a game</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {puzzles.map((p) => {
            const features = featureLabels(p.features);
            return (
              <tr
                key={p.puzzleId}
                className="border-b border-border last:border-0"
              >
                {/* w-2/5 + max-w-0 gives the title real room and still truncates overflow. */}
                <td className="w-2/5 max-w-0 px-4 py-2">
                  <div className="truncate font-medium text-text">
                    {puzzleTitle(p)}
                  </div>
                  {p.author !== null && p.author.trim() !== "" && (
                    <div className="mt-0.5 truncate text-1 text-text-muted">
                      {p.author}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-text tabular-nums whitespace-nowrap">
                  {geometry(p.cols, p.rows)}
                </td>
                <td className="px-4 py-2">
                  {features.length === 0 ? (
                    <span className="text-text-subtle">Standard</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {features.map((f) => (
                        <Badge key={f} variant="gold">
                          {f}
                        </Badge>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-text-muted">
                  {relativeTime(p.createdAt, now)}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={starting === p.puzzleId}
                    onClick={() => onStart(p)}
                  >
                    {starting === p.puzzleId ? "Starting..." : "New game"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="m-0 list-none p-0 md:hidden">
        {puzzles.map((p) => {
          const features = featureLabels(p.features);
          const meta = [
            geometry(p.cols, p.rows),
            ...(features.length > 0 ? [features.join(" · ")] : []),
            relativeTime(p.createdAt, now),
          ].join(" · ");
          return (
            <li
              key={p.puzzleId}
              className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-text">
                  {puzzleTitle(p)}
                </div>
                <div className="mt-0.5 truncate text-1 text-text-muted">
                  {p.author !== null && p.author.trim() !== ""
                    ? `${p.author} · ${meta}`
                    : meta}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={starting === p.puzzleId}
                onClick={() => onStart(p)}
              >
                {starting === p.puzzleId ? "Starting..." : "New game"}
              </Button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
