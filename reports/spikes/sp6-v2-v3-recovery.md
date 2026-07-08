# SP6: Recover the frozen v2/v3 reports

Question: do the frozen extraction reports (`v2-spec-extraction.md`, `v3-mining.md`)
exist anywhere, what are the exact `canEscapeWord` semantics in v2, and what are the
v2 pixel and timing constants the web grid will want? Cross-check against
`PROTOCOL.md` navigation semantics.

## Where I looked

- `/home/eamonma/Documents/web/crossy`: the prior app repo. Working tree is checked
  out on branch `v3` (the abandoned .NET rewrite). v2 lives in git history on branch
  `main` (head `98d973c`, 2025-10-03), a Next.js + Supabase app under `crossy-web/`.
- `/home/eamonma/Documents/web/crossword-fetcher` and `crossy-fetcher`: puzzle
  fetchers only (Azure functions, storage glue). No design docs, no gameplay code,
  nothing relevant to SP6.

## Recovered verbatim

Both reports existed and land byte-identical (checksums verified at copy time):

- `reports/v3-mining.md`: found as an untracked file
  `crossy/reports/v3-mining.md` (mtime 2026-07-07), md5
  `ace2b24a7575e37a887af3c5a4671c85`. Mines the v3 architecture docs; its constants
  (backoff, heartbeat 15 s / 45 s, cursor throttle 10/s, <20 KB snapshots) already
  inform PROTOCOL.md.
- `reports/v2-spec-extraction.md`: found as `SPEC.md`, commit `2ec3d72`
  ("Add behavioral specification for Crossy v2", 2026-01-30) on remote branch
  `claude/crossy-v2-spec-66VM8` in the `crossy` repo, md5
  `6e1fb3ba59817b177fd7c635853711ad`. A reverse-engineered behavioral spec of v2.

The recovered v2 spec is verbatim, so its errors ship with it. Against the code:

- It claims Delete "clears without moving". The code treats `Delete` and `del`
  (mobile keyboard backspace) identically to Backspace, including the step-back
  (`gameboard.tsx:247`).
- It claims "Enter: move to next clue". No Enter handling exists anywhere in the v2
  game code.
- It claims the 200 ms debounce is "before sending to server". Writes go out
  immediately per keystroke; the debounce is on *receiving* remote grid snapshots
  (`useRealtimeCrossword.tsx:87-96`).
- It says the across cursor arrow points left. The path `M 0,0 L 12,6 L 0,12 Z` is a
  right-pointing triangle (`gameboard.tsx:469`).

Neither report defines `canEscapeWord`, so that was mined from source.

## Mined fresh: canEscapeWord, exact semantics

All citations are `crossy@main:crossy-web/app/(app)/play/games/[slug]/...`.

v2 `getNextCell(grid, cols, rows, currentDirection, currentCell, direction='more',
answers?, canEscapeWord=true)` (`utils.ts:6-48`):

- **`canEscapeWord=false` returns the raw adjacent index and nothing else**
  (`utils.ts:22-24`). It early-returns `currentCell ± stride` before the block-skip
  loop, the filled-skip loop, and the bounds clamp. It can return a block index or
  an out-of-grid index. "Escape" is a misnomer: from a row's last cell it happily
  returns the next row's first cell.
- The only call site with `false` is the Tab first-empty scan
  (`gameboard.tsx:220-239`), which treats a block, a negative index, an index past
  the answers array, or an index past the word's right bound as "stop scanning" and
  falls back to the word start (Tab) or word end (Shift+Tab). So v2's *observable*
  behavior matches v4's clamp abstraction; the raw-return mechanics do not.
- With `canEscapeWord=true` (the default): skip blocks in either direction
  (`utils.ts:28-30`); moving forward with `answers` supplied, also skip filled
  cells, and if that scan ends at a block (word full to its end) fall back to the
  first cell after the block-skip (`utils.ts:32-41`, the
  `cellAfterIfWholeWordIsFull` variable). Nuance: the fallback fires only when a
  *block* ends the scan; a full word running to the grid edge overruns and the final
  clamp returns `currentCell` (stay put) instead (`utils.ts:43-45`).
- Out-of-bounds clamps to `currentCell`, but only on the `true` path
  (`utils.ts:43-45`).

