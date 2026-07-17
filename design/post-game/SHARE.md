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
- **S2, the share link (blocked on S1).** A share URL whose OG image is the og variant,
  rendered server-side from the analysis bundle by the same package (the standalone
  rule is what makes this a lift, not a port). Exit: pasting a share link into Discord
  unfurls the card.
- **S3, the replay loop (blocked on S2).** The share page plays the solve back: the
  bundle's `sequence` driving the same mosaic reveal the Analysis tab owns, a living
  card for whoever taps through. Exit: a share link opens to the replay, still
  spoiler-free.
