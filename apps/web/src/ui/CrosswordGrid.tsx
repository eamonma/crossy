// SVG crossword grid, DESIGN.md §10 plus the v2 pixel constants from SP6. One cell is a
// 36-unit module; the whole grid scales to fit. Background precedence, stroke, clue
// numbers, circles, and teammate cursors follow the recovered constants exactly.
import { wordCells } from "../domain/navigation";
import type { Grid, Puzzle, Selection, Teammate } from "../domain/types";

const CELL = 36;

interface Props {
  puzzle: Puzzle;
  fills: ReadonlyMap<number, string>;
  selection: Selection;
  teammates: readonly Teammate[];
  onCellClick: (cell: number) => void;
}

// Background precedence (SP6, DESIGN.md §10):
// black square > current cell > check/cross-reference > active word > teammate-here > default.
function cellRole(
  cell: number,
  puzzle: Puzzle,
  selection: Selection,
  activeWord: ReadonlySet<number>,
  teammateCells: ReadonlySet<number>,
): string {
  if (puzzle.blocks.has(cell)) return "block";
  if (cell === selection.cell) return "current";
  if (puzzle.wrong.has(cell)) return "wrong";
  if (activeWord.has(cell)) return "word";
  if (teammateCells.has(cell)) return "teammate";
  return "default";
}

// Across cursor is a right-pointing triangle, down is a downward one, in a 12x12 box
// scaled to 7x7 at the cell's top-right (SP6: 7x7 at +27,+3, --indigo-11).
function cursorPath(direction: Teammate["direction"]): string {
  return direction === "across" ? "M0 0 L12 6 L0 12 Z" : "M0 0 L6 12 L12 0 Z";
}

export function CrosswordGrid({
  puzzle,
  fills,
  selection,
  teammates,
  onCellClick,
}: Props) {
  const { cols, rows } = puzzle;
  const grid: Grid = { cols, rows, blocks: puzzle.blocks };
  const activeWord = new Set(
    wordCells(grid, selection.direction, selection.cell),
  );

  const teammatesByCell = new Map<number, Teammate[]>();
  for (const t of teammates) {
    const list = teammatesByCell.get(t.cell) ?? [];
    list.push(t);
    teammatesByCell.set(t.cell, list);
  }
  const teammateCells = new Set(teammatesByCell.keys());

  const cells = [];
  for (let cell = 0; cell < cols * rows; cell++) {
    const x = (cell % cols) * CELL;
    const y = Math.floor(cell / cols) * CELL;
    const isBlock = puzzle.blocks.has(cell);
    const role = cellRole(cell, puzzle, selection, activeWord, teammateCells);
    const number = puzzle.numbers.get(cell);
    const value = fills.get(cell);
    const here = teammatesByCell.get(cell) ?? [];
    const letterX = here.length > 0 ? x + CELL / 2 - 3 : x + CELL / 2;

    cells.push(
      <g key={cell}>
        <rect
          x={x}
          y={y}
          width={CELL}
          height={CELL}
          fill={`var(--cell-${role})`}
          stroke="var(--stroke)"
          strokeWidth={0.6}
          onClick={isBlock ? undefined : () => onCellClick(cell)}
          style={{ cursor: isBlock ? "default" : "pointer" }}
        />
        {puzzle.circles.has(cell) && (
          <circle
            cx={x + CELL / 2}
            cy={y + CELL / 2}
            r={CELL / 2.1}
            fill="none"
            stroke="var(--circle)"
            strokeWidth={0.8}
          />
        )}
        {number !== undefined && (
          <text
            x={x + 2}
            y={y + 10}
            fontSize={10}
            fontWeight={700}
            fill="var(--clue-number)"
          >
            {number}
          </text>
        )}
        {value !== undefined && !isBlock && (
          <text
            x={letterX}
            y={y + 32}
            fontSize={24}
            textAnchor="middle"
            fill="var(--letter)"
          >
            {value}
          </text>
        )}
        {here.length === 1 && here[0] && (
          <>
            <g
              transform={`translate(${x + 27},${y + 3}) scale(${7 / 12})`}
              fill="var(--presence-arrow)"
            >
              <path d={cursorPath(here[0].direction)} />
            </g>
            <circle
              cx={x + 30}
              cy={y + 30}
              r={5}
              fill="var(--presence-avatar-bg)"
            />
            <text
              x={x + 30}
              y={y + 30}
              fontSize={8}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--presence-avatar-fg)"
            >
              {here[0].initial}
            </text>
          </>
        )}
        {here.length > 1 && (
          <>
            <circle
              cx={x + 29}
              cy={y + 29}
              r={7}
              fill="var(--presence-badge)"
            />
            <text
              x={x + 29}
              y={y + 29}
              fontSize={9}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--presence-avatar-fg)"
            >
              {here.length}
            </text>
          </>
        )}
      </g>,
    );
  }

  return (
    <svg
      className="grid"
      viewBox={`0 0 ${cols * CELL} ${rows * CELL}`}
      role="img"
      aria-label={`${cols} by ${rows} crossword grid`}
    >
      {cells}
    </svg>
  );
}
