// The read-aloud invite alphabet, mirrored for entry (DESIGN.md §7 via
// apps/api/src/games/invite-code.ts: 8 characters from [2-9A-HJ-NP-Z], no 0/1/I/O).
// The server owns lookup normalization (ASCII-only uppercase, INV-1; PROTOCOL.md
// §12); this mirror only keeps the field honest while typing: uppercase as the user
// types, drop glyphs no code can contain, stop at eight. Casing is bytewise ASCII,
// never locale-aware and never Unicode case mapping (INV-1).

public enum InviteCodeEntry {
    /// Mirror of INVITE_ALPHABET (apps/api/src/games/invite-code.ts), pinned by test.
    public static let alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

    /// Mirror of INVITE_CODE_LENGTH.
    public static let length = 8

    /// What the field keeps of raw input: ASCII-uppercased bytewise, filtered to the
    /// alphabet, capped at `length`. A pasted code with spaces or hyphens survives;
    /// a glyph outside the alphabet (0, 1, I, O included) cannot be part of any code
    /// and is dropped rather than sent to fail server-side.
    public static func sanitize(_ raw: String) -> String {
        var kept = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars {
            let upper: Unicode.Scalar
            if scalar.value >= 0x61 && scalar.value <= 0x7A {
                // ASCII a-z to A-Z by arithmetic (INV-1: bytewise, no locale, no
                // Unicode case mapping).
                upper = Unicode.Scalar(scalar.value - 0x20)!
            } else {
                upper = scalar
            }
            guard alphabet.unicodeScalars.contains(upper) else { continue }
            kept.append(upper)
            if kept.count == length { break }
        }
        return String(kept)
    }

    /// A sanitized code ready to send: exactly eight alphabet characters.
    public static func isComplete(_ code: String) -> Bool {
        code.count == length && code.unicodeScalars.allSatisfy { alphabet.unicodeScalars.contains($0) }
    }
}
