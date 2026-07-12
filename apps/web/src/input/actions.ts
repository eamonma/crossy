// The Wave 2.1d keyboard map and pointer paths (ROADMAP "Wave 2.1d desktop
// interaction spec"), as pure transforms: environment plus key in, next selection
// plus mutations out. Every cursor move goes through packages/engine's navigation
// ops, so the input layer cannot drift from the navigation vectors (the throwaway
// playground module this replaces is deleted).
import { backspaceTarget, getNextCell, tabTarget } from "@crossy/engine";
import type { Direction, Grid, Toward } from "@crossy/engine";
import {
  DEFAULT_NAV_PREFS,
  type NavPrefs,
  typingAdvanceWithPrefs,
} from "./prefs";

export interface Selection {
  readonly cell: number;
  readonly direction: Direction;
}

export type Mutation =
  | {
      readonly type: "placeLetter";
      readonly cell: number;
      readonly value: string;
    }
  | { readonly type: "clearCell"; readonly cell: number };

export interface KeyEffect {
  readonly selection: Selection;
  readonly mutations: readonly Mutation[];
}

export interface InputEnv {
  readonly grid: Grid;
  /** Cells currently rendering non-null (sequenced plus overlay, INV-10). */
  readonly filled: ReadonlySet<number>;
  readonly selection: Selection;
  /** True after completed or abandoned: navigation stays live, mutation freezes
   * locally and never reaches the wire (ROADMAP 2.1d terminal-state rule). */
  readonly frozen: boolean;
  /** Personal navigation prefs (settings slice 1). Optional so callers that predate the
   * prefs keep today's behavior: absent means DEFAULT_NAV_PREFS, which reproduces the
   * engine's vector-pinned typingAdvance exactly. Prefs live in the app, never the engine. */
  readonly prefs?: NavPrefs;
}

const ASCII_LETTER_OR_DIGIT = /^[A-Z0-9]$/;

/** ASCII-only uppercase (INV-1): map a-z to A-Z, leave every other code point alone. */
function asciiUpper(ch: string): string {
  const code = ch.charCodeAt(0);
  return code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : ch;
}

/** A handled key that does nothing: the frozen-mutation refusal. */
function refused(env: InputEnv): KeyEffect {
  return { selection: env.selection, mutations: [] };
}

/**
 * Map one key press onto the spec's keyboard map. Returns null for keys the map
 * does not handle (Enter, Escape, modifier survivors, non-charset characters), so
 * the caller leaves the browser default alone.
 */
export function keyEffect(
  env: InputEnv,
  key: string,
  shiftKey: boolean,
): KeyEffect | null {
  const { grid, filled, selection } = env;
  const { cell, direction } = selection;

  switch (key) {
    case "ArrowLeft":
      return arrow(env, "across", "backward");
    case "ArrowRight":
      return arrow(env, "across", "forward");
    case "ArrowUp":
      return arrow(env, "down", "backward");
    case "ArrowDown":
      return arrow(env, "down", "forward");
    case "Tab": {
      const target = tabTarget(
        grid,
        direction,
        cell,
        shiftKey ? "backward" : "forward",
        filled,
      );
      return {
        selection: { cell: target.cell, direction: target.direction },
        mutations: [],
      };
    }
    case "Backspace":
    case "Delete": {
      if (env.frozen) return refused(env);
      const target = backspaceTarget(grid, direction, cell, filled);
      return {
        selection: { cell: target, direction },
        // Clear wherever it lands; skip the wire no-op when it is already empty.
        mutations: filled.has(target)
          ? [{ type: "clearCell", cell: target }]
          : [],
      };
    }
    case " ": {
      // Decision 2.1d-5: clear the current cell and advance exactly one cell
      // forward within the word, no filled-skip, clamping at the word end
      // (space-clear-advance.json). Space mutates, so it freezes after a
      // terminal state.
      if (env.frozen) return refused(env);
      const next = getNextCell(grid, direction, cell, "forward", false);
      return {
        selection: { cell: next, direction },
        mutations: filled.has(cell) ? [{ type: "clearCell", cell }] : [],
      };
    }
    default: {
      if (key.length !== 1) return null;
      const value = asciiUpper(key);
      if (!ASCII_LETTER_OR_DIGIT.test(value)) return null;
      if (env.frozen) return refused(env);
      // The typing op, steered by the personal nav prefs (settings slice 1): filled-skip
      // inside the word against the board after this keystroke, then the chosen end-of-word
      // behavior (wrap to first blank or advance to the next clue). Defaults reproduce the
      // engine's vector-pinned typingAdvance (typing-advance.json, full-word-asymmetry.json).
      // A next-clue jump can cross axes, so we take the direction the advance reports.
      const filledAfter = new Set(filled);
      filledAfter.add(cell);
      const next = typingAdvanceWithPrefs(
        grid,
        direction,
        cell,
        filledAfter,
        env.prefs ?? DEFAULT_NAV_PREFS,
      );
      return {
        selection: { cell: next.cell, direction: next.direction },
        mutations: [{ type: "placeLetter", cell, value }],
      };
    }
  }
}

/** Arrow along the current axis moves one block-skipping cell; across it, toggles
 * the axis without moving (DESIGN section 5; single-cell-advance.json). */
function arrow(env: InputEnv, axis: Direction, toward: Toward): KeyEffect {
  const { grid, selection } = env;
  if (axis !== selection.direction) {
    return {
      selection: { cell: selection.cell, direction: axis },
      mutations: [],
    };
  }
  const next = getNextCell(grid, axis, selection.cell, toward);
  return { selection: { cell: next, direction: axis }, mutations: [] };
}

/**
 * Pointer path 1 and 2 (v2 verbatim): a playable non-current cell moves the cursor
 * and keeps direction; the current cell toggles direction; a block returns null
 * (no-op). Clicks never mutate, so they stay live after a terminal state.
 */
export function cellClick(
  grid: Grid,
  selection: Selection,
  cell: number,
): Selection | null {
  if (grid.blocks.has(cell)) return null;
  if (cell === selection.cell) {
    return {
      cell,
      direction: selection.direction === "across" ? "down" : "across",
    };
  }
  return { cell, direction: selection.direction };
}

/** Pointer path 3: jump to the clue's start unconditionally, set its axis. No
 * first-empty scan runs here; this is neither Tab nor Shift+Tab. */
export function clueClick(clue: {
  readonly direction: Direction;
  readonly cells: readonly number[];
}): Selection {
  return { cell: clue.cells[0] ?? 0, direction: clue.direction };
}

/** The initial position: first playable cell, direction across (DESIGN section 5). */
export function initialSelection(grid: Grid): Selection {
  return {
    cell: getNextCell(grid, "across", -1, "forward"),
    direction: "across",
  };
}
