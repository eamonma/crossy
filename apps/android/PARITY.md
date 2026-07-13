# Android parity ledger

synced-to: 9a6351c (2026-07-13)

How this file works. The domain core needs no ledger: vectors, contract fixtures,
and android.yml keep the three twins honest per PR (a vector change that skips the
Kotlin twin is a red check, same contract ios.yml enforces for Swift). This file
covers the tier CI cannot see: feature and UI surface where iOS leads and Android
follows. The sweep ritual: diff `apps/ios` and `apps/web` since `synced-to`,
classify each change (normative: already fenced; additive protocol: fixtures plus
client work; UI parity: a row here; platform-specific: note and skip), update rows,
bump the sha. Sync at wave boundaries, not per commit; Android trailing iOS is by
design.

Working agreement: iOS and web feature PRs carry a one-line `Android: n/a |
ledger | co-landed` note so the sweep reads intent instead of inferring it.

Status vocabulary: `shipped` (functional parity), `partial` (works, gaps named),
`in-flight` (track dispatched), `absent` (on the backlog), `divergent` (deliberate,
cites the AAD), `blocked-owner` (needs console, signing, or domain work only the
owner can do).

| Surface                            | Status        | Notes                                                                                                   |
| ---------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| Solve room (grid, deck, clue bar)  | partial       | Functional; design and motion pass is its own track                                                     |
| Rooms list                         | partial       | live/solved/ended shelves (#234); featured wall gap                                                     |
| Ended-games section                | shipped       | Mirrors #234: abandonedAt shelf + dimmed terminal cards                                                 |
| Join by code                       | shipped       | Field digests a pasted short link, `?code=`, `/g/`, or bare code (InviteScan)                           |
| Create game                        | shipped       |                                                                                                         |
| Auth: email/dev-token              | shipped       | AAD-3 v0; in-memory tokens                                                                              |
| Auth: email OTP / magic link       | shipped       | Send + verify code (#230); verifyEmailLink ready, magic-link deep link rides the App Links row          |
| Display name (onboarding + editor) | in-flight     | Mirrors #236: /me needsName, canonicalize/validate vectors                                              |
| Auth: Turnstile captcha minting    | in-flight     | WebView minter + 8-digit code; unblocks prod send (#230)                                                |
| Terminal room retires key deck     | shipped       | RoomScreen `deckRetired`: solved + host-ended retire the deck from the first terminal frame (#205/#235) |
| Auth: Google native                | blocked-owner | Console work; PKCE helpers ready                                                                        |
| Invite short link emit + parse     | shipped       | InviteLink pure module + room share sheet; mirrors #225/#226 (App Links still owner-blocked)            |
| App Links for crossy.ing           | blocked-owner | assetlinks.json + Play signing SHA-256                                                                  |
| Invite QR (show + scan)            | absent        |                                                                                                         |
| Completion (mosaic, celebration)   | absent        | Store carries the state; UI pending                                                                     |
| Post-game Analysis surface         | absent        | Mirrors ios #210                                                                                        |
| Settings / account                 | absent        | Mirrors #197 shape when built                                                                           |
| Keystore token store               | absent        | In-memory tonight (AD-4 posture)                                                                        |
| Play identity + signing            | blocked-owner | AAD-5; applicationId is a placeholder                                                                   |
| Live Activity analog               | divergent     | AAD-4: Live Updates are post-v1                                                                         |
| Widget (Glance)                    | divergent     | AAD-6                                                                                                   |
