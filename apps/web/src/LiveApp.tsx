// Live mode: the real GameStore driven by a real WebSocket to the session service, over
// the same store, grid, and engine navigation the demo uses. This is the path the M1
// Playwright smoke drives (two browsers on one game). It is gated on URL params so the
// default demo boards are untouched: `?api=<base>&game=<id>&token=<jwt>` (optional `ws=`
// overrides the game view's session endpoint). The store logic (src/store) is not touched;
// this is view and net wiring only.
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
  | { phase: "error"; message: string }
  | { phase: "ready"; connection: GameConnection; puzzle: Puzzle };

export function LiveApp({ params }: { params: URLSearchParams }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    let connection: GameConnection | null = null;

    void (async () => {
      const api = params.get("api");
      const game = params.get("game");
      const token = params.get("token");
      if (api === null || game === null || token === null) {
        setState({
          phase: "error",
          message: "live mode needs api, game, and token params",
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
  }, [params]);

  if (state.phase === "loading") {
    return <p className="app__subtitle">Connecting to the game...</p>;
  }
  if (state.phase === "error") {
    return <p className="app__subtitle">Live mode error: {state.message}</p>;
  }
  return <LiveGame connection={state.connection} puzzle={state.puzzle} />;
}

function LiveGame({
  connection,
  puzzle,
}: {
  connection: GameConnection;
  puzzle: Puzzle;
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
