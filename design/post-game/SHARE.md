---
status: normative
---

# The completion share card

Status: plan of record. Date: 2026-07-17.
Companion: `ANALYSIS.md` owns the bundle every card is built from; `TITLES.md` owns the
superlatives the credits render; `SITTINGS.md` owns the active-time axis the stats cite.
This document owns the share artifact: the mosaic card, its layout contract, and the
three waves that ship it. The ratified mosaic-card mock is the visual spec; this
document is the durable statement of its rules.

## The concept

When a room finishes, a solver can share a card: the finished grid as a mosaic, every
square colored by WHO first solved it, painted in the room's own identity roster. The
card carries the Crossy lockup, the puzzle's title and byline, the solve's headline
numbers, and each solver's post-game title as a film-credits block. It is a poster of
the room, not of the puzzle.

## No letters, ever

The card spoils nothing, structurally. Its inputs are the analysis bundle (owners,
titles, stats, sequence: userIds, cells, keys, and numbers only, INV-6 by shape) plus
display metadata (names, puzzle title and author, a date). No board letter is accepted
as input, so none can render; the builder's tests pin that every text run comes from an
allowed field, adversarial input included. This is what makes the card safe to post
mid-week for a puzzle others have not solved, and what lets a server render the same
card in wave S2 without touching solution content.

## Where it lives

`packages/share-card` is the builder: a pure SVG function of data,
`completionCardSvg(data, {ground, variant, fontCss})`. It imports nothing (no npm, no
workspace, no node builtins; the `share-card-is-standalone` dependency-cruiser rule),
so the identical bytes can render in the browser today and on the server for the S2
unfurl. Colors for BOTH grounds arrive resolved by the caller; the package never
duplicates the identity roster. It has no clock (the date arrives preformatted) and no
randomness: same data, same SVG.

The web assembly (`apps/web/src/share/`) feeds it: owners and stats from the analysis
bundle, names and ground-paired hexes through the shared identity roster, title copy
verbatim from the Titles panel's `TITLE_COPY` (never forked), the masthead from the
game view's additive `puzzleTitle`/`puzzleAuthor` (PROTOCOL §12) with the room name and
then the board dims as fallback. The fonts (Newsreader 500 and its italic, Schibsted
Grotesk 400/500/600, Geist Mono 500) ride a lazy module as inlined data URIs, so the
main bundle never pays for them.

## The layout contract

Three variants, one visual system:

- **portrait, 1080x1620**: the flagship. Lockup header with the date on the right,
  puzzle title and byline, the owners mosaic, a three-cell stats strip, the credits.
- **og, 1200x630**: the unfurl. Grid left, text right; the stats compress to one mono
  line and the credits compress to titles only (in Discord this preview IS the share).
- **solo**: portrait geometry, no credits. Below two writers the engine awards no
  titles (the TITLES.md solo rule) and a one-color quilt says nothing, so the mosaic
  repaints by fill order from the replay sequence: pale at the first square, brand gold
  at the last, with a first/last ramp key where the credits would sit. The stats swap
  SOLVERS for SITTINGS.

The rules that make it Crossy:

- **Bona fide branding.** The header is the real lockup: the 3x3 mark plus the wordmark
  outlines, paths verbatim from `docs/design/logo` (`generate.py` is the source of
  truth), so no font is needed for the brand and the wordmark is never re-set in live
  text. Card faces are the brand grounds, Studio `#F2F1EC` and Observatory `#121118`;
  ink `#1D1B18`, bone `#EDEAE2`. Gold `#978365` appears only where the brand puts it,
  the mark's Y cell and the solo ramp; never in text or chrome.
- **The board is the og.svg board.** Square cells, no rounded corners, gridlines
  running cell to cell inside a slightly heavier frame. On light, blocks and lines are
  ink. On dark, blocks sink near-black (`#0A0910`) and the gridlines lift a step above
  them so the lattice reads against Observatory.
- **The wash.** An open cell is the owner's roster hex mixed 80% into the card face
  (pure-TS mix, both grounds): full-strength hex is a loud quilt that buries the type.
  A tuning dial, not a law.