Callers (`gameboard.tsx`): arrows move along the direction with block-skip and no
filled-skip (`:168-195`); typing advances with filled-skip, then wraps at word end
to the word start if incomplete, else stays on the last cell (`:289-305`);
backspace on an empty cell steps back with `canEscapeWord=true`, so it crosses
blocks into the previous word, and clears whatever it lands on (`:261-274`);
initial position is `getNextCell(..., 'across', -1, 'more')`, the first playable
cell (`gameLayout.tsx:34-43`).

`getNextWord` (`utils.ts:50-76`): next/previous clue's start cell; past either end
of the clue list, the grid's *first playable cell* (both directions).

## Mined fresh: v2 constants

Grid (SVG viewBox units, 1 cell = 36; `gameboard.tsx` unless noted):

| Constant | Value | Cite |
| --- | --- | --- |
| Cell size | 36 | `:88` |
| Cell stroke | `var(--gray-6)` width 0.6 | `:533-534` |
| Preview-grid stroke | `var(--gray-8)` width 0.6 | `components/crosswordGridDisplay.tsx:87-88` |
| Clue number | +2,+10 from cell corner, 10px bold, `--gray-11` | `:547-552` |
| Letter | x centered, y +32 (`cellSize/2 + 14`), 24px, `--gray-12`; x −3 when a teammate indicator shares the cell | `:563-572` |
| Circle | r = `cellSize/2.1` ≈ 17.14, stroke `--gray-8`, no fill | `:536-544` |
| Teammate arrow | 7×7 at (+27,+3), 12×12 viewBox, right triangle for across / down triangle for down, `--indigo-11` | `:460-473` |
| Teammate avatar | 10×9 at (+26,+26), circular clip r 4.5; initial fallback 8px bold `--indigo-12` at (+28,+32) | `:474-507` |
| Teammate count badge | 10px bold `--indigo-9` at (+27,+10) | `:510-522` |
| Board max height | 68svh phone, 75svh md, 70svh lg | `gameLayout.tsx:226` |

Colors (Radix scale, dark / light; `gameboard.tsx:327-336` unless noted):

| Role | Dark | Light |
| --- | --- | --- |
| Black square | `--gray-1` | `--gray-12` |
| Default cell | `--gray-3` | `--gray-1` |
| Current cell | `--blue-6` | `--yellow-4` |
| Active word | `--violet-3` | `--blue-3` |
| Teammate-here | `--gold-8` | `--gold-5` |
| Check: wrong cell | `--red-4` both (`check.tsx:27`) | |
| Cross-reference highlight | `--amber-3` both (`gameLayout.tsx:136`) | |
| Clue list: active clue | `--amber-5` same-direction, `--amber-3` cross-direction (`clues.tsx:100-103`) | |

Background precedence in code: black square > current cell > check/cross-reference
highlight > active word > teammate-here > default (`gameboard.tsx:421-433`).
Matches DESIGN.md section 10 exactly.

Timing and tuning:

| Constant | Value | Cite |
| --- | --- | --- |
| Inbound remote-grid debounce | 200 ms | `useRealtimeCrossword.tsx:87-96` |
| Timer tick | 1 s, basis `game.created_at` | `timer.tsx:21-23`, `gameLayout.tsx:204` |
| Timer format tiers | `HH:MM:SS`, `Xd HH:MM:SS`, `Xw Xd`, `Xy Xw` | `timer.tsx:57-82` |
| Confetti recycle | 5 s after completion | `useConclusion.tsx:18-20` |
| Page transition | 0.2 s | `appLayout.tsx:19-21` |
| Content entrance | `animateIn 0.3s ease 0.15s both` | `globals.css:40` |
| `findBounds` LRU cache | 500 entries | `utils.ts:78` |
| Input charset | `/[a-z0-9]/i`, uppercased via plain `toUpperCase()` | `gameboard.tsx:278-280` |
| Optimistic sync | `anticipated` pending-op counter; remote snapshot applied only at zero | `gameboard.tsx:117-123` |
| Cursor broadcast | none: no throttle, channel resubscribed per move | `useRealtimeCrossword.tsx:222-230` |

