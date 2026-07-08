// INV-6: solutions never leave the server. DESIGN.md §4 requires a serialization golden proving no
// client-facing payload type carries a solution-typed field. This file is that golden in two
// layers: a compile-time structural proof (a leak is a tsc error under `pnpm typecheck`) and a
// runtime proof that a serialized ClientPuzzle contains no solution.
import { describe, expect, it } from "vitest";
import { toClientPuzzle } from "./puzzle";
import type { ClientPuzzle, ServerPuzzle, Solution } from "./puzzle";
import type { Board } from "./board";
import type { ClientMessage, ServerMessage } from "./messages";

// --- Compile-time structural proof ---
//
// ContainsSolution<T> is true iff a Solution-branded value appears anywhere in T, transitively
// through objects and arrays (so a leak "embedded in clue structures" is caught too). Because
// Solution is branded, a plain string never matches; only a real solution does.
type ContainsSolution<T> = T extends Solution
  ? true
  : T extends readonly (infer U)[]
    ? ContainsSolution<U>
    : T extends object
      ? true extends ContainsSolutionInObject<T>
        ? true
        : false
      : false;
type ContainsSolutionInObject<T> = {
  [K in keyof T]-?: ContainsSolution<T[K]>;
}[keyof T];

// These aliases turn a leak into a type error: IsFalse<true> is `never`, so `= true` fails to
// compile the moment a client-facing payload gains a Solution-typed field.
type IsFalse<T> = [T] extends [false] ? true : never;
type IsTrue<T> = [T] extends [true] ? true : never;

// Checked by `pnpm typecheck`; the runtime body is a formality. Every client-facing payload is
// asserted solution-free; ServerPuzzle is the positive control proving the detector bites.
function structuralProof(): void {
  const clientPuzzle: IsFalse<ContainsSolution<ClientPuzzle>> = true;
  const board: IsFalse<ContainsSolution<Board>> = true;
  const serverMessage: IsFalse<ContainsSolution<ServerMessage>> = true;
  const clientMessage: IsFalse<ContainsSolution<ClientMessage>> = true;
  const serverPuzzleControl: IsTrue<ContainsSolution<ServerPuzzle>> = true;
  void [clientPuzzle, board, serverMessage, clientMessage, serverPuzzleControl];
}

// --- Runtime serialization golden ---

function sampleServerPuzzle(): ServerPuzzle {
  return {
    rows: 1,
    cols: 2,
    blocks: [1],
    circles: [],
    clues: {
      across: [{ number: 1, text: "Feline pet", cellIndices: [0] }],
      down: [],
    },
    // cell 0 is a rebus solution; cell 1 is a black square.
    solution: ["CAT" as unknown as Solution, null],
  };
}

describe("no solution leak (INV-6, DESIGN.md §4, §7)", () => {
  it("INV-6: the structural proof compiles, so no client-facing payload carries a Solution field", () => {
    // The guarantee is the successful typecheck; calling it here keeps the symbol live.
    expect(structuralProof).not.toThrow();
  });

  it("INV-6: toClientPuzzle drops the solution by construction, not by runtime stripping", () => {
    const client = toClientPuzzle(sampleServerPuzzle());
    expect("solution" in (client as unknown as Record<string, unknown>)).toBe(
      false,
    );
  });

  it("INV-6: a serialized ClientPuzzle contains no solution key and no solution value", () => {
    const client: ClientPuzzle = toClientPuzzle(sampleServerPuzzle());
    const json = JSON.stringify(client);
    expect(json).not.toContain("solution");
    expect(json).not.toContain("CAT");
    // The client shape still carries geometry and clues.
    expect(json).toContain("Feline pet");
  });
});
