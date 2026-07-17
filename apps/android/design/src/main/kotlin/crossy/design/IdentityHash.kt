// Mirrors apps/ios/Sources/CrossyDesign/IdentityHash.swift. Identity hash (root DESIGN.md
// §8): a deterministic FNV-1a hash of `user_id`, stable across devices, sessions, and
// clients. The canonical implementation is apps/session/src/color.ts; this is its exact
// port. The server hashes with `charCodeAt`, i.e. UTF-16 code units; a Kotlin `String` is
// already UTF-16, so iterating its `Char`s and reading `.code` yields the same code units.
// User ids are ASCII UUIDs, where UTF-16 code units and ASCII bytes coincide (INV-1:
// bytewise, no locale, no case folding); mirroring UTF-16 exactly means even a non-ASCII
// input can never diverge between clients.
package crossy.design

object IdentityHash {
    /// FNV-1a 32-bit offset basis (2166136261), as in apps/session/src/color.ts.
    val fnv1a32OffsetBasis: UInt = 0x811C_9DC5u

    /// FNV-1a 32-bit prime (16777619), as in apps/session/src/color.ts.
    val fnv1a32Prime: UInt = 0x0100_0193u

    /// FNV-1a over the UTF-16 code units of `input`, as an unsigned 32-bit integer. Exact
    /// twin of `fnv1a` in apps/session/src/color.ts (`Math.imul` there is UInt's wrapping
    /// 32-bit multiply here, the Swift `&*`).
    fun fnv1a32(input: String): UInt {
        var hash = fnv1a32OffsetBasis
        for (unit in input) {
            hash = hash xor unit.code.toUInt()
            hash *= fnv1a32Prime
        }
        return hash
    }
}
