// The comparator: does a filled value satisfy a cell's solution (DESIGN §5, PROTOCOL §10,
// D12)? The Kotlin twin of packages/engine/src/comparator.ts. A value passes if, comparing
// ASCII case-insensitively, it equals the full solution string or the solution's first
// character. First-char acceptance is the puzzle format's own rebus convention. Server-only
// in production (it needs the solution), but the code is pure and the vectors pin it here.

package crossy.engine

fun matches(solution: String, value: String): Boolean {
    val s = asciiUpper(solution)
    val v = asciiUpper(value)
    // `s.take(1)` is the TS `s.charAt(0)`: the first code unit as a string, or "" when the
    // solution is empty. An empty value equals neither branch, so it rejects without a
    // special case (an empty solution's first char is empty, which a non-empty value never is).
    return v == s || v == s.take(1)
}