- **Credits keep wire order.** Titles arrive ladder-ranked (TITLES.md); the card
  renders them in that order like every other client surface, then unranked owners in
  room order. Each credit: color chip, name in Schibsted 600, the title in Newsreader
  italic on the same line, the evidence line small under it. Two columns, at most
  eight entries; overflow is dropped, never squeezed.
- **Stats strip.** ACTIVE TIME (M:SS, or H:MM:SS past an hour; "N sittings" as a quiet
  sub-line at 2+), SOLVERS, SQUARES; three cells, hairline-separated, digits in Geist
  Mono 500.
- **No text measurement.** The builder cannot measure a run, so every layout is
  anchored or flowed through tspans, and every caller string truncates against a
  grapheme budget with one ellipsis. The budgets (code points, conservative): portrait
  title 30, portrait author 38, credit name 16, credit title 24, evidence 36, date 20;
  og title 22, og author 28, og credit name 14, og credit title 22. They live in
  `BUDGETS` beside the layout they protect.

## The waves

- **S1, the client card (this PR).** `packages/share-card` and its rule, the additive
  `puzzleTitle`/`puzzleAuthor` on `GET /games/{id}` (PROTOCOL §12), and the web Share
  button (completion overlay action row, Analysis header), which assembles the data,
  rasterizes the SVG at 2x to PNG, and hands it to `navigator.share` when the platform
  can share files, else downloads it. No clipboard image writes. Exit: a finished room
  exports a correct card on both grounds; a solo solve exports the ramp card.
- **S2, the share link (done, Wave 13.2).** A completed game mints a public share URL
  whose OG image is the og variant, rendered server-side from the analysis bundle by the
  same package (the standalone rule is what makes this a lift, not a port). Exit met:
  pasting a share link into Discord unfurls the card, spoiler-free by construction. What
  shipped and the decisions taken:
  - **The table.** `share_tokens` (API-owned, single writer, migration 0013): `token`
    (PK), `game_id`, `created_by`, `created_at`, `revoked_at`. **Token rule:** one
    ACTIVE (non-revoked) token per game, a partial unique index on `game_id WHERE
revoked_at IS NULL`, so the mint is idempotent (mint-or-return-existing). A revoked
    link frees the slot for a fresh mint. The token is a 256-bit URL-safe secret
    (base64url, `^[A-Za-z0-9_-]{43}$`), far past the 128-bit floor; it carries no
    `gameId` and is the sole capability.
  - **The routes.** `POST /games/{id}/share` (member + completed-game gate, the analysis
    endpoint's gate verbatim: non-member `NOT_PARTICIPANT`, not-completed
    `GAME_NOT_FOUND`) returns `{shareUrl, token}`. Public `GET /s/{token}` is the
    OpenGraph shell (modeled on `apps/api/src/games/unfurl.ts`), and public
    `GET /s/{token}/card.png` is the rasterized card. An unknown, revoked, or malformed
    token all resolve to the SAME soft 404 (no oracle); both public routes are per-IP
    rate-limited exactly as the invite unfurl.
  - **The origin.** `shareUrl` is `{share-origin}/s/{token}`, where `share-origin`
    follows how invite links build theirs: the config-driven public host `{invite-host}`
    (crossy.ing) when set, else the request origin. The invite-host middleware forwards
    `/s/*` to the core `/s` routes, so both share and invite links live on one host.
  - **The render.** The card is assembled server-side from the SAME analysis bundle the
    API already computes (`gameAnalysis`, not forked), the puzzle title/author off the
    `puzzles` row (named columns, never `data`), member display names off the `users`
    mirror, and each member's wire color (`assignRoomColors`) bucketed through the
    identity roster (`apps/api/src/share/identityRoster.ts`, pinned to
    `vectors/identity/roster.json`, the same vector the web copy pins to). It renders the
    og variant (1200x630, light ground) through `@resvg/resvg-js`. INV-6 holds by
    construction: the only puzzle facts that enter are the block silhouette and grid dims
    (projected out of the snapshot in SQL like the game view), so nothing letter-shaped
    can render.
  - **Fonts.** resvg cannot read woff2, so the faces (Newsreader 500 normal + italic,
    Schibsted Grotesk 400/500/600, Geist Mono 500) are vendored as committed TTFs in
    `apps/api/src/share/fonts` (OFL, license text alongside), derived from the same
    fontsource static instances the web card uses and normalized so resvg selects them by
    the CSS families the SVG names. They load via resvg's `fontFiles` with
    `loadSystemFonts` off, so the render is hermetic; a test proves the faces are used,
    not silently fallen back to.
  - **Cache.** A completed game's card never changes (INV-4), so `card.png` is
    `public, max-age=31536000, immutable`; the shell (which gains a replay loop in S3) is
    `public, max-age=3600`.
  - **Title copy.** The server card renders solver names and color chips but NOT the
    client-owned superlative copy (`TITLE_COPY`): that prose is not shared normative
    ground, so forking it server-side would break "never fork a string" and promoting it
    to a vector is wider than this wave. The bundle's titles are still read for the solo
    rule.
