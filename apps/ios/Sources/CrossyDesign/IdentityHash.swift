// Identity hash (root DESIGN.md §8): a deterministic FNV-1a hash of `user_id`, stable
// across devices, sessions, and clients. The canonical implementation is
// apps/session/src/color.ts; this is its exact port. The server hashes with
// `charCodeAt`, i.e. UTF-16 code units, so the port iterates `String.utf16`. User ids
// are ASCII UUIDs, where UTF-16 code units and ASCII bytes coincide (INV-1: bytewise,
// no locale, no case folding); mirroring UTF-16 exactly means even a non-ASCII input
// can never diverge between clients.

public enum IdentityHash {
    /// FNV-1a 32-bit offset basis (2166136261), as in apps/session/src/color.ts.
    public static let fnv1a32OffsetBasis: UInt32 = 0x811C_9DC5

    /// FNV-1a 32-bit prime (16777619), as in apps/session/src/color.ts.
    public static let fnv1a32Prime: UInt32 = 0x0100_0193

    /// FNV-1a over the UTF-16 code units of `input`, as an unsigned 32-bit integer.
    /// Exact twin of `fnv1a` in apps/session/src/color.ts (`Math.imul` there is the
    /// wrapping 32-bit multiply `&*` here).
    public static func fnv1a32(_ input: String) -> UInt32 {
        var hash = fnv1a32OffsetBasis
        for unit in input.utf16 {
            hash ^= UInt32(unit)
            hash = hash &* fnv1a32Prime
        }
        return hash
    }
}
