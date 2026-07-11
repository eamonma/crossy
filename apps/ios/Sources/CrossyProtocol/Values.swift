// Cell value rules (PROTOCOL.md §3). Twin of packages/protocol/src/values.ts. A value
// is a string matching `^[A-Z0-9]{1,10}$` after normalization, or null for an empty
// cell. Normalization is ASCII-only so the TypeScript and Swift ports agree byte for
// byte (INV-1); locale-aware casing is forbidden because Turkish `i` uppercases to `İ`
// (U+0130) under a locale and would diverge the ports.
//
// Like CrossyEngine's Casing.swift (the engine keeps its own copy: INV-9, imports
// nothing, exactly as packages/engine duplicates packages/protocol's helper), folding
// runs over the UTF-8 view by raw byte value: a-z (0x61..0x7a) map to A-Z, and every
// other byte, including every byte of a multi-byte non-ASCII scalar, is copied
// verbatim. ASCII lowercase bytes never occur inside a multi-byte UTF-8 sequence, so
// byte folding equals code-point folding for exactly that range and touches nothing
// else. `String.uppercased()` (Unicode- and locale-aware) MUST NOT be used here.

/// Map `a`-`z` to `A`-`Z` and leave every other code point unchanged (INV-1). This is
/// the whole of normalization. Twin of `asciiUppercase`.
public func asciiUppercase(_ input: String) -> String {
    String(
        decoding: input.utf8.map { $0 >= 0x61 && $0 <= 0x7A ? $0 - 0x20 : $0 },
        as: UTF8.self)
}

/// Normalize a raw wire value to its canonical form (PROTOCOL.md §3). Twin of
/// `normalizeValue`.
public func normalizeValue(_ input: String) -> String {
    asciiUppercase(input)
}

/// Whether a filled value is legal (PROTOCOL.md §11 INVALID_VALUE): it matches
/// `^[A-Z0-9]{1,10}$` after ASCII normalization. Twin of `isValidValue`. The pattern is
/// checked by hand over UTF-8 bytes rather than a regex: every passing byte is
/// single-byte ASCII, so the byte count is the character count, and any byte of a
/// multi-byte scalar (`İ` U+0130, `ı` U+0131 included) falls outside `A-Z0-9` and fails
/// identically on both ports (INV-1).
public func isValidValue(_ raw: String) -> Bool {
    let normalized = normalizeValue(raw).utf8
    guard normalized.count >= 1 && normalized.count <= 10 else { return false }
    return normalized.allSatisfy { byte in
        (byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z"))
            || (byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9"))
    }
}