- **S3, the replay loop (done, Wave 13.3).** The share page plays the solve back: the
  bundle's `sequence` drives the mosaic, each square washing in with its owner's tint
  (or the solo gold ramp), looping gently. Exit met: a share link opens to the replay,
  still spoiler-free. The motion decisions:
  - **The loop: 16 seconds.** A 0.8s lead on the blank grid, an 11.6s reveal window,
    a 3.0s hold on the finished mosaic (the last 0.6s of the loop is the dissolve back
    to blank, so the settled board stands ~2.5s clean), then restart. The segments
    partition the loop exactly; a test pins the sum.
  - **Timing compression: real and linear, with a stall cap.** The sequence's active
    seconds map linearly onto the reveal window, so bursts read as bursts and stalls
    read as beats, never a metronome. One guard: a single inter-fill gap is clamped at
    90 active seconds BEFORE the scaling, so one long stare reads as the maximum beat
    instead of flattening everything else into a blur. Idle gaps are already collapsed
    upstream (D29); the cap only tempers within-sitting stalls.
  - **The wash: 0.5s, ease-out.** Each square fades from the blank face to its
    finished fill with a settle (`cubic-bezier(0.22,0.61,0.36,1)`); the finished fill
    is the same OWNER_TINT mix (or ramp color) the card paints, via the same builder.
  - **Pure CSS, no script.** The board is `completionBoardSvg` (the share-card
    builder's bare-mosaic render), inlined twice (Studio and Observatory, swapped by
    `prefers-color-scheme`), each open cell classed into a reveal group. Every cell
    shares one 16s infinite animation with zero delay; the reveal moment lives in each
    group's own keyframes (hidden until its percentage, wash, hold, communal fade), so
    the wrap clears the whole board in a single beat and the loop can never drift.
    Same-instant fills share a keyframes block, which keeps the emitted CSS small
    (a 15x15 page gzips under 10 KB). The page fetches nothing and carries no script.
  - **Reduced motion: the finished board, full stop.** The SVG's static state IS the
    completed mosaic; every animation rule lives inside one
    `prefers-reduced-motion: no-preference` media block, so reduced-motion viewers get
    the still card with zero motion and zero JS, and the hero is never empty.
  - **Solo.** The same loop, but the mosaic washes in on the pale-to-gold fill-order
    ramp (the S1 solo rule), so a solo replay reads as the grid warming toward the
    last square.
  - **Unchanged from S2:** the OpenGraph tags (unfurlers run no CSS; `og:image` stays
    the PNG), the shell's `public, max-age=3600` cache posture, the rate limit, and
    the soft 404.
- **The card params (done, Wave 14.3).** The iOS and Android apps share the completion
  card natively by fetching `card.png` rather than porting the `@crossy/share-card`
  builder into Swift and Kotlin: the server already draws the identical card, so a fetch
  is a lift, not a third and fourth copy of the layout that could drift from the web's.
  That means the one server render must cover the shapes a native share sheet wants, so
  `card.png` gains two whitelisted query params: `variant` (`og` default, the 1200x630
  unfurl; or `portrait`, the 1080x1620 flagship) and `ground` (`light` default, or `dark`
  for a dark device). Both default to today's og/light, so `og:image` is byte-identical
  to before. A `portrait` request for a solo solve renders the builder's solo layout, the
  same map the web export makes from the assembly's solo verdict; `og` is never solo. An
  unrecognized value falls into the shell's soft 404 (no distinct 400 oracle, no named bad
  param), and the `immutable` cache posture holds for every variant/ground combination,
  since a completed card never changes for any shape.
