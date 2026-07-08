// ASCII-only casing (INV-1), the Swift twin of packages/engine/src/casing.ts. Folding
// runs over the UTF-8 view by raw byte value: a-z (0x61..0x7a) map to A-Z, and every
// other byte, including every byte of a multi-byte non-ASCII scalar, is copied verbatim.
//
// This is deliberate and load-bearing. Swift's String.uppercased() is Unicode and locale
// aware; it would map Turkish dotless i and friends differently than the TypeScript port,
// diverging the two engines. Byte folding cannot: a-z are single-byte in UTF-8 and never
// occur inside a multi-byte sequence, so folding by byte equals folding by code point for
// exactly the ASCII lowercase range and touches nothing else. The reducer and comparator
// Turkish pins exist to catch any regression to locale casing.

/// Fold a-z to A-Z by UInt8 byte value over the UTF-8 view; leave every other byte
/// unchanged (INV-1). Returns the folded bytes so callers compare byte sequences, never
/// canonically-equivalent Strings.
func asciiUpperBytes(_ value: String) -> [UInt8] {
    value.utf8.map { $0 >= 0x61 && $0 <= 0x7a ? $0 - 0x20 : $0 }
}

/// The folded value as a String, for storage and serialization. Reconstructed from the
/// folded bytes, so an all-ASCII value round-trips byte for byte.
func asciiUpper(_ value: String) -> String {
    String(decoding: asciiUpperBytes(value), as: UTF8.self)
}