Notes for v4: the LRU cache and `anticipated` counter are workarounds v4's engine
and `commandId` overlay replace, not values to copy. v2 dispatched synthetic
`KeyboardEvent`s from the on-screen keyboard (`keyboard.tsx:17-19`); v3's docs
already flagged that as a mistake and v4 drives store actions directly.

## Cross-check against PROTOCOL.md

Agreements:

- Navigation vector cases 1 through 10 are byte-for-byte the v2 test suite
  (`utils.test.tsx`): same 5×4 fixture, blocks {2, 6, 13}, same expectations.
  "Seeded verbatim from v2's proven behavior" holds for those ten. Cases 11 and 12
  are v4 additions.
- Case 12 (flag is a mid-word no-op) matches v2: both flag values return 1 from
  cell 0.
- Typing wrap at word end, Tab-forward first-empty with fall-back-to-start,
  clue-list wrap to first playable cell, grid-edge clamp (flag true), arrows,
  click-to-toggle, swipe mapping, and initial position all match v2 code.
- Presence numbers (heartbeat 15 s / 45 s, cursor 10/s) and reconnect backoff come
  from v3, consistent with `v3-mining.md`; v2 had no equivalents.

Divergences (findings, not fixes; vectors and PROTOCOL.md stay as they are):

1. **Vector case 11 does not reproduce v2.** `across, 1, forward,
   canEscapeWord=false` expects 1 (hold at word end). v2 returns 2, the block,
   because `false` short-circuits before any checks (`utils.ts:22-24`), and it can
   also return out-of-grid indices (from 19: 20). v4's "clamp at word end" is a
   deliberate re-specification of a flag v2 implemented as "raw step, caller
   guards". Sane cleanup, but a straight port of v2's `getNextCell` fails case 11,
   and DESIGN.md section 5's "confirm" flag on this semantics resolves as:
   confirmed different from v2 mechanics, equivalent to v2's observable behavior
   under its only guarded call site.
2. **Shift+Tab never scans for the first empty cell.** The planned word-nav
   vectors say "Tab landing on a clue's first empty cell (start or end when the
   clue is full)". v2's Shift+Tab walks *backward* from the previous clue's start
   (`gameboard.tsx:220-239` with `towards='less'`), so it lands on the start if
   empty, else the end; a mid-word empty is never found. Bonus v2 bug: the
   backward scan guard checks `> right` but never `< left`, so a clue starting at
   column 0 can scan into the previous row's word. Decision needed when writing
   those vectors: symmetric first-empty (new behavior) or v2's asymmetry.
3. **Backspace step-back crosses word boundaries.** v2's empty-cell backspace
   steps back with block-skip enabled and clears the previous *word's* last cell
   when at a word start (`gameboard.tsx:261-274`). The planned "backspace stepping
   back through an already-empty cell" vector must pick: clamp to the word, or
   cross like v2.
4. **Timer basis.** v2 measures from `game.created_at`; v4 from `firstFillAt`
   (DESIGN.md section 2). Intentional, but the M6 parity checklist should not
   compare timer values against v2.
5. **Completion inverted by design.** v2: client detects, then POSTs an
   unauthenticated `/api/games/claim-complete` which re-verifies
   (`useConclusion.tsx:30`, `claim-complete/route.ts`). v4: server-only,
   level-triggered (PROTOCOL.md section 10). Already documented in DESIGN.md
   section 3.
6. **Comparator widened by design.** v2 compares first characters only, on both
   client and server (`gameboard.tsx:133`, `claim-complete/route.ts:43`), and is
   case-sensitive at compare time (safe only because input is uppercased). v4
   accepts full string or first char, case-insensitive (PROTOCOL.md section 10,
   D12).

## Answer

Both frozen reports recovered verbatim; nothing had to be reconstructed. The
`canEscapeWord` question is answered from source: v2's flag disables *all*
processing (skip, clamp, bounds), not just word escape, and PROTOCOL.md's case 11
plus DESIGN.md's clamp description are a deliberate v4 tightening, not v2 parity.
The pixel and timing constants above are the complete deliberate set from v2's
grid UI. Three open decisions surfaced for the planned navigation vectors
(divergences 1 through 3); none require changing existing vectors or PROTOCOL.md.
