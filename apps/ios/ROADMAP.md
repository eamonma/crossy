---
status: descriptive
---

# Crossy iOS Roadmap

Status: draft 1, for owner review. Date: 2026-07-09.
Companions: `apps/ios/DESIGN.md` (look and feel), `apps/ios/EXPERIENCE.md` (product
and UX), `apps/ios/ARCHITECTURE.md` (module graph, store formalism, concurrency).
This file owns execution only: phases, waves, exit criteria. The companions
own the what; `PROTOCOL.md` and `vectors/` own semantics; the root `ROADMAP.md` owns
the program this slots into.

**Relationship to the root roadmap.** This file is the Phase 4 Track B (M5)
flesh-out the UX track demands at entry, extended through parity (M6's iOS half) and
launch. Two owner decisions recorded here supersede the root Track B line as
written: v1 sign-in is Discord only (named accounts; no guests on iOS), and Sign in
with Apple plus passkeys land post-v1 as the auth-breadth gate for public App Store
release. The root file carries a pointer to here.

**Inherited conventions**, restated once: vectors before implementations; test names
cite the invariant they defend; substantive work runs in worktree-isolated agents
that never push; any agent brief that starts services mandates teardown plus an
orphan sweep; a diff that changes a contract sweeps callers outside its fence before
merge; owner smoke tests precede dogfood exits, and friends confirm, they do not
discover; where nothing is decided, do what the NYT crossword does, and deviate only
by recorded decision. New interaction semantics discovered on iOS never fork: they
land as vectors and web parity, or not at all.

**Distribution (proposed).** v1 ships to friends through TestFlight. Public App
Store release is a separate, later gate: App Review guideline 4.8 disallows
third-party-only login, so it waits on auth breadth (Apple, passkeys), which the
owner has deliberately unscheduled. TestFlight does not trigger 4.8 and matches the
v4 scope of private games among friends.

## Load-bearing sequential edges

1. I0 scaffold before everything.
2. SP-i1 (glass SDK) before I2's chrome; SP-i2 (deck) rules ID-4 before I2's input
   build; SP-i4 (AASA) before I3's universal links.
3. I1 (store green on the shared vectors) before I2 (the room renders sequenced
   state plus overlay and nothing else, INV-10).
4. I2 solves against the local stack before I3 puts production auth in front of it.
5. I3 before the M5 dogfood exit (production needs sign-in).
6. I4 parity after the room exists; I5 launch last.

Owner-held actions, flagged per phase and never done by agents: Apple Developer
team and app record, certificates, associated-domains entitlement approval,
TestFlight group, any Supabase or Railway dashboard change, any secret. Each arrives
as an ask with the exact steps ready.

## Spike track (timeboxed, throwaway; findings land in `reports/spikes/`)

Rules as in the root roadmap: spike code never merges; the merged artifact is a
short written answer plus amendments to `apps/ios/DESIGN.md` (ID-4, section 10) or
this file where a decision changes. A build track does not start while a spike it
depends on is open.

- [x] **SP-i1 Glass against the real SDK** (one day). glassEffect, glass-container
      morphing, interactive glass on iOS 26: can the clue bar genuinely melt into
      the browser sheet; do morphs compose with a sheet presentation; what does
      Reduce Transparency actually render. Closes the root DESIGN.md section 15
      Liquid Glass item. Blocks: I2c. Fallback per DESIGN.md section 10: crossfade,
      never a modal. **Closed 2026-07-10** (reports/spikes/sp-i1-glass.md): the melt
      is one persistent surface interpolating with drag; ID-swap morphs snap
      (device recheck rides I2c); sheets never morph, panels are custom overlays.
      Folded into DESIGN.md sections 4 and 10.
- [x] **SP-i2 The deck in hand** (one day, on device). The key deck prototype both
      ways, clear pucks and Studio keys: press latency, specular pop, haptic tick,
      sixty presses a minute. Owner smoke test is the instrument; rules ID-4.
      Blocks: I2b. **Rig delivered 2026-07-10** and installed on the owner's device
      (reports/spikes/sp-i2-deck.md); pipeline latency 8-11 ms on simulator. The
      ID-4 verdict stays open until the owner's smoke test. **Verdict 2026-07-10:
      glass pucks confirmed on device; ID-4 stands, I2b unblocked.**
- [x] **SP-i3 Live Activity timer** (half day). An activity whose timer renders
      natively from a fixed `firstFillAt`: ticks with zero updates, survives app
      kill, island and lock screen render. Blocks: I5a. **Closed 2026-07-10, yes on
      every count** (reports/spikes/sp-i3-island.md): the timer ticked through a
      verified app kill on the owner's device with zero updates; the widget
      extension target was hand-authored in the pbxproj (recipe in the report);
      I5a shaping notes recorded there.
- [ ] **SP-i4 AASA and universal links** (half day; touches `apps/api`). Serve
      `/.well-known/apple-app-site-association` from the API host; a `/g/{code}`
      link opens a development build. Owner-held: app ID, associated-domains
      entitlement. The API route lands as a real, tested change (it is not spike
      code); the spike is the end-to-end proof. Blocks: I3c. The API half landed
      via PR #38 (`APPLE_APP_ID`, fail closed); the proof waits on the owner-held
      app record. Found along the way: `GET /g/{code}` is specified but not yet
      implemented anywhere; it must exist before this spike's proof.
- [x] **SP-i5 The detent browser** (half day, on device). Follow-up to SP-i1's
      finding that custom drag-driven morphs need choreography we would own: the
      clue bar living in a persistent non-modal sheet with detents (small = bar
      plus deck, large = the browser), Apple's drag physics, grid interactive
      behind it, tap a clue to jump and pour back. Owner feel test decides
      detent sheet vs custom panel for I2c. Blocks: I2c. **Closed 2026-07-10,
      custom panel wins** (reports/spikes/sp-i5-detent-browser.md): the sheet is
      grow-then-swap rather than the melt, dims the room inert at the large
      detent, and fuses bar and deck into one glass surface. The owner ruled for
      the separate layout: the clue bar as its own glass over a separate deck.
      Tap-to-jump with the pour back was the pattern's best moment and carries
      into the custom panel. Folded into DESIGN.md section 4.

## Phase I0 — Shell (app target and CI)

- [x] a. Xcode project shell: a thin, committed `.xcodeproj` whose sources live in
      the SwiftPM package (new app-facing targets alongside `CrossyEngine`; the
      engine target stays pure, INV-9, imports nothing). App name Crossy, iOS 18
      floor (26 at scaffold; lowered by owner ruling 2026-07-10, glass on 26+
      with one simple blur fallback below, DESIGN.md section 4), no generators
      until it hurts. Target decomposition is decided:
      `apps/ios/ARCHITECTURE.md` AD-2 is the module graph this wave scaffolds.
- [x] b. CI: `ios.yml` gains a simulator build of the app target, path-filtered as
      today; `swift test` stays required and green throughout.
- [x] c. Config as code: bundle configuration (API base, session base, Supabase
      project URL and anon key, all public values) in a committed plist; no
      dashboard-only setting anywhere.

**Exit: fresh clone → open the project → build and run on simulator and a real
device; CI builds the app target on every iOS-touching push.**

## Phase I1 — The wire (protocol, store, transport)

- [x] a. Protocol layer: Swift Codable types mirroring `packages/protocol` for every
      message in PROTOCOL.md sections 2 through 12, pinned by contract snapshot
      tests against the schemas (the D04 pattern: a hand-kept twin held honest in
      CI).
- [x] b. The store: sequenced state plus optimistic overlay, passing the shared
      client-store vectors in XCTest. Echo clears by `commandId`; a non-fatal error
      clears and surfaces; gap sends `requestSync` and applies the snapshot
      wholesale; crash rollback accepts the lower seq; snapshot reconciliation runs
      identically for `welcome` and `sync` against `recentCommandIds`, re-sends
      within the window, drops aged-out (`agedOut` as case input, PROTOCOL.md
      section 8). This drains the `client-store` foreign family from
      `vectors.skip.json` into a bound consumer per that manifest's own rules.
- [x] c. Transport: `URLSessionWebSocketTask`, the reconnect state machine
      (backoff 0, 1, 2, 4, 8, 16, 30 with full jitter, reset after a 30 s survival),
      heartbeat every 15 s, hello/welcome handshake, the three connection states
      live / resyncing / reconnecting as a published enum the UI consumes.
- [x] d. REST client: bearer auth, the section 12 error vocabulary keyed on stable
      codes, cursor pagination for the two list endpoints.
- [x] e. Integration harness: a script boots the local stack (api, session,
      Postgres), an XCTest integration tag drives a real socket round trip with an
      injected token. Teardown plus orphan sweep is part of the harness, not a
      convention. Landed 2026-07-10: `corepack pnpm test:ios-integration` runs
      apps/ios/scripts/integration.ts (reuses e2e/src/harness.ts; ports 8890-8892,
      one band above dev-stack), injecting CROSSY_IT_* facts into `swift test`;
      without them the suite skips, so CI stays green with no Docker.

**Exit: client-store vectors green in XCTest in CI; against the local stack, a
scripted client places a letter, is killed mid-word, reconnects, and converges
(the M1 exit shape, replayed in Swift). Met 2026-07-10: the kill is
invalidateAndCancel (no close handshake), convergence via welcome snapshot
reconciliation, a second identity observes the converged board; harness green
twice back-to-back plus an orchestrator re-run, orphan sweep proven against a
simulated crash.**

## Phase I2 — The room (the solve screen, end to end)

Flesh-out gate: satisfied. `apps/ios/DESIGN.md`, `apps/ios/EXPERIENCE.md`, and
`apps/ios/ARCHITECTURE.md` are the spec this phase builds to; taste findings during
the build file as amendments to those documents, never as silent divergence.

Presence needs no server work: the wire slice landed with PR #31 (connect and
disconnect notices, the liveness timer, cursor relay, and the web client sending
cursors), so this phase consumes and renders presence, nothing more.

