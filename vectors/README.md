# Conformance vectors

Normative test vectors for the engine, protocol behaviors, and client stores
(PROTOCOL.md §13). Two runners consume every file in CI — vitest for TypeScript,
XCTest for the Swift port — and a divergence between runners, or between a runner and
PROTOCOL.md, is a build failure.

Precedence when sources disagree: these vectors, then PROTOCOL.md, then any
implementation.

File conventions (naming, case shape, runner discovery) are defined in Wave 0.2a
(ROADMAP.md); no vectors land before those conventions do. Changes here are small,
focused PRs reviewed against PROTOCOL.md.

Frozen N-1 protocol vectors will live under `frozen/vN-1/` once the protocol version
ever bumps (PROTOCOL.md §14).
