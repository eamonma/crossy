# Contract fixture provenance

Every file under `wire/` and `rest/` is copied **verbatim** from the iOS twin at
`apps/ios/Tests/CrossyProtocolTests/Fixtures/{wire,rest}/`, so all three twins
(TypeScript `packages/protocol`, Swift `CrossyProtocol`, Kotlin `:protocol`) pin against
the same normative bytes (the D04 hand-kept-twin pattern). Wire fixtures are the literal
PROTOCOL.md §2-6 examples with placeholders made concrete as
`packages/protocol/src/codec.test.ts` makes them; REST fixtures follow §12's field lists.

Do not hand-edit these here. A change belongs on the iOS/TS side (reviewed against
PROTOCOL.md and the vectors) and is then re-copied across.