- [x] a. Grid renderer: `Canvas`, the root DESIGN.md section 10 module rules
      (background precedence, numbers top-left, presence bottom-right per
      Wave 2.1d, circles, flash in the writer's color), both grounds (Studio,
      Observatory), pan and zoom to the 25x25 cap with a glyph-legibility floor.
      Landed 2026-07-10: one culled Canvas pass over a pure GridFrame snapshot
      (INV-10); geometry and precedence in headless-tested types; the floor is
      10 pt glyphs (TypeScale.gridGlyphLegibilityFloorPoints, justified at the
      constant); wire color is authoritative for roster slotting
      (IdentityRoster.slot(forWireColor:), user-id hash as offline fallback);
      GridPuzzle's word-run rule is parity-pinned against CrossyEngine in tests.
      Local selection and the ClientPuzzle-to-GridPuzzle mapping deliberately
      wait for I2b/I2c.
- [x] b. Input: the key deck per the ID-4 ruling from SP-i2; navigation through the
      engine (the vectored rules, including PR #30's Tab semantics); swipe along
      the direction for next/previous word, across it to toggle; backspace
      step-back; rebus inline field (baseline form). Landed 2026-07-10:
      SelectionModel + pure InputActions run the navigation vector JSON directly
      in XCTest; navigation flows through CrossyStore's BoardNavigation facade
      (type mapping only, AD-2); glass pucks on 26+ with the blur fallback
      proven on iOS 18.1, both grounds; presses fire at touch-down in the SP-i2
      rig's latency class; SolveScreen + DemoRoom (loopback transport) behind
      ContentView so a fresh clone runs a typeable board. Deferred to I2c:
      cursor relay wiring, camera follow on off-screen jumps, swipe-while-zoomed
      feel.
- [x] c. Chrome: room bar, clue bar, clue browser (the SP-i1 single-surface melt,
      drag-scrubbed; the owner's SP-i5 feel test ruled the layout: clue bar as
      its own glass over a separate deck; panels are custom overlays, never
      system sheets; verify the ID-swap morph on device first, else the recorded
      fallback), roster sheet,
      weather states rendered as DESIGN.md section 8
      specifies, ambient timer (ID-2), the spectator edge state with its Join in
      affordance (full accounts seat as solvers on join, owner decision 2026-07-10).
      Landed 2026-07-10: GlassMorph pure-math interpolation, no animation ever
      writes melt progress (finger raw in a nil-animation transaction, hand-
      stepped ease on release, so a mid-settle grab scrubs from true progress);
      glassEffectID unused, making the section 10 device recheck moot for the
      melt. Cursor relay (web's 100 ms leading+trailing posture) and camera
      follow wired. Owner device checks riding this build: melt feel, glint
      subtlety, roster inflation. Deferred: browser per-row presence dots (I4);
      reconnect countdown wiring (I3, the driver sets reconnectRetryAt).
- [ ] d. Completion and terminals: the mosaic in its simple form (tint, hold,
      settle), the stats card, board freeze on `completed` and `abandoned`, the
      kicked exit with its one honest sentence.
- [ ] e. Haptics and motion per DESIGN.md section 7, tuned on device.

**Exit: against the local stack, an iOS simulator or device and a web browser
solve a real puzzle together: presence dances, conflicts flash, completion
celebrates exactly once on both (INV-3), and an owner smoke test of typing feel
(latency, flash, deck) passes before the phase closes.**

## Phase I3 — Arrival (auth, home, join; = the M5 exit)

- [ ] a. Sign-in: Discord through Supabase via `ASWebAuthenticationSession`,
      honoring the pinned ref-domain issuer (deploy/README.md; it has caused an
      outage once). Session in the Keychain, silent refresh, sign-out. The welcome
      screen per EXPERIENCE.md.
- [ ] b. Rooms: `GET /games` and `GET /puzzles` with cursor pagination, geometry
      fingerprints, the create flow (Files or pasted URL → `POST /puzzles` →
      `POST /games`), every named ingestion rejection surfaced in the lexicon
      voice, the share card into the system sheet.
- [ ] c. Join: code entry (`POST /games/join`), universal links on SP-i4's AASA,
      signed-out deep links holding their context through auth.
- [ ] d. Account: identity, roster color, sign out, `DELETE /account` with its
      tombstone consequences worded plainly.

**Exit (= M5): on production, a fresh device signs in with Discord, joins by code,
is solving within seconds, and finishes a puzzle with a web friend, observed in a
dogfood session.**

## Phase I4 — Parity (the M6 iOS half)

Spec-first per the root Phase 5 gate: each surface gets its interaction spec as an
amendment to `apps/ios/EXPERIENCE.md` before it is built.

- [ ] a. Check styling (wrong cells hold the check style until next edit).
- [ ] b. Rebus entry polish: the bubble if SP-i1's findings allow it, the inline
      field if not.
- [ ] c. Cross-reference highlighting and two-way clue links; circles and shading;
      image clues.
- [ ] d. Hardware keyboard on iPhone; Dynamic Type on chrome (the grid scales by
      zoom, not type size); VoiceOver on chrome and clue reading. Deep grid
      VoiceOver is post-v1 by explicit cut, recorded here so the gap is visible.

**Exit: the v2 parity checklist's iOS half is green, walked personally by the
owner on device (root M6 exit).**

## Phase I5 — The finish (launch to friends)

- [ ] a. Live Activity, v1 shape from SP-i3: started on backgrounding an ongoing
      room, timer native from `firstFillAt`, last-known board state, island and
      lock screen. No pushes yet.
- [ ] b. Polish pass: motion curves, haptic strengths, Reduce Motion and Reduce
      Transparency fallbacks proven, both grounds walked in every screen.
- [ ] c. TestFlight: owner-held Apple account actions (app record, certificates,
      TestFlight group), then CI-built archives per the pipeline discipline
      (deploys only from main; a TestFlight upload is a deploy).

**Exit: a friend installs from TestFlight on their own phone and solves an evening
puzzle with the owner; the island ticks through a backgrounded solve; nothing in
the flow requires anyone to explain anything.**

## Post-v1 ledger (recorded, unscheduled)

- Auth breadth: Sign in with Apple and passkeys (owner: later, deliberately
  unrushed). Unlocks public App Store release past guideline 4.8. Supabase carries
  both; the auth port stays vendor-neutral.
- ActivityKit pushes: fill progress, presence lines, the away-completion moment.
  Cross-service track (session service emits, APNs key is an owner-held secret,
  per-activity token storage needs a design pass against INV-7 single-writer).
- Presence glints, the clarity beat, mosaic choreography, pan-thinning chrome
  (DESIGN.md sections 4 and 8 follow-ons).
- App Store submission pass: screenshots lead Observatory (ID-3), review notes,
  privacy labels.
- Deep grid VoiceOver; display-name editing (needs an API surface); self-leave
  (an API conversation, not an iOS workaround); iPad.
