// The comparator: does a filled value satisfy a cell's solution (DESIGN §5, PROTOCOL
// §10, D12)? A value passes if, comparing ASCII case-insensitively, it equals the full
// solution string or the solution's first character. First-char acceptance is the
// puzzle format's own rebus convention. Server-only in production (it needs the
// solution), but the code is pure and the vectors pin it here.

import { asciiUpper } from "./casing";

export function matches(solution: string, value: string): boolean {
  const s = asciiUpper(solution);
  const v = asciiUpper(value);
  // An empty value satisfies neither branch: a non-empty solution's first character is
  // non-empty, so this returns false without a special case.
  return v === s || v === s.charAt(0);
}
