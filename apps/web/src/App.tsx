import { useEffect, useReducer, useRef } from "react";
import { boardById, boards } from "./domain/boards";
import {
  backspace,
  initialSelection,
  moveByArrow,
  selectCell,
  tabToClue,
  toggleDirection,
  typeLetter,
} from "./domain/navigation";
import type {
  BackspaceMode,
  Clue,
  Direction,
  Grid,
  Selection,
  ShiftTabMode,
  Toward,
} from "./domain/types";
import { CrosswordGrid } from "./ui/CrosswordGrid";
import { SettingsStrip } from "./ui/SettingsStrip";

type Theme = "light" | "dark";

interface State {
  boardId: string;
  fills: Map<number, string>;
  selection: Selection;
  shiftTabMode: ShiftTabMode;
  backspaceMode: BackspaceMode;
  theme: Theme;
}

type Action =
  | { kind: "arrow"; axis: Direction; toward: Toward }
  | { kind: "type"; char: string }
  | { kind: "backspace" }
  | { kind: "tab"; toward: Toward }
  | { kind: "click"; cell: number }
  | { kind: "toggleDir" }
  | { kind: "setBoard"; id: string }
  | { kind: "setShiftTab"; mode: ShiftTabMode }
  | { kind: "setBackspace"; mode: BackspaceMode }
  | { kind: "setTheme"; theme: Theme };

function gridOf(boardId: string): Grid {
  const p = boardById(boardId).puzzle;
  return { cols: p.cols, rows: p.rows, blocks: p.blocks };
}

function reducer(state: State, action: Action): State {
  const grid = gridOf(state.boardId);
  const puzzle = boardById(state.boardId).puzzle;

  switch (action.kind) {
    case "arrow":
      return {
        ...state,
        selection: moveByArrow(
          grid,
          state.selection,
          action.axis,
          action.toward,
        ),
      };
    case "type": {
      const out = typeLetter(grid, state.fills, state.selection, action.char);
      return {
        ...state,
        selection: out.selection,
        fills: out.fills ?? state.fills,
      };
    }
    case "backspace": {
      const out = backspace(
        grid,
        state.fills,
        state.selection,
        state.backspaceMode,
      );
      return {
        ...state,
        selection: out.selection,
        fills: out.fills ?? state.fills,
      };
    }
    case "tab": {
      const clues: Clue[] = [...puzzle.acrossClues, ...puzzle.downClues];
      return {
        ...state,
        selection: tabToClue(
          grid,
          state.fills,
          clues,
          state.selection,
          action.toward,
          state.shiftTabMode,
        ),
      };
    }
    case "click":
      return {
        ...state,
        selection: selectCell(grid, state.selection, action.cell),
      };
    case "toggleDir":
      return { ...state, selection: toggleDirection(state.selection) };
    case "setBoard": {
      const board = boardById(action.id);
      return {
        ...state,
        boardId: action.id,
        fills: new Map(board.initialFills),
        selection: initialSelection(gridOf(action.id)),
      };
    }
    case "setShiftTab":
      return { ...state, shiftTabMode: action.mode };
    case "setBackspace":
      return { ...state, backspaceMode: action.mode };
    case "setTheme":
      return { ...state, theme: action.theme };
  }
}

function initState(): State {
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const board = boards[0];
  if (!board) throw new Error("no boards defined");
  return {
    boardId: board.id,
    fills: new Map(board.initialFills),
    selection: initialSelection(gridOf(board.id)),
    shiftTabMode: "v2-asymmetric",
    backspaceMode: "v2-cross-block",
    theme: prefersDark ? "dark" : "light",
  };
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
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const gridRef = useRef<HTMLDivElement>(null);
  const board = boardById(state.boardId);
  const puzzle = board.puzzle;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        return dispatch({ kind: "arrow", axis: "across", toward: "backward" });
      case "ArrowRight":
        e.preventDefault();
        return dispatch({ kind: "arrow", axis: "across", toward: "forward" });
      case "ArrowUp":
        e.preventDefault();
        return dispatch({ kind: "arrow", axis: "down", toward: "backward" });
      case "ArrowDown":
        e.preventDefault();
        return dispatch({ kind: "arrow", axis: "down", toward: "forward" });
      case "Tab":
        e.preventDefault();
        return dispatch({
          kind: "tab",
          toward: e.shiftKey ? "backward" : "forward",
        });
      case "Backspace":
      case "Delete":
        e.preventDefault();
        return dispatch({ kind: "backspace" });
      case " ":
        e.preventDefault();
        return dispatch({ kind: "toggleDir" });
      default:
        if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
          e.preventDefault();
          dispatch({ kind: "type", char: e.key });
        }
    }
  }

  const allClues: Clue[] = [...puzzle.acrossClues, ...puzzle.downClues];
  const clue = activeClue(allClues, state.selection);
  const clueCells = clue
    ? clue.cells.map((c) => state.fills.get(c) ?? "·").join("")
    : "";

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">Crossy UX playground</h1>
          <p className="app__subtitle">
            Wave 1.1h. Fake data, no server. Grid and input model on trial
            before the real store lands.
          </p>
        </div>
      </header>

      <SettingsStrip
        boardId={state.boardId}
        boards={boards.map((b) => ({ id: b.id, label: b.label }))}
        onBoard={(id) => dispatch({ kind: "setBoard", id })}
        shiftTabMode={state.shiftTabMode}
        onShiftTab={(mode) => dispatch({ kind: "setShiftTab", mode })}
        backspaceMode={state.backspaceMode}
        onBackspace={(mode) => dispatch({ kind: "setBackspace", mode })}
        theme={state.theme}
        onTheme={(theme) => dispatch({ kind: "setTheme", theme })}
      />

      <div className="clue-bar" aria-live="polite">
        {clue ? (
          <>
            <span className="clue-bar__tag">
              {clue.number} {clue.direction.toUpperCase()}
            </span>
            <span className="clue-bar__cells">{clueCells}</span>
          </>
        ) : (
          <span className="clue-bar__tag">No word on this axis</span>
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
          fills={state.fills}
          selection={state.selection}
          teammates={board.teammates}
          onCellClick={(cell) => {
            gridRef.current?.focus();
            dispatch({ kind: "click", cell });
          }}
        />
      </div>

      <p className="hint">
        Click a cell to focus the grid. Type to fill and watch the advance; at a
        word end it wraps to the first empty cell. <code>Tab</code> and{" "}
        <code>Shift+Tab</code> jump clues, <code>Space</code> or a click on the
        focused cell toggles across/down, arrows move with block-skip,{" "}
        <code>Backspace</code> clears and steps back. Flip the two toggles above
        to feel each open decision.
      </p>
    </div>
  );
}
