// The Wave 2.1d web client skeleton: the real GameStore (INV-10 overlay, three
// connection states) driven through a fake in-memory session on the demo boards,
// with every cursor move going through @crossy/engine's navigation ops per the
// desktop interaction spec (ROADMAP "Wave 2.1d desktop interaction spec"). The
// wire transport (src/net) plugs into the same store in Wave 2.2.
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

type Theme = "light" | "dark";

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

export function App() {
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

  // Conflict flash (Decision 2.1d-1): the store detects the PROTOCOL section 8
  // trigger; the view fills the cell with the writer's color and fades it out.
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

  // The rendered composite (INV-10): sequenced cells painted with the overlay.
  // Pending letters go through the identical path as confirmed ones (2.1d-4).
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

  // Teammate presence: cursors joined with participants for color and initial,
  // grouped per cell (DESIGN section 10 bottom-right anchoring).
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
    if (e.ctrlKey || e.metaKey || e.altKey) return; // chords left to the browser
    const effect = keyEffect(
      { grid, filled, selection, frozen },
      e.key,
      e.shiftKey,
    );
    if (effect === null) return; // Enter, Escape, non-charset keys: browser default
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
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">Crossy web skeleton</h1>
          <p className="app__subtitle">
            Wave 2.1d. The real store and engine navigation on fake data; the
            demo strip stands in for teammates and the network until Wave 2.2
            wires the live session service.
          </p>
        </div>
      </header>

      <SettingsStrip
        boardId={boardId}
        boards={boards.map((b) => ({ id: b.id, label: b.label }))}
        onBoard={switchBoard}
        theme={theme}
        onTheme={setTheme}
      />

      <div className="demo">
        <span className="settings__label">Demo</span>
        <div className="demo__buttons">
          <button
            type="button"
            onClick={() => session.scribble(selection.cell)}
          >
            Teammate scribble
          </button>
          <button
            type="button"
            onClick={() => session.gapEvent(selection.cell)}
          >
            Lose an event
          </button>
          <button type="button" onClick={() => session.dropConnection()}>
            Drop connection
          </button>
          <button type="button" onClick={() => session.completeGame()}>
            Complete game
          </button>
          <button type="button" onClick={() => session.reset()}>
            Reset board
          </button>
        </div>
        <span className="demo__status">
          {store.status} / seq {store.seq} / {store.sync}
        </span>
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
              title="Jump to this clue's start"
            >
              {clue.number} {clue.direction.toUpperCase()}
            </button>
            <span className="clue-bar__cells">{clueCells}</span>
          </>
        ) : (
          <span className="clue-bar__tag clue-bar__tag--empty">
            No word on this axis
          </span>
        )}
      </div>

      <div className="pill-row" aria-live="polite">
        {store.sync !== "live" && (
          <span className="conn-pill">
            {store.sync === "resyncing" ? "Resyncing..." : "Reconnecting..."}
          </span>
        )}
      </div>

      <div
        className="grid-wrap"
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

      <p className="hint">
        Click a cell to focus the grid, click it again to toggle across/down.
        Letters and digits fill and advance with filled-skip; <code>Tab</code>{" "}
        and <code>Shift+Tab</code> jump clues; arrows move along the axis with
        block-skip and toggle it across; <code>Backspace</code> or{" "}
        <code>Delete</code> clears and steps back; <code>Space</code> clears and
        advances one cell (never toggles). After Complete game the board freezes
        for typing but stays navigable.
      </p>
    </div>
  );
}
