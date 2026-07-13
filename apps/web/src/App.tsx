// Client routing (SPA): a small hand-rolled history-API router (nav.ts) selects the surface
// by path. `/` is the signed-in home (the sidebar shell) or the landing hero when signed out;
// `/puzzles` is the library; `/new` is the create flow; `/game/<id>` is the live game (invite
// links carry `?code=`). Legacy query-routed URLs (`?game=`, `?puzzles=1`, `?create=1`) parse
// to the same surfaces and are canonicalized once via replaceState, so old invite links keep
// working; `?demo=1` keeps the fake-session boards for hacking. The `?api=`/`?ws=`/`?token=`
// overrides (smoke and dogfood) stay query params on any route. Navigation is pushState so
// the app never full-reloads between screens, and the identity session survives.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Grid } from "@crossy/engine";
import { boardById, boards } from "./domain/boards";
import type { Clue } from "./domain/types";
import { createFakeSession, SELF_USER_ID } from "./demo/fakeSession";
import type { FakeSession } from "./demo/fakeSession";
import { MosaicDemo } from "./demo/MosaicDemo";
import {
  cellClick,
  clueClick,
  initialSelection,
  keyEffect,
} from "./input/actions";
import type { Selection } from "./input/actions";
import { CrosswordGrid } from "./ui/CrosswordGrid";
import type { FlashEntry, PresenceEntry } from "./ui/CrosswordGrid";
import { CompletionOverlay } from "./ui/Completion";
import { CompletedMosaic, useCompletionBloomEdge } from "./ui/CompletedMosaic";
import type { StackMember } from "./ui/primitives";
import { SettingsStrip } from "./ui/SettingsStrip";
import { AuthBar } from "./ui/AuthBar";
import { Landing } from "./ui/Landing";
import { Home } from "./ui/Home";
import { AppShell } from "./ui/AppShell";
import { CreateGame } from "./ui/CreateGame";
import { Settings } from "./ui/Settings";
import { AuthConfirm } from "./ui/AuthConfirm";
import { useBearer, useResource } from "./ui/useResource";
import { fetchGames } from "./ui/homeData";
import type { GameSummary } from "./ui/homeData";
import { Button } from "@/components/ui/button";
import { ThemeProvider } from "./ui/useTheme";
import { NavPrefsProvider, useNavPrefs } from "./ui/useNavPrefs";
import { LiveApp } from "./LiveApp";
import type { AppConfig } from "./config/config";
import type { Identity } from "./identity";
import type { Navigate } from "./nav";
import { canonicalHref, createHref, gameHref, parseRoute } from "./nav";

type Theme = "light" | "dark";

/**
 * The root: one theme provider around the router. A real game (`/game/<id>`) drives the live
 * session service; the live path is what the M1 smoke exercises with two real browsers.
 */
export function App({
  config,
  identity,
}: {
  config: AppConfig;
  identity: Identity;
}) {
  return (
    <ThemeProvider>
      <NavPrefsProvider>
        <Router config={config} identity={identity} />
      </NavPrefsProvider>
    </ThemeProvider>
  );
}

interface Loc {
  pathname: string;
  search: string;
}

/**
 * Read the current location, canonicalizing a legacy query-routed URL (`?game=`, `?puzzles=1`,
 * `?create=1`) to its path form via replaceState FIRST, so the app only ever renders against
 * stable params. Doing this before state lands (not in an effect) matters: an effect-time
 * rewrite would change the params object under a mounted LiveApp and churn its WebSocket.
 * The rewrite is idempotent, so StrictMode's double initializer invoke is harmless.
 */
