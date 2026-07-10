// The signed-in home (root when signed in, and ?puzzles=1): v2's sidebar shell rebuilt on the
// shadcn substrate. Left: the nav (Games / Puzzles), the New game action, dashed dividers, and
// the user card pinned at the bottom. Right: one framed panel that lists your games or your
// uploaded puzzles. There is deliberately no game status here: lifecycle is session-owned and
// the API cannot report it (DESIGN.md section 9), so games are one list, newest first.
//
// Two data reads back this screen: GET /games (games you host or joined) and GET /puzzles (your
// own uploads), both solution-free (INV-6). A puzzle row starts a fresh game from that puzzle
// (POST /games), the replay-without-reupload path. Fetch shapes and formatters live in homeData.
//
// Routing stays the query-param pushState router. The api/token overrides (dogfood and the dev
// stack) are carried across every in-home link so a `?token=` session keeps working; a real user
// has neither in the URL and the links stay clean.
import { useEffect, useState } from "react";
import {
  ChevronRightIcon,
  ExitIcon,
  FileTextIcon,
  HamburgerMenuIcon,
  HomeIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
} from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity, IdentitySession } from "../identity";
import type { Navigate } from "../nav";
import { cx, Divider, Logo } from "./primitives";
import { useTheme } from "./useTheme";
import {
  featureLabels,
  fetchGames,
  fetchPuzzles,
  gameTitle,
  geometry,
  relativeTime,
  startGameFromPuzzle,
  type GameSummary,
  type PuzzleSummary,
} from "./homeData";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Tab = "games" | "puzzles";

/** Carry only the dogfood/dev overrides (api, token) across an in-home link. */
function preserved(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  const api = params.get("api");
  const token = params.get("token");
  if (api !== null) next.set("api", api);
  if (token !== null) next.set("token", token);
  return next;
}

