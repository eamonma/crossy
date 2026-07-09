// fast-check generators for randomized multi-client programs. A program is a set of
// clients, a small puzzle, and a stream of steps. The generators bias toward steps that
// keep state moving (place, deliver) while still drawing the faults the protocol must
// survive (single-frame loss, disconnect, reconnect). Everything a program needs is in
// the generated value, so a shrunk counterexample is a small, self-contained script.

import fc from "fast-check";
import { Sim } from "./sim";
import type { RawAction, SimClientSpec, SimPuzzle } from "./sim";

export interface Program {
  readonly clients: SimClientSpec[];
  readonly puzzle: SimPuzzle;
  readonly actions: RawAction[];
}

/**
 * The convergence/order/idempotency puzzles: a handful of tiny grids, some with blocks, so
 * the generator exercises block-cell rejections and multi-row geometry without blowing up
 * the state space. Solutions are single letters from a small alphabet.
 */
const CONVERGENCE_PUZZLES: readonly SimPuzzle[] = [
  { rows: 1, cols: 3, blocks: [], solution: ["A", "B", "C"] },
  { rows: 2, cols: 2, blocks: [], solution: ["A", "B", "C", "D"] },
  {
    rows: 2,
    cols: 3,
    blocks: [2],
    solution: ["A", "B", null, "C", "D", "E"],
  },
  {
    rows: 3,
    cols: 3,
    blocks: [4],
    solution: ["A", "B", "C", "D", null, "E", "F", "G", "H"],
  },
];

/**
 * Value tokens a place step can send. Correct letters mingle with a wrong letter and two
 * malformed tokens, so the generator also drives INVALID_VALUE and overwrite paths. The
 * store sends them verbatim; the server normalizes and validates (PROTOCOL.md section 5).
 */
const VALUE_TOKENS = ["A", "B", "C", "D", "E", "Z", "!!", ""] as const;

function clientSpecsArb(): fc.Arbitrary<SimClientSpec[]> {
  return fc
    .array(fc.constantFrom<"solver" | "spectator">("solver", "spectator"), {
      minLength: 2,
      maxLength: 4,
    })
    .map((roles) => {
      // At least one solver, or nothing can ever mutate and the run is vacuous.
      const specs = roles.map((role) => ({ role }));
      if (!specs.some((s) => s.role === "solver"))
        specs[0] = { role: "solver" };
      return specs;
    });
}

function actionArb(
  numClients: number,
  numCells: number,
): fc.Arbitrary<RawAction> {
  return fc.record({
    // Repeats bias the mix toward keeping state and frames moving.
    kind: fc.constantFrom<RawAction["kind"]>(
      "place",
      "place",
      "place",
      "place",
      "deliver",
      "deliver",
      "deliver",
      "clear",
      "dropFrame",
      "disconnect",
      "reconnect",
    ),
    client: fc.integer({ min: 0, max: numClients - 1 }),
    // max === numCells is one past the last playable index: an out-of-range INVALID_CELL.
    cell: fc.integer({ min: 0, max: numCells }),
    value: fc.constantFrom(...VALUE_TOKENS),
    count: fc.integer({ min: 1, max: 4 }),
  });
}

/** A general program over a tiny grid with N clients (convergence, order, idempotency). */
export function programArb(): fc.Arbitrary<Program> {
  return fc
    .tuple(clientSpecsArb(), fc.constantFrom(...CONVERGENCE_PUZZLES))
    .chain(([clients, puzzle]) => {
      const numCells = puzzle.rows * puzzle.cols;
      return fc
        .array(actionArb(clients.length, numCells), {
          minLength: 1,
          maxLength: 26,
        })
        .map((actions) => ({ clients, puzzle, actions }));
    });
}

/**
 * The completion puzzles: fully fillable tiny grids, so a correct-biased stream reaches a
 * full board often and the INV-3 "exactly one completion" branch actually fires.
 */
const COMPLETION_PUZZLES: readonly SimPuzzle[] = [
  { rows: 1, cols: 2, blocks: [], solution: ["A", "B"] },
  { rows: 1, cols: 3, blocks: [], solution: ["A", "B", "C"] },
  { rows: 2, cols: 2, blocks: [], solution: ["A", "B", "C", "D"] },
];

/**
 * A completion program: place steps carry a `correct` flag resolved against the chosen
 * puzzle at generation time, so the stream can fill, misfill, correct-in-place, and race
 * the last cells. Delivery/disconnect steps are kept so completion can happen mid-gap.
 */
export function completionProgramArb(): fc.Arbitrary<Program> {
  return fc
    .tuple(
      fc.array(fc.constantFrom<"solver">("solver"), {
        minLength: 2,
        maxLength: 3,
      }),
      fc.constantFrom(...COMPLETION_PUZZLES),
    )
    .chain(([roles, puzzle]) => {
      const clients = roles.map((role) => ({ role }));
      const numCells = puzzle.rows * puzzle.cols;
      const stepArb = fc.record({
        kind: fc.constantFrom<RawAction["kind"]>(
          "place",
          "place",
          "place",
          "place",
          "deliver",
          "deliver",
          "dropFrame",
          "disconnect",
          "reconnect",
        ),
        client: fc.integer({ min: 0, max: clients.length - 1 }),
        cell: fc.integer({ min: 0, max: numCells - 1 }),
        correct: fc.boolean(),
        count: fc.integer({ min: 1, max: 3 }),
      });
      return fc.array(stepArb, { minLength: 2, maxLength: 24 }).map((steps) => {
        const actions: RawAction[] = steps.map((s) => {
          const solution = puzzle.solution[s.cell];
          const value =
            s.correct && solution !== null ? (solution ?? "Z") : "Z";
          return {
            kind: s.kind,
            client: s.client,
            cell: s.cell,
            value,
            count: s.count,
          };
        });
        return { clients, puzzle, actions };
      });
    });
}

/** Build a Sim from a program, connect the clients, and apply every step in order. */
export async function runProgram(program: Program): Promise<Sim> {
  const sim = new Sim({
    puzzle: program.puzzle,
    clients: program.clients,
    // Inline flush per event: no background timer fires, so the loop stays deterministic.
    actorOptions: { flushEventThreshold: 1, flushIntervalMs: 6_000_000 },
  });
  await sim.init();
  for (const action of program.actions) await sim.step(action);
  return sim;
}
