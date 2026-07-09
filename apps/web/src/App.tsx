// Client routing (SPA, no server routing): query params select the surface. `?game=<id>` (plus
// optional `?code=`, and the smoke's `?api=`/`?token=`) drives the live game; `?create=1` is the
// upload flow; `?demo=1` keeps the old fake-session boards for hacking; everything else is the
// landing hero. Navigation is pushState so the app never full-reloads between screens, and the
// identity session survives. The M1 smoke path (`?game=`) is unchanged.
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
import {
  cellClick,
  clueClick,
  initialSelection,
  keyEffect,
} from "./input/actions";
import type { Selection } from "./input/actions";
import { CrosswordGrid } from "./ui/CrosswordGrid";
import type { FlashEntry, PresenceEntry } from "./ui/CrosswordGrid";
import { SettingsStrip } from "./ui/SettingsStrip";
import { AuthBar } from "./ui/AuthBar";
import { Landing } from "./ui/Landing";
import { CreateGame } from "./ui/CreateGame";
import { Button } from "@/components/ui/button";
import { ThemeProvider } from "./ui/useTheme";
import { LiveApp } from "./LiveApp";
import type { AppConfig } from "./config/config";
import type { Identity } from "./identity";
import type { Navigate } from "./nav";

type Theme = "light" | "dark";

/**
 * The root: one theme provider around the router. A real game (`?game=<id>`) drives the live
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
      <Router config={config} identity={identity} />
    </ThemeProvider>
  );
}

function Router({
  config,
  identity,
}: {
  config: AppConfig;
  identity: Identity;
}) {
  const [search, setSearch] = useState(() =>
    typeof window === "undefined" ? "" : window.location.search,
  );

  useEffect(() => {
    const onPop = (): void => setSearch(window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback<Navigate>((next) => {
    window.history.pushState({}, "", window.location.pathname + next);
    setSearch(next);
    window.scrollTo(0, 0);
  }, []);

  const params = useMemo(() => new URLSearchParams(search), [search]);

  if (params.get("game") !== null) {
    return (
      <LiveApp
        params={params}
        config={config}
        identity={identity}
        navigate={navigate}
      />
    );
  }
  if (params.get("create") !== null) {
    return (
      <CreateGame config={config} identity={identity} navigate={navigate} />
    );
  }
  if (params.get("demo") !== null) {
    return <DemoApp config={config} identity={identity} />;
  }
  return (
    <Landing
      identity={identity}
      config={config}
      onCreate={() => navigate("?create=1")}
    />
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
  const flashNonce = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const store = session.store;
  const version = useSyncExternalStore(store.subscribe, store.getVersion);

  const board = boardById(boardId);
  const puzzle = board.puzzle;
  const grid = useMemo(() => gridOf(boardId), [boardId]);
  const frozen = store.status !== "ongoing";

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
        color: participant?.color ?? "#3e63dd",
        direction: cursor.direction,
      };
      const list = byCell.get(cursor.cell);
      if (list === undefined) byCell.set(cursor.cell, [entry]);
      else list.push(entry);
    }
    return byCell;
  }, [store, version]);

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
      { grid, filled, selection, frozen },
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
    </div>
  );
}
