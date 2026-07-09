// Live mode: the real GameStore driven by a real WebSocket to the session service, over
// the same store, grid, and engine navigation the demo uses. This is the path the M1
// Playwright smoke drives (two browsers on one game). It is gated on `?game=<id>`.
//
// Token and api sourcing (Track A). The api base defaults to config.apiBase and the access
// token to the Identity port; both keep an explicit URL override so existing links keep
// working. `?api=<base>` overrides the configured api base and `?token=<jwt>` overrides the
// identity token, which is exactly what the M1 smoke and dogfood links pass. `?ws=` still
// overrides the game view's session endpoint. The store logic (src/store) is not touched.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Grid } from "@crossy/engine";
import { connectToGame } from "./net/connect";
import type { GameConnection } from "./net/connect";
import { computeLayout } from "./domain/layout";
import type { Puzzle } from "./domain/types";
import {
  cellClick,
  clueClick,
  initialSelection,
  keyEffect,
} from "./input/actions";
import type { Selection } from "./input/actions";
import { CrosswordGrid } from "./ui/CrosswordGrid";
import type { FlashEntry, PresenceEntry } from "./ui/CrosswordGrid";
import { AuthBar } from "./ui/AuthBar";
import type { AppConfig } from "./config/config";
import type { Identity } from "./identity";

/** The solution-stripped puzzle facts the game view carries (ClientPuzzle, PROTOCOL.md §12). */
interface ClientPuzzleView {
  rows: number;
  cols: number;
  blocks: readonly number[];
  circles?: readonly number[];
}

interface GameView {
  puzzle: ClientPuzzleView;
  session: { ws: string };
}

/** Build the view-side Puzzle (numbering, clue runs) from the client puzzle geometry. */
function toPuzzle(cp: ClientPuzzleView): Puzzle {
  const blocks = new Set(cp.blocks);
  const { numbers, acrossClues, downClues } = computeLayout(
    cp.cols,
    cp.rows,
    blocks,
  );
  return {
    cols: cp.cols,
    rows: cp.rows,
    blocks,
    numbers,
    circles: new Set(cp.circles ?? []),
    wrong: new Set(),
    acrossClues,
    downClues,
  };
}

type LoadState =
  | { phase: "loading" }
  | { phase: "needs-auth"; message: string }
  | { phase: "error"; message: string }
  | { phase: "ready"; connection: GameConnection; puzzle: Puzzle };

export function LiveApp({
  params,
  config,
  identity,
}: {
  params: URLSearchParams;
  config: AppConfig;
  identity: Identity;
}) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  // Re-run the loader when the session changes, so signing in from the needs-auth screen
  // retries with a fresh token without a page reload.
  const [authTick, setAuthTick] = useState(0);
  useEffect(
    () => identity.onChange(() => setAuthTick((t) => t + 1)),
    [identity],
  );

  useEffect(() => {
    let cancelled = false;
    let connection: GameConnection | null = null;

    void (async () => {
      const game = params.get("game");
      // ?api= and ?token= are explicit overrides; otherwise config and the identity port win.
      const api = params.get("api") ?? config.apiBase;
      const token = params.get("token") ?? (await identity.getAccessToken());
      if (game === null) {
        setState({ phase: "error", message: "live mode needs a game id" });
        return;
      }
      if (api === "") {
        setState({
          phase: "error",
          message: "no api base configured (set API_BASE or pass ?api=)",
        });
        return;
      }
      if (token === null) {
        setState({
          phase: "needs-auth",
          message: "Sign in to join this game.",
        });
        return;
      }
      const res = await fetch(`${api}/games/${game}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setState({ phase: "error", message: `game view ${res.status}` });
        return;
      }
      const view = (await res.json()) as GameView;
      const wsUrl = params.get("ws") ?? view.session.ws;
      const puzzle = toPuzzle(view.puzzle);
      connection = connectToGame({ url: wsUrl, token });
      if (cancelled) {
        connection.close();
        return;
      }
      // Smoke-test hooks: read convergence and drop the socket mid-word from the page.
      (window as unknown as Record<string, unknown>)["__crossy"] = {
        store: connection.store,
        drop: () => connection?.transport.simulateDrop(),
      };
      setState({ phase: "ready", connection, puzzle });
    })().catch((err: unknown) => {
      if (!cancelled) setState({ phase: "error", message: String(err) });
    });

    return () => {
      cancelled = true;
      connection?.close();
    };
  }, [params, config, identity, authTick]);

  if (state.phase === "loading") {
    return <p className="app__subtitle">Connecting to the game...</p>;
  }
  if (state.phase === "needs-auth") {
    return (
      <div className="app">
        <header className="app__header">
          <h1 className="app__title">Crossy</h1>
          <AuthBar identity={identity} config={config} />
        </header>
        <p className="app__subtitle">{state.message}</p>
      </div>
    );
  }
  if (state.phase === "error") {
    return <p className="app__subtitle">Live mode error: {state.message}</p>;
  }
  return (
    <LiveGame
      connection={state.connection}
      puzzle={state.puzzle}
      config={config}
      identity={identity}
    />
  );
}

function LiveGame({
  connection,
  puzzle,
  config,
  identity,
}: {
  connection: GameConnection;
  puzzle: Puzzle;
  config: AppConfig;
  identity: Identity;
}) {
  const store = connection.store;
  const grid: Grid = useMemo(
    () => ({ cols: puzzle.cols, rows: puzzle.rows, blocks: puzzle.blocks }),
    [puzzle],
  );
  const [selection, setSelection] = useState<Selection>(() =>
    initialSelection(grid),
  );
  const [flashes, setFlashes] = useState<ReadonlyMap<number, FlashEntry>>(
    new Map(),
  );
  const flashNonce = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);

  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const frozen = store.status !== "ongoing";

  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  // Conflict flash (Decision 2.1d-1): the store detects, the view fades the writer's color.
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

  const allClues = [...puzzle.acrossClues, ...puzzle.downClues];
  const clue = allClues.find(
    (c) =>
      c.direction === selection.direction && c.cells.includes(selection.cell),
  );

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Crossy</h1>
        <AuthBar identity={identity} config={config} />
      </header>

      <div className="pill-row" aria-live="polite">
        {store.sync !== "live" && (
          <span className="conn-pill">
            {store.sync === "resyncing" ? "Resyncing..." : "Reconnecting..."}
          </span>
        )}
      </div>

      <div className="clue-bar" aria-live="polite">
        {clue ? (
          <>
            <button
              type="button"
              className="clue-bar__tag"
              onClick={() => {
                gridRef.current?.focus();
                setSelection(clueClick(clue));
              }}
            >
              {clue.number} {clue.direction.toUpperCase()}
            </button>
            <span className="clue-bar__cells">
              {clue.cells.map((c) => fills.get(c) ?? "·").join("")}
            </span>
          </>
        ) : (
          <span className="clue-bar__tag clue-bar__tag--empty">
            No word on this axis
          </span>
        )}
      </div>

      <div
        className="grid-wrap"
        data-testid="grid"
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Crossword grid"
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

      <p className="demo__status" data-testid="status">
        {store.status} / seq {store.seq} / {store.sync}
      </p>
    </div>
  );
}
