import { useMemo, useRef, useState } from "react";
import type { Direction } from "@crossy/engine";
import type { Clue } from "../domain/types";
import { Button } from "@/components/ui/button";
import { ContributionMosaic, type MosaicState } from "../ui/ContributionMosaic";
import {
  MOSAIC_LETTERS,
  MOSAIC_OWNER_MAP,
  MOSAIC_PUZZLE,
  MOSAIC_ROSTER,
  SOLVERS,
} from "./mosaicFixture";
import { wordLoupeGeometry } from "../ui/wordLoupe";

type LensMode = "clear" | "refraction" | "frost";
type FocusMode = "etched" | "corners" | "well";

const MODE_COPY: Record<LensMode, { label: string; description: string }> = {
  clear: {
    label: "Clear",
    description: "Specular rim and clarity lift over the original paper.",
  },
  refraction: {
    label: "Liquid glass",
    description: "A thin, responsive surface whose edge catches the light.",
  },
  frost: {
    label: "Frosted control",
    description:
      "The intentionally softer comparison: useful, but less legible.",
  },
};

const FOCUS_COPY: Record<FocusMode, string> = {
  etched: "Etched frame",
  corners: "Corner reticle",
  well: "Focus well",
};

const allClues = [...MOSAIC_PUZZLE.acrossClues, ...MOSAIC_PUZZLE.downClues];

function clueKey(clue: Pick<Clue, "direction" | "number">): string {
  return `${clue.direction}:${clue.number}`;
}

function clueLabel(clue: Clue): string {
  const axis = clue.direction === "across" ? "Across" : "Down";
  const answer = clue.cells
    .map((cell) => MOSAIC_LETTERS.get(cell) ?? "·")
    .join("");
  return `${clue.number} ${axis} · ${clue.cells.length} · ${answer}`;
}

function longest(direction: Direction): Clue {
  const clues = allClues.filter((clue) => clue.direction === direction);
  const result = [...clues].sort((a, b) => b.cells.length - a.cells.length)[0];
  if (result === undefined) throw new Error(`fixture has no ${direction} clue`);
  return result;
}

const initialClue = longest("across");

function percent(value: number): string {
  return `${value}%`;
}

