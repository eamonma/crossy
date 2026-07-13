# vectors/identity

The cross-client player identity palette (DESIGN.md §8).

The server assigns each player a stable wire color, `colorForUser(userId)` in
`apps/session/src/color.ts`: an FNV-1a hash of the userId rendered as `#RRGGBB`. That raw
hash is not what a client paints. Every client buckets the wire color to one of twelve
curated slots, `slot = (value % 12)`, and paints the slot's light- or dark-ground variant.
So one player reads as the same color everywhere: the web board and its post-game mosaic,
the push surfaces, and iOS.

`roster.json` freezes that contract:

- `slots` — the twelve slots in canonical order, each with its `light` and `dark` hex. The
  `dark` column is the one `apps/session/src/push/roster.ts` already ships; the `light`
  column is iOS's (`apps/ios/Sources/CrossyDesign/IdentityRoster.swift`), adopted here as
  the shared source so web can render both grounds.
- `slotForWireColor` — `wire -> slot` cases pinning the `value % 12` bucketing (including the
  wrap at 12 and the fact that a roster hex does not round-trip to its own slot).

## Who reads it

- Web: `apps/web/src/ui/identityRoster.test.ts` pins `IDENTITY_ROSTER` and `slotForWireColor`
  in `apps/web/src/ui/identityRoster.ts` to this file.

`apps/session/src/push/roster.ts` and iOS `IdentityRoster.swift` carry their own copies today,
each pinned by a local test to the same values. Pointing those two tests at this vector is a
clean follow-up that makes all three provably identical from one source.

## display-name.json

The display-name spec (DESIGN.md name-onboarding §5, PROTOCOL.md §12). A bare array of cases,
each with an `intent` (`canonicalize` or `sanitize`), an `input`, and a `then`. The
`canonicalize` cases run the input through the authoritative canonicalize (Unicode NFC, trim
Unicode White_Space, collapse internal whitespace runs to one space) plus validate, and assert
`{ ok: true, value }` or `{ ok: false, code }` where the code is `NAME_REQUIRED`,
`NAME_TOO_LONG`, or `NAME_INVALID`. The `sanitize` cases run the per-keystroke edge filter
(strip disallowed scalars, cap graphemes, no trim or collapse) and assert the resulting
`{ value }`, so the keystroke path is pinned distinctly from the submit path (R6). Length is in
extended grapheme clusters; a ZWJ family emoji and a regional-indicator flag each count as one
(R7). Casing is preserved: INV-1 (ASCII-only casing) is cell-values only and does NOT apply to
names.

Consumers, each pinned by a local test that runs this file:

- API validator: `apps/api/src/identity/display-name.ts`
  (`apps/api/src/identity/display-name.test.ts`).
- Web sanitizer: `apps/web/src/profile/name.ts` (`apps/web/src/profile/name.test.ts`).
- iOS sanitizer: `apps/ios/Sources/CrossyUI/DisplayNameEntry.swift`
  (`apps/ios/Tests/CrossyUITests`).

The API and web share the spec constants from `@crossy/protocol` (`MAX_DISPLAY_NAME_GRAPHEMES`,
the disallowed-scalar ranges); iOS re-declares them and is pinned here by the shared vector.