function qs(p: URLSearchParams): string {
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

function homeSearch(params: URLSearchParams, tab: Tab): string {
  const p = preserved(params);
  if (tab === "puzzles") p.set("puzzles", "1");
  return qs(p);
}

function withParams(
  params: URLSearchParams,
  extra: Record<string, string>,
): string {
  const p = preserved(params);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return qs(p);
}

export function Home({
  config,
  identity,
  navigate,
  params,
}: {
  config: AppConfig;
  identity: Identity;
  navigate: Navigate;
  params: URLSearchParams;
}) {
  const tab: Tab = params.get("puzzles") !== null ? "puzzles" : "games";
  const apiBase = params.get("api") ?? config.apiBase;
  const urlToken = params.get("token");
  const session = identity.getSession();
  const [sheetOpen, setSheetOpen] = useState(false);

  // undefined while unresolved; a string once the ?token= override or the identity token lands.
  const [token, setToken] = useState<string | null | undefined>(
    urlToken !== null ? urlToken : undefined,
  );
  useEffect(() => {
    if (urlToken !== null) {
      setToken(urlToken);
      return;
    }
    let live = true;
    void identity.getAccessToken().then((t) => {
      if (live) setToken(t);
    });
    return () => {
      live = false;
    };
  }, [identity, urlToken]);

  function go(next: string): void {
    setSheetOpen(false);
    navigate(next);
  }

  const nav = (
    <SidebarNav
      tab={tab}
      session={session}
      onGames={() => go(homeSearch(params, "games"))}
      onPuzzles={() => go(homeSearch(params, "puzzles"))}
      onCreate={() => go(withParams(params, { create: "1" }))}
      onSignOut={() => void identity.signOut()}
    />
  );

  return (
    <div className="h-dvh flex flex-col md:flex-row bg-background overflow-hidden">
      <div className="md:hidden px-4 pt-4">
        <div className="flex h-12 items-center justify-between rounded-3 border border-border bg-panel px-3">
          <button
            type="button"
            onClick={() => go(homeSearch(params, "games"))}
            className="inline-flex items-center rounded-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            aria-label="Crossy home"
          >
            <Logo />
          </button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Open menu">
                <HamburgerMenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {nav}
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <aside className="hidden md:flex md:w-64 md:shrink-0">{nav}</aside>

      <main className="flex-1 min-w-0 p-4">
        <div className="h-full overflow-hidden rounded-3 border border-border-strong bg-panel shadow-sm">
          {tab === "games" ? (
            <GamesPanel
              apiBase={apiBase}
              token={token}
              onOpen={(gameId) => go(withParams(params, { game: gameId }))}
              onCreate={() => go(withParams(params, { create: "1" }))}
            />
          ) : (
            <PuzzlesPanel
              apiBase={apiBase}
              token={token}
              onNewGame={(gameId, code) =>
                go(withParams(params, { game: gameId, code }))
              }
              onCreate={() => go(withParams(params, { create: "1" }))}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function SidebarNav({
  tab,
  session,
  onGames,
  onPuzzles,
  onCreate,
  onSignOut,
}: {
  tab: Tab;
  session: IdentitySession | null;
  onGames: () => void;
  onPuzzles: () => void;
  onCreate: () => void;
  onSignOut: () => void;
}) {
  return (
    <nav className="flex h-full w-full flex-col justify-between gap-4 p-4 md:pr-0">
      <div className="flex flex-col gap-4">
        <div className="px-2 pt-1">
          <button
            type="button"
            onClick={onGames}
            className="inline-flex items-center rounded-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            aria-label="Crossy home"
          >
            <Logo />
          </button>
        </div>
        <Divider />
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li>
            <NavItem
              icon={<HomeIcon />}
              label="Games"
              active={tab === "games"}
              onClick={onGames}
            />
          </li>
          <li>
            <NavItem
              icon={<FileTextIcon />}
              label="Puzzles"
              active={tab === "puzzles"}
              onClick={onPuzzles}
            />
          </li>
          <li>
            <NavItem
              icon={<PlusIcon />}
              label="New game"
              accent
              onClick={onCreate}
            />
          </li>
        </ul>
        <Divider />
      </div>
      <UserCard session={session} onSignOut={onSignOut} />
    </nav>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  accent = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group flex w-full items-center gap-2.5 rounded-3 px-2.5 py-2 text-2 font-medium transition-colors",
        active
          ? "bg-gold-3 text-gold-12"
          : "text-text-muted hover:bg-sand-3 hover:text-text",
      )}
    >
      <span
        className={cx(
          "shrink-0",
          active || accent
            ? "text-gold-11"
            : "text-text-subtle group-hover:text-text-muted",
        )}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function UserCard({
  session,
  onSignOut,
}: {
  session: IdentitySession | null;
  onSignOut: () => void;
}) {
  const { theme, toggle } = useTheme();
  const name = session?.displayName ?? "You";
  const initial = (session?.displayName ?? "Y").slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center justify-between gap-2 rounded-4 border border-border bg-panel p-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Avatar size="sm">
          <AvatarFallback className="bg-gold-4 text-gold-11">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-2 font-semibold text-text">{name}</div>
          {session?.isAnonymous === true && (
            <div className="text-1 text-text-subtle">Guest</div>
          )}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Account">
            <HamburgerMenuIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-text-muted">
            Account
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={toggle}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSignOut}>
            <ExitIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ---- Panels ---- */

type Resource<T> =
  { phase: "loading" } | { phase: "error" } | { phase: "ready"; data: T };

/** Load a resource when its loader is non-null, re-running on the listed deps or a reload(). */
function useResource<T>(
  loader: (() => Promise<T>) | null,
  deps: React.DependencyList,
): [Resource<T>, () => void] {
  const [state, setState] = useState<Resource<T>>({ phase: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (loader === null) return;
    let live = true;
    setState({ phase: "loading" });
    loader()
      .then((data) => {
        if (live) setState({ phase: "ready", data });
      })
      .catch(() => {
        if (live) setState({ phase: "error" });
      });
    return () => {
      live = false;
    };
    // loader is recreated each render; the primitive deps below drive re-runs.
  }, [...deps, nonce]);
  return [state, () => setNonce((n) => n + 1)];
}

function PanelShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto pb-4">
      <div className="px-5 pt-5">
        <h1 className="m-0 font-display text-6 text-text">{title}</h1>
        {subtitle !== undefined && (
          <p className="mt-1 text-2 text-text-muted">{subtitle}</p>
        )}
      </div>
      <Divider className="mt-3" />
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

function GamesPanel({
  apiBase,
  token,
  onOpen,
  onCreate,
}: {
  apiBase: string;
  token: string | null | undefined;
  onOpen: (gameId: string) => void;
  onCreate: () => void;
}) {
  const [state, reload] = useResource<GameSummary[]>(
    token != null ? () => fetchGames(apiBase, token) : null,
    [apiBase, token],
  );
  return (
    <PanelShell title="Your games" subtitle="Games you host or have joined.">
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
          <GamesTable games={state.data} onOpen={onOpen} />
        ))}
    </PanelShell>
  );
}

function players(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

/**
 * The games list. Desktop keeps v2's columned table (the baseline to hold, DESIGN brief). Mobile,
 * which v2 never specced, collapses to stacked rows so nothing clips at 390px: the name leads and
 * the counts and time drop to a quiet meta line. Both open the game on tap (?game=<id>).
 */
function GamesTable({
  games,
  onOpen,
}: {
  games: readonly GameSummary[];
  onOpen: (gameId: string) => void;
}) {
  const now = new Date();
  return (
    <>
      <table className="hidden w-full border-collapse text-2 md:table">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Players</Th>
            <Th>Started</Th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const title = gameTitle(g, now);
            return (
              <tr
                key={g.gameId}
                tabIndex={0}
                role="button"
                aria-label={`Open ${title}`}
                onClick={() => onOpen(g.gameId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(g.gameId);
                  }
                }}
                className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-sand-2 focus-visible:bg-sand-2 focus-visible:outline-none"
              >
                <td className="px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-text">
                      {title}
                    </span>
                    {g.role !== "host" && (
                      <Badge variant="neutral" className="shrink-0 capitalize">
                        {g.role}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 tabular-nums text-text-muted">
                  {g.memberCount}
                </td>
                <td className="px-5 py-3 whitespace-nowrap text-text-muted">
                  {relativeTime(g.createdAt, now)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="m-0 list-none p-0 md:hidden">
        {games.map((g) => {
          const title = gameTitle(g, now);
          return (
            <li key={g.gameId}>
              <button
                type="button"
                onClick={() => onOpen(g.gameId)}
                aria-label={`Open ${title}`}
                className="flex w-full items-center justify-between gap-3 border-b border-border px-5 py-3 text-left transition-colors hover:bg-sand-2 focus-visible:bg-sand-2 focus-visible:outline-none"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-text">
                      {title}
                    </span>
                    {g.role !== "host" && (
                      <Badge variant="neutral" className="shrink-0 capitalize">
                        {g.role}
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-1 text-text-muted">
                    {players(g.memberCount)} · {relativeTime(g.createdAt, now)}
                  </span>
                </span>
                <ChevronRightIcon className="shrink-0 text-text-subtle" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

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

/**
 * The uploads list. Desktop is a columned table (Size / Features / Uploaded + the start action);
 * mobile stacks each puzzle so the row never clips. Every row's one action starts a fresh game
 * from that puzzle, the replay-without-reupload path (POST /games).
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
                <td className="px-5 py-3 font-mono text-text tabular-nums">
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
          return (
            <li
              key={p.puzzleId}
              className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"
            >
              <div className="min-w-0">
                <div className="font-mono text-text tabular-nums">
                  {geometry(p.cols, p.rows)}
                </div>
                <div className="mt-0.5 text-1 text-text-muted">
                  {(features.length === 0 ? "Standard" : features.join(" · ")) +
                    " · " +
                    relativeTime(p.createdAt, now)}
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