export function WordLoupeLab() {
  const lensRef = useRef<HTMLDivElement>(null);
  const [activeKey, setActiveKey] = useState(() => clueKey(initialClue));
  const [selectedCell, setSelectedCell] = useState(initialClue.cells[0]!);
  const [mode, setMode] = useState<LensMode>("refraction");
  const [focusMode, setFocusMode] = useState<FocusMode>("etched");
  const [strength, setStrength] = useState(58);
  // Defaults to the settled record (the blurred field): the frame the loupe actually floats
  // over on the live completed board; "wash" stays offered as the replay's crisp stress case.
  const [frame, setFrame] = useState<Exclude<MosaicState, "plate">>("settled");
  const [isolated, setIsolated] = useState(false);

  const activeClue =
    allClues.find((clue) => clueKey(clue) === activeKey) ?? initialClue;
  const direction = activeClue.direction;
  const directionClues = allClues.filter(
    (clue) => clue.direction === direction,
  );
  const selectedIndex = Math.max(0, activeClue.cells.indexOf(selectedCell));
  const geometry = useMemo(
    () =>
      wordLoupeGeometry(
        activeClue,
        selectedCell,
        MOSAIC_PUZZLE.cols,
        MOSAIC_PUZZLE.rows,
      ),
    [activeClue, selectedCell],
  );
  const answer = activeClue.cells
    .map((cell) => MOSAIC_LETTERS.get(cell) ?? "·")
    .join("");
  const sharedMosaic = {
    puzzle: MOSAIC_PUZZLE,
    letters: MOSAIC_LETTERS,
    ownerMap: MOSAIC_OWNER_MAP,
    roster: MOSAIC_ROSTER,
    behavior: { kind: "static", state: frame } as const,
    isolatedId: isolated ? SOLVERS[0]!.id : null,
  };

  const chooseClue = (clue: Clue, cell = clue.cells[0]!): void => {
    setActiveKey(clueKey(clue));
    setSelectedCell(clue.cells.includes(cell) ? cell : clue.cells[0]!);
  };

  const setAxis = (next: Direction): void => {
    const candidates = allClues.filter((clue) => clue.direction === next);
    const crossing = candidates.find((clue) =>
      clue.cells.includes(selectedCell),
    );
    chooseClue(crossing ?? longest(next), crossing ? selectedCell : undefined);
  };

  const moveClue = (delta: number): void => {
    const index = directionClues.findIndex(
      (clue) => clueKey(clue) === activeKey,
    );
    const next =
      directionClues[
        (index + delta + directionClues.length) % directionClues.length
      ];
    if (next !== undefined) chooseClue(next);
  };

  const moveFocus = (delta: number): void => {
    const next =
      activeClue.cells[
        (selectedIndex + delta + activeClue.cells.length) %
          activeClue.cells.length
      ];
    if (next !== undefined) setSelectedCell(next);
  };

  const selectBoardCell = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const col = Math.min(
      MOSAIC_PUZZLE.cols - 1,
      Math.floor(
        ((event.clientX - rect.left) / rect.width) * MOSAIC_PUZZLE.cols,
      ),
    );
    const row = Math.min(
      MOSAIC_PUZZLE.rows - 1,
      Math.floor(
        ((event.clientY - rect.top) / rect.height) * MOSAIC_PUZZLE.rows,
      ),
    );
    const cell = row * MOSAIC_PUZZLE.cols + col;
    const clue = directionClues.find((candidate) =>
      candidate.cells.includes(cell),
    );
    if (clue !== undefined) chooseClue(clue, cell);
    event.currentTarget.focus();
  };

  const onBoardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const along =
      direction === "across"
        ? event.key === "ArrowLeft" || event.key === "ArrowRight"
        : event.key === "ArrowUp" || event.key === "ArrowDown";
    if (along) {
      event.preventDefault();
      moveFocus(event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveClue(event.shiftKey ? -1 : 1);
    }
  };

  const moveLight = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const boardX = ((event.clientX - rect.left) / rect.width) * 100;
    const boardY = ((event.clientY - rect.top) / rect.height) * 100;
    const lensX = ((boardX - geometry.lens.left) / geometry.lens.width) * 100;
    const lensY = ((boardY - geometry.lens.top) / geometry.lens.height) * 100;
    lensRef.current?.style.setProperty(
      "--loupe-light-x",
      `${Math.max(-25, Math.min(125, lensX))}%`,
    );
    lensRef.current?.style.setProperty(
      "--loupe-light-y",
      `${Math.max(-40, Math.min(140, lensY))}%`,
    );
  };

  const resetLight = (): void => {
    lensRef.current?.style.removeProperty("--loupe-light-x");
    lensRef.current?.style.removeProperty("--loupe-light-y");
  };

  const lensStyle = {
    left: percent(geometry.lens.left),
    top: percent(geometry.lens.top),
    width: percent(geometry.lens.width),
    height: percent(geometry.lens.height),
    ["--loupe-strength" as string]: strength / 100,
  } as React.CSSProperties;
  const focusStyle = {
    left: percent(geometry.focus.left),
    top: percent(geometry.focus.top),
    width: percent(geometry.focus.width),
    height: percent(geometry.focus.height),
  };

  return (
    <div className="min-h-dvh bg-background px-4 py-5 text-text md:px-8 md:py-8">
      <div className="mx-auto max-w-[92rem]">
        <header className="max-w-[72ch]">
          <div className="text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-gold-11">
            Web material lab · completed analysis
          </div>
          <h1 className="mt-1 font-display text-8 font-medium tracking-tight">
            The word loupe
          </h1>
          <p className="mt-3 text-3 leading-relaxed text-text-muted">
            A clear optical tool floating above the contribution mosaic. The
            lens spans the active answer; the etched frame marks the selected
            square. Click the board, change axis, and push the material until it
            stops reading as glass.
          </p>
        </header>

        <div className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(34rem,1.35fr)_minmax(20rem,0.65fr)]">
          <section className="rounded-5 border border-border-strong bg-panel p-3 shadow-sm md:p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-dashed border-border-dashed pb-3">
              <div className="mr-auto min-w-0">
                <div className="text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-gold-11">
                  {activeClue.number} {direction}
                </div>
                <div className="mt-0.5 truncate font-display text-5 font-medium">
                  {answer}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => moveClue(-1)}
              >
                Previous clue
              </Button>
              <Button variant="secondary" size="sm" onClick={() => moveClue(1)}>
                Next clue
              </Button>
            </div>

            <div className="mx-auto max-w-[min(74vh,54rem)] rounded-2 bg-background p-2 shadow-inner md:p-3">
              <div
                className="loupe-lab-board relative aspect-square cursor-crosshair overflow-visible outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/60"
                role="application"
                tabIndex={0}
                aria-label={`${activeClue.number} ${direction}, word loupe lab. Arrow keys move the focus; Tab changes clue.`}
                onClick={selectBoardCell}
                onKeyDown={onBoardKeyDown}
                onPointerMove={moveLight}
                onPointerLeave={resetLight}
              >
                <ContributionMosaic
                  {...sharedMosaic}
                  ariaLabel="Settled contribution mosaic beneath the word loupe"
                />
                <div
                  ref={lensRef}
                  className="word-loupe"
                  data-mode={mode}
                  data-focus={focusMode}
                  style={lensStyle}
                  aria-hidden
                >
                  <div className="word-loupe-surface" />
                </div>
                <div
                  className="word-loupe-focus"
                  data-focus={focusMode}
                  style={focusStyle}
                  aria-hidden
                >
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-2 text-text-muted">
              <span>
                Click a cell · arrow keys move focus · Tab changes clue
              </span>
              <span className="font-mono tabular-nums">
                square {selectedIndex + 1}/{activeClue.cells.length} · paper
                untouched
              </span>
            </div>
          </section>

          <aside className="space-y-4">
            <ControlGroup
              eyebrow="Orientation"
              title="Choose the active answer"
            >
              <div className="grid grid-cols-2 gap-2">
                {(["across", "down"] as const).map((axis) => (
                  <Button
                    key={axis}
                    variant={direction === axis ? "default" : "secondary"}
                    onClick={() => setAxis(axis)}
                    className="capitalize"
                  >
                    {axis}
                  </Button>
                ))}
              </div>
              <label className="mt-3 block text-2 font-medium">
                Clue and edge case
                <select
                  className="mt-1.5 h-9 w-full rounded-2 border border-border bg-background px-3 text-2 outline-none focus-visible:ring-3 focus-visible:ring-focus-ring/50"
                  value={activeKey}
                  onChange={(event) => {
                    const clue = allClues.find(
                      (candidate) => clueKey(candidate) === event.target.value,
                    );
                    if (clue !== undefined) chooseClue(clue);
                  }}
                >
                  {allClues.map((clue) => (
                    <option key={clueKey(clue)} value={clueKey(clue)}>
                      {clueLabel(clue)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => moveFocus(-1)}>
                  Previous square
                </Button>
                <Button variant="secondary" onClick={() => moveFocus(1)}>
                  Next square
                </Button>
              </div>
            </ControlGroup>

            <ControlGroup eyebrow="Material" title="Find the glass register">
              <div className="space-y-2">
                {(Object.keys(MODE_COPY) as LensMode[]).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setMode(candidate)}
                    className={`w-full rounded-3 border p-3 text-left transition-colors ${
                      mode === candidate
                        ? "border-gold-9 bg-gold-3"
                        : "border-border bg-background hover:border-border-strong"
                    }`}
                  >
                    <span className="block text-2 font-semibold">
                      {MODE_COPY[candidate].label}
                    </span>
                    <span className="mt-0.5 block text-1 leading-relaxed text-text-muted">
                      {MODE_COPY[candidate].description}
                    </span>
                  </button>
                ))}
              </div>
              <label className="mt-4 block text-2 font-medium">
                Optical strength · {strength}%
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={strength}
                  onChange={(event) => setStrength(Number(event.target.value))}
                  className="loupe-lab-range mt-2 w-full"
                />
              </label>
            </ControlGroup>

            <ControlGroup eyebrow="Focus" title="Mark the selected square">
              <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                {(Object.keys(FOCUS_COPY) as FocusMode[]).map((candidate) => (
                  <Button
                    key={candidate}
                    variant={focusMode === candidate ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setFocusMode(candidate)}
                  >
                    {FOCUS_COPY[candidate]}
                  </Button>
                ))}
              </div>
            </ControlGroup>

            <ControlGroup eyebrow="Stress" title="Change what sits beneath it">
              <div className="grid grid-cols-4 gap-2">
                {(["ink", "wash", "settled", "field"] as const).map((state) => (
                  <Button
                    key={state}
                    variant={frame === state ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setFrame(state)}
                    className="capitalize"
                  >
                    {state}
                  </Button>
                ))}
              </div>
              <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-2 border border-border bg-background px-3 py-2 text-2 font-medium">
                Isolate one solver
                <input
                  type="checkbox"
                  checked={isolated}
                  onChange={(event) => setIsolated(event.target.checked)}
                  className="size-4 accent-[var(--color-gold-9)]"
                />
              </label>
            </ControlGroup>
          </aside>
        </div>

        <section className="mt-8 grid gap-3 md:grid-cols-3">
          <Criterion title="Direction">
            The word silhouette must read Across or Down before the clue label
            is parsed.
          </Criterion>
          <Criterion title="Truth">
            Letters, clue numbers, lattice, and owner colors must remain
            identifiable through the optic.
          </Criterion>
          <Criterion title="Attachment">
            The lens and etched focus must feel locked to cell geometry while
            resizing and moving.
          </Criterion>
        </section>
      </div>
    </div>
  );
}

function ControlGroup({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-4 border border-border bg-panel p-4 shadow-sm">
      <div className="text-1 font-semibold uppercase tracking-[var(--tracking-caps)] text-gold-11">
        {eyebrow}
      </div>
      <h2 className="mb-3 mt-0.5 font-display text-4 font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Criterion({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-4 border border-dashed border-border-dashed bg-panel px-4 py-3">
      <div className="text-2 font-semibold">{title}</div>
      <p className="mt-1 text-2 leading-relaxed text-text-muted">{children}</p>
    </div>
  );
}
