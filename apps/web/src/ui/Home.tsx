// The signed-in content surfaces inside the shell (AppShell owns the sidebar and chrome).
// `/` is the landing-in view: a serif welcome, the one gold New game action, and the games
// you're in as full rows. The sidebar's recents are navigation, one truncated line each;
// this panel is the detail view of the same list (players, your role, when it started), the
// claude.ai home pattern of sidebar recents plus a richer recent list in the frame. `/puzzles`
// is the library: your uploads, each row starting a fresh game (POST /games), the
// replay-without-reupload path. Titles and authors come off the API where ingestion parsed
// them; nothing here invents a status, because lifecycle is session-owned and the API cannot
// report it (DESIGN.md section 9).
//
// Both reads are solution-free (INV-6). Fetch shapes and formatters live in homeData.
import { useState } from "react";
import { ChevronRightIcon, PlusIcon } from "@radix-ui/react-icons";
import type { IdentitySession } from "../identity";
import { cx, Divider } from "./primitives";
import { useResource } from "./useResource";
import type { Resource } from "./useResource";
import {
  featureLabels,
  fetchPuzzles,
  gameTitle,
  geometry,
  puzzleTitle,
  relativeTime,
  startGameFromPuzzle,
  type GameSummary,
  type PuzzleSummary,
} from "./homeData";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
    <div className="h-full min-w-0 p-4">
      <div className="h-full overflow-hidden rounded-3 border border-border-strong bg-panel shadow-sm">
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
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-6 text-text">{title}</h1>
          {subtitle !== undefined && (
            <p className="mt-1 text-2 text-text-muted">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      <Divider className="mt-4" />
      {children}
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="px-5 py-16 text-center text-2 text-text-subtle">
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
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
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
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
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
 * The games detail rows, one recipe at every width: name leads (room name, then the puzzle
 * title, then geometry-and-date), a quiet meta line beneath (players, started), your role as
 * a badge when you're not the host. Each row opens the game.
 */
function GamesList({
  games,
  onOpen,
}: {
  games: readonly GameSummary[];
  onOpen: (gameId: string) => void;
}) {
  const now = new Date();
  return (
    <ul className="m-0 list-none p-0">
      {games.map((g) => {
        const title = gameTitle(g, now);
        return (
          <li key={g.gameId}>
            <button
              type="button"
              onClick={() => onOpen(g.gameId)}
              aria-label={`Open ${title}`}
              className="flex w-full items-center justify-between gap-3 border-b border-border px-5 py-3.5 text-left transition-colors hover:bg-sand-2 focus-visible:bg-sand-2 focus-visible:outline-none"
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-3 font-medium text-text">
                    {title}
                  </span>
                  {g.role !== "host" && (
                    <Badge variant="neutral" className="shrink-0 capitalize">
                      {g.role}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-1 text-text-muted">
                  {players(g.memberCount)} · started{" "}
                  {relativeTime(g.createdAt, now)}
                </span>
              </span>
              <ChevronRightIcon className="shrink-0 text-text-subtle" />
            </button>
          </li>
        );
      })}
    </ul>
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
          <PuzzlesTable
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
        "border-b border-border-strong px-5 py-2.5 text-left text-1 font-medium text-text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * The uploads list. Desktop is a columned table, now led by the parsed title and author
 * (persisted by ingestion since the title/author API change); mobile stacks each puzzle so
 * the row never clips. Every row's one action starts a fresh game from that puzzle.
 */
function PuzzlesTable({
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
                <td className="w-2/5 max-w-0 px-5 py-3">
                  <div className="truncate font-medium text-text">
                    {puzzleTitle(p)}
                  </div>
                  {p.author !== null && p.author.trim() !== "" && (
                    <div className="mt-0.5 truncate text-1 text-text-muted">
                      {p.author}
                    </div>
                  )}
                </td>
                <td className="px-5 py-3 font-mono text-text tabular-nums whitespace-nowrap">
                  {geometry(p.cols, p.rows)}
                </td>
                <td className="px-5 py-3">
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
                <td className="px-5 py-3 whitespace-nowrap text-text-muted">
                  {relativeTime(p.createdAt, now)}
                </td>
                <td className="px-5 py-3 text-right">
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
              className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"
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
