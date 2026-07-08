// The comparator: does a filled value satisfy a cell's solution (DESIGN §5, PROTOCOL §10,
// D12)? The Swift twin of packages/engine/src/comparator.ts. A value passes if, comparing
// ASCII case-insensitively, it equals the full solution string or the solution's first
// character. First-char acceptance is the puzzle format's own rebus convention. Server-only
// in production (it needs the solution), but the code is pure and the vectors pin it here.

public func matches(_ solution: String, _ value: String) -> Bool {
    // Fold both sides ASCII-only (INV-1) and compare byte sequences, never canonically
    // equivalent Strings, so Turkish dotted/dotless i and any non-ASCII scalar are compared
    // as raw bytes and never fold or collate to an ASCII letter.
    let solutionUpper = asciiUpper(solution)
    let s = Array(solutionUpper.utf8)
    let v = asciiUpperBytes(value)
    if v == s { return true }

    // The solution's first character: its first Unicode scalar. For the ASCII solutions the
    // vectors pin this is the first byte; taking the scalar keeps the comparison byte-wise
    // while mirroring the TS `s.charAt(0)` acceptance for BMP input. An empty value has no
    // bytes and matches neither branch, so an empty solution's non-empty first char rejects
    // it without a special case.
    guard let firstScalar = solutionUpper.unicodeScalars.first else { return false }
    return v == Array(String(firstScalar).utf8)
}