function readLocation(): Loc {
  if (typeof window === "undefined") return { pathname: "/", search: "" };
  const { pathname, search } = window.location;
  const canonical = canonicalHref(pathname, new URLSearchParams(search));
  if (canonical !== null) window.history.replaceState({}, "", canonical);
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

function Router({
  config,
  identity,
}: {
  config: AppConfig;
  identity: Identity;
}) {
  const [loc, setLoc] = useState<Loc>(() => readLocation());
  // Re-render when the identity session changes so the root flips between the landing and the
  // home the instant a sign-in or sign-out lands (getSession is read synchronously below).
  const [, bumpAuth] = useState(0);
  useEffect(() => identity.onChange(() => bumpAuth((t) => t + 1)), [identity]);

  useEffect(() => {
    const onPop = (): void => setLoc(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback<Navigate>((to) => {
    window.history.pushState({}, "", to === "" ? "/" : to);
    setLoc(readLocation());
    window.scrollTo(0, 0);
  }, []);

  const params = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const route = useMemo(
    () => parseRoute(loc.pathname, params),
    [loc.pathname, params],
  );

  // A signed-in session (or the `?token=` dogfood override) gets the sidebar shell; everyone
  // else keeps the landing hero and the standalone gates exactly as before.
  const signedIn =
    identity.getSession() !== null || params.get("token") !== null;

  // The recents read (GET /games) backs both the sidebar and the home panel, so it lives
  // here and is fetched once. It re-reads on every surface change (routeEpoch) so a game
  // created or joined a moment ago shows up without a manual refresh; one first-page read.
  const apiBase = params.get("api") ?? config.apiBase;
  const bearer = useBearer(identity, params.get("token"));
  const routeEpoch =
    route.kind === "game" ? `game:${route.gameId}` : route.kind;
  const [games, reloadGames] = useResource<GameSummary[]>(
    signedIn ? () => fetchGames(apiBase, bearer) : null,
    [apiBase, bearer, routeEpoch, signedIn],
  );

  if (route.kind === "demo") {
    return <DemoApp config={config} identity={identity} />;
  }

  // The magic-link landing owns its own full-viewport chrome (like the landing) and must render
  // for signed-out and signed-in arrivals alike, so it is dispatched before the signed-in gate. It
  // reads token_hash/type off the query and, on a verified session, navigates home itself.
  if (route.kind === "auth-confirm") {
    return (
      <AuthConfirm
        identity={identity}
        config={config}
        params={params}
        navigate={navigate}
      />
    );
  }

  const shell = (children: React.ReactNode): React.ReactNode => (
    <AppShell
      route={route}
      params={params}
      navigate={navigate}
      identity={identity}
      games={games}
      reloadGames={reloadGames}
    >
      {children}
    </AppShell>
  );

  if (route.kind === "game") {
    // The projector screen (`?party=1`) owns the whole viewport: no sidebar shell, so nothing on
    // the wall implies interactivity. Otherwise the game renders in the shell when signed in.
    const party = route.party === true;
    const live = (
      <LiveApp
        key={route.gameId}
        gameId={route.gameId}
        params={params}
        config={config}
        identity={identity}
        navigate={navigate}
        inShell={signedIn && !party}
        party={party}
      />
    );
    return signedIn && !party ? shell(live) : live;
  }

  if (route.kind === "create") {
    const create = (
      <CreateGame
        config={config}
        identity={identity}
        navigate={navigate}
        params={params}
        inShell={signedIn}
      />
    );
    return signedIn ? shell(create) : create;
  }

  if (route.kind === "settings" && signedIn) {
    return shell(
      <Settings
        identity={identity}
        apiBase={apiBase}
        bearer={bearer}
        navigate={navigate}
        params={params}
      />,
    );
  }

  if (!signedIn) {
    return <Landing identity={identity} config={config} />;
  }

  return shell(
    <Home
      surface={route.kind === "puzzles" ? "puzzles" : "games"}
      // The extension's post-ingest play intent (D22): `/puzzles?play=<id>` preselects that
      // library puzzle for room creation. Signed out, this branch is never reached (the landing
      // renders instead) and the OAuth redirect preserves the path and query, so the intent
      // fires after sign-in.
      playIntent={route.kind === "puzzles" ? (route.play ?? null) : null}
      apiBase={apiBase}
      bearer={bearer}
      session={identity.getSession()}
      games={games}
      reloadGames={reloadGames}
      onOpenGame={(gameId) => navigate(gameHref(gameId, params))}
      onStartGame={(gameId, code) =>
        navigate(gameHref(gameId, params, { code }))
      }
      onCreate={() => navigate(createHref(params))}
    />,
  );
}

function gridOf(boardId: string): Grid {
  const p = boardById(boardId).puzzle;
  return { cols: p.cols, rows: p.rows, blocks: p.blocks };
}

function activeClue(
  clues: readonly Clue[],
  selection: Selection,
): Clue | undefined {
  return clues.find(
    (c) =>
      c.direction === selection.direction && c.cells.includes(selection.cell),
  );
}

/**
 * The demo boards behind `?demo=1`: the real GameStore and engine navigation on fake data.
 * Deliberately left plain (the design pass targets the product surfaces); it stays here so the
 * store, overlay, and reconnect paths can be hacked on without a live session.
 */
function DemoApp({
  config,
  identity,
}: {
  config: AppConfig;
  identity: Identity;
}) {
  const [boardId, setBoardId] = useState(() => {
    const board = boards[0];
    if (!board) throw new Error("no boards defined");
    return board.id;
  });
  const [session, setSession] = useState<FakeSession>(() =>
    createFakeSession(boardById(boardId)),
  );
  const [selection, setSelection] = useState<Selection>(() =>
    initialSelection(gridOf(boardId)),
  );
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  );
  const [flashes, setFlashes] = useState<ReadonlyMap<number, FlashEntry>>(
    new Map(),
  );
  const [dismissedCompletion, setDismissedCompletion] = useState(false);
  // Personal navigation prefs (settings slice 1): the demo board honors the same client-local
  // choice as the live game so the two input routes never drift.
  const { prefs: navPrefs } = useNavPrefs();
  const flashNonce = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const store = session.store;
  const version = useSyncExternalStore(store.subscribe, store.getVersion);

  const board = boardById(boardId);
  const puzzle = board.puzzle;
  const grid = useMemo(() => gridOf(boardId), [boardId]);
  const frozen = store.status !== "ongoing";
  const boardCompleted = store.status === "completed";
  // Edge-trigger the bloom on the ongoing -> completed transition, latched on this persistent
  // DemoApp (the mosaic mounts only once completed). "Reset board" unmounts and remounts the
  // session-scoped surface via a fresh key path, so the arc re-arms on the next completion; a
  // reload straight onto a completed demo would land on the settled wash, matching the live rule.
  const bloomOnCompletion = useCompletionBloomEdge(boardCompleted);

  // "Reset board" re-arms the completion overlay, so the demo can replay it.
  useEffect(() => {
    if (store.status === "ongoing") setDismissedCompletion(false);
  }, [store.status]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  useEffect(() => () => session.dispose(), [session]);

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

  const presence = useMemo(() => {
    void version;
    const byCell = new Map<number, PresenceEntry[]>();
    for (const cursor of store.cursors.values()) {
      if (cursor.userId === (store.selfUserId ?? SELF_USER_ID)) continue;
      const participant = store.participants.find(
        (p) => p.userId === cursor.userId,
      );
      const entry: PresenceEntry = {
        userId: cursor.userId,
        initial: participant?.displayName.charAt(0) ?? "?",
        avatarUrl: participant?.avatarUrl ?? null,
        color: participant?.color ?? "#3e63dd",
        direction: cursor.direction,
      };
      const list = byCell.get(cursor.cell);
      if (list === undefined) byCell.set(cursor.cell, [entry]);
      else list.push(entry);
    }
    return byCell;
  }, [store, version]);

  // The completion overlay's roster, the LiveApp mapping on the fake session's
  // participants, so "Complete game" exercises the real celebration surface here.
  const members: StackMember[] = useMemo(() => {
    void version;
    return store.participants.map((p) => ({
      userId: p.userId,
      name: p.displayName,
      initial: p.displayName.charAt(0) || "?",
      avatarUrl: p.avatarUrl,
      color: p.color,
      connected: p.connected,
      role: p.role,
    }));
  }, [store, version]);

  // Mosaic-only roster augmentation, demo surface only: the demo boards are pre-seeded with cells
  // whose last writer is the synthetic "seed" id (fakeSession seedCells), which is not a real
  // participant. Giving it a house-gold color lets the demo's last-writer bloom actually paint the
  // solved board, so the `?demo=1` preview shows real color. This never touches the overlay's own
  // `members` (its avatar stack stays the real participants); it feeds only the mosaic's roster.
  const mosaicMembers: StackMember[] = useMemo(
    () => [
      ...members,
      {
        userId: "seed",
        name: "Seed",
        initial: "S",
        avatarUrl: null,
        color: "#b9a88d", // gold-8, the house warm midpoint (celebrationPalette's anchor)
        connected: false,
        role: "solver",
      },
    ],
    [members],
  );

  function switchBoard(id: string): void {
    session.dispose();
    setSession(createFakeSession(boardById(id)));
    setBoardId(id);
    setSelection(initialSelection(gridOf(id)));
    setFlashes(new Map());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const effect = keyEffect(
      { grid, filled, selection, frozen, prefs: navPrefs },
      e.key,
      e.shiftKey,
    );
    if (effect === null) return;
    e.preventDefault();
    for (const mutation of effect.mutations) {
      if (mutation.type === "placeLetter") {
        store.placeLetter(mutation.cell, mutation.value);
      } else {
        store.clearCell(mutation.cell);
      }
    }
    setSelection(effect.selection);
  }

  function onCellClick(cell: number): void {
    gridRef.current?.focus();
    const next = cellClick(grid, selection, cell);
    if (next !== null) setSelection(next);
  }

  const allClues: Clue[] = [...puzzle.acrossClues, ...puzzle.downClues];
  const clue = activeClue(allClues, selection);
  const clueCells = clue
    ? clue.cells.map((c) => fills.get(c) ?? "·").join("")
    : "";

  return (
    <div className="mx-auto max-w-[900px] px-5 pt-5 pb-9">
      <header className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-5 font-bold m-0">Crossy demo boards</h1>
          <p className="mt-1 text-2 text-text-muted">
            The real store and engine navigation on fake data. The product lives
            at the root; this stays behind <code className="mx-1">?demo=1</code>
            .
          </p>
        </div>
        <AuthBar identity={identity} config={config} />
      </header>

      <SettingsStrip
        boardId={boardId}
        boards={boards.map((b) => ({ id: b.id, label: b.label }))}
        onBoard={switchBoard}
        theme={theme}
        onTheme={setTheme}
      />

      <div className="flex items-center flex-wrap gap-3 my-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => session.scribble(selection.cell)}
          >
            Teammate scribble
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => session.gapEvent(selection.cell)}
          >
            Lose an event
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => session.dropConnection()}
          >
            Drop connection
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => session.completeGame()}
          >
            Complete game
          </Button>
          <Button variant="secondary" size="sm" onClick={() => session.reset()}>
            Reset board
          </Button>
        </div>
        <span className="ml-auto text-2 text-text-muted tabular-nums">
          {store.status} / seq {store.seq} / {store.sync}
        </span>
      </div>

      <div
        className="flex items-center gap-2 px-3 py-2 rounded-3 bg-blue-3 mb-2 text-4 min-h-5"
        aria-live="polite"
      >
        {clue ? (
          <>
            <button
              type="button"
              className="font-bold text-text-accent hover:underline"
              onClick={() => {
                gridRef.current?.focus();
                setSelection(clueClick(clue));
              }}
            >
              {clue.number} {clue.direction.toUpperCase()}
            </button>
            <span className="tracking-[0.3em] tabular-nums text-text-muted">
              {clueCells}
            </span>
          </>
        ) : (
          <span className="text-text-subtle">No word on this axis</span>
        )}
      </div>

      <div
        className="min-h-7 flex justify-center items-center mb-1"
        aria-live="polite"
      >
        {store.sync !== "live" && (
          <span className="inline-block px-3 py-0.5 rounded-full border border-border bg-panel text-text-muted text-1 font-semibold">
            {store.sync === "resyncing" ? "Resyncing..." : "Reconnecting..."}
          </span>
        )}
      </div>

      {boardCompleted ? (
        // The same shared completed-state treatment LiveApp mounts: the contribution mosaic in
        // place of the interactive grid, so `?demo=1` is a faithful, screenshottable preview of the
        // live bloom. The demo has no backend, so no `source`: the owner map is last-writer only,
        // resolved through mosaicMembers (which colors the seeded cells so the preview paints).
        <div
          className="board-wrap max-w-[620px] mx-auto"
          aria-label="Solved crossword grid"
        >
          <CompletedMosaic
            store={store}
            puzzle={puzzle}
            letters={fills}
            members={mosaicMembers}
            bloom={bloomOnCompletion}
          />
        </div>
      ) : (
        <div
          className="board-wrap outline-none max-w-[620px] mx-auto"
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label="Crossword grid. Arrow keys move, letters fill, Tab jumps clues."
        >
          <CrosswordGrid
            puzzle={puzzle}
            fills={fills}
            selection={selection}
            presence={presence}
            flashes={flashes}
            onCellClick={onCellClick}
            onFlashEnd={onFlashEnd}
          />
        </div>
      )}

      {store.status === "completed" && !dismissedCompletion && (
        // The completion card, layered over the mosaic board above exactly as in LiveApp: the
        // solved board is now the contribution mosaic (CompletedMosaic, the board swap above), so
        // dismissing this overlay leaves the player on the settled wash. The confetti and the
        // summary card are unchanged; the bloom happens on the board layer beneath. The full static
        // dial and plate still live below (MosaicDemo) for reviewing the frames in isolation.
        <CompletionOverlay
          stats={store.stats}
          fallbackSeconds={0}
          title={board.label}
          members={members}
          selfId={store.selfUserId ?? SELF_USER_ID}
          shareUrl={null}
          onDismiss={() => setDismissedCompletion(true)}
          onHome={() => window.location.assign("/")}
        />
      )}

      <MosaicDemo />
    </div>
  );
}
