# v2 navigation audit

Settles two gating questions for the track-d navigation vectors (Shift+Tab semantics,
rebus entry) and re-verifies every other navigation claim in
`reports/spikes/sp6-v2-v3-recovery.md` against v2 source. All citations are
`crossy@main:crossy-web/app/(app)/play/games/[slug]/<file>:<line>`, head `98d973c`,
read via `git -C /home/eamonma/Documents/web/crossy show main:<path>`. Nothing in that
repo was checked out, edited, or built; its `v3` working tree was left untouched.

Fixture used throughout, matching PROTOCOL.md section 13 (`utils.test.tsx:5-10`,
blocks at 2, 6, 13):

```
 0=A  1=B  2=.  3=D  4=E
 5=F  6=.  7=H  8=I  9=J
10=K 11=L 12=M 13=. 14=O
15=P 16=Q 17=R 18=S 19=T
```

## Verdict 1: Shift+Tab does not scan for the first empty cell

The owner's belief is wrong about the shipped code. v2's Shift+Tab is not a backward
mirror of Tab's forward first-empty scan. It is a single raw step off the target
clue's start cell, guarded only on one side, that in the ordinary case can only ever
land on that clue's start (if empty) or its end (if not), never on a genuinely
mid-word gap. DESIGN.md section 5's prose ("its end on Shift+Tab", `DESIGN.md:127`)
already specifies the symmetric, non-buggy behavior the owner remembers; that is a
correct forward-looking design choice, not v2 parity. **The track-d vectors should
implement true symmetric first-empty scanning and must not port v2's `getNextWord`
plus raw-step loop for Shift+Tab.**

Mechanism (`gameboard.tsx:196-244`, shared by Tab and Shift+Tab):

1. `getNextWord(...)` (`utils.ts:50-76`) returns the **start cell** of the adjacent
   clue in the current direction's clue list. For `towards='less'` this is the
   previous clue's start, never its end (`utils.ts:67, 73-75`).
2. `[left, right] = findBounds(...)` on that start cell fixes the target clue's
   bounds once, before any scanning (`gameboard.tsx:211-218`).
3. `while (answers[nextCell])`: as long as the current `nextCell` is filled, step by
   exactly one raw cell via `getNextCell(..., canEscapeWord=false)`
   (`gameboard.tsx:220-227`), which for `canEscapeWord=false` just returns
   `currentCell ± stride` with no block-skip, no bounds check (`utils.ts:20-24`).
4. After each step, a guard checks `grid[nextCell] === '.' || nextCell >=
   answers.length || nextCell < 0 || nextCell > right` (`gameboard.tsx:229-234`). If
   any fires, break: land on `right` (word end) for `towards='less'`, or `left` (word
   start) for `towards='more'` (`gameboard.tsx:235-236`).

The bug: step 3 starts **at the word's own start cell**. Decrementing from a word's
start cell leaves the word on the very first step in all but one case: that cell is
by definition either a block or the grid edge. So for Shift+Tab the loop in practice
runs at most one iteration: either the start is empty and the `while` never enters
(land on start), or the start is filled, the single backward step immediately meets a
block, and the guard fires (land on end). There is no room left in the loop to walk
across the clue's own interior: the walk exits the clue before it can inspect any
cell but the start. Forward Tab does not have this problem: it starts at the same
word-start cell but steps *forward*, so incrementing stays inside the word and
genuinely scans cell by cell until an empty one is found or the block past the word's
end is hit.

Second bug, independent of the first: the guard tests `nextCell > right` but never
`nextCell < left`. For a clue whose predecessor cell is an actual block, that is
inert: decrementing from the start only ever produces values `<= left`, so `>
right` never fires and the block check alone stops the walk. But for a clue that
starts at column 0 (any row but the first), the cell one step back is the *previous
row's last column*: a real grid index, not a block, and not caught by any guard
clause. The backward walk then continues into a completely unrelated clue's cells,
checking their fill state, until it happens to hit an actual block (or the grid
edge). Concrete trace below.

### Hand traces

All traces: current selection somewhere in clue **10-12** ("K L M", row 2), direction
`across`, user presses Shift+Tab (`towards='less'`). `getNextWord` resolves the
previous across clue to **7-9** ("H I J", row 1), so `originalNextCell = nextCell =
7`, `[left, right] = [7, 9]` (`gameboard.tsx:210-218`).

**(a) Previous clue fully empty**: `answers[7] = answers[8] = answers[9] = ''`.
`while (answers[7])` is false immediately; the loop body never runs. `nextCell`
stays `7`. **User observes: cursor lands on cell 7, the clue's start.** This is
exactly what a genuine first-empty scan would also produce (cell 7 is the first cell
checked either way), so it is indistinguishable from the "correct" behavior.

**(b) Previous clue has only a mid-word empty**: `answers[7] = 'H'`, `answers[8] =
''`, `answers[9] = 'J'`. `answers[7]` is truthy, loop enters: raw step to `6`
(`gameboard.tsx:220-227`). Guard: `grid[6] === '.'` is true (6 is a block), so it
fires immediately. `towards === 'less'`, so `nextCell = right = 9`
(`gameboard.tsx:235-236`). **User observes: cursor lands on cell 9, the clue's last
letter**, skipping straight over the actual gap at cell 8, which a genuine
first-empty scan would have landed on. This is the one state that exposes the bug.

**(c) Previous clue full**: `answers[7] = 'H'`, `answers[8] = 'I'`, `answers[9] =
'J'`. Identical trace to (b): one step to `6`, guard fires on the block, lands on
`nextCell = 9`. **User observes: cursor lands on cell 9**, same outcome as (b). A
user cannot tell "clue has one gap in the middle" apart from "clue is completely
full" by watching where Shift+Tab lands: both look like "landed on the end."

**(d) Bonus: the missing `< left` guard, same fixture.** Selection in clue **14**
(single cell, row 2 col 4), Shift+Tab targets the previous across clue, **10-12**
(column-0 start). `originalNextCell = nextCell = 10`, `[left, right] = [10, 12]`.
Suppose `answers[10] = 'K'` (filled) and `answers[9] = ''` (empty: cell 9 belongs to
the unrelated clue **7-9**). Loop enters: raw step to `9` (`10 - 1`). Guard:
`grid[9] === '.'`? No (`grid[9] = 'J'`). `9 > right(12)`? No. Guard does not fire.
Loop continues to top: `while (answers[9])` is false (the cell is empty), so the
loop exits normally with `nextCell = 9`. **User observes: cursor lands on cell 9, inside
clue 7-9, a completely different clue from the one Shift+Tab was supposed to
target.** The clue bar and active-word highlight (recomputed from `currentCell` via
`findBounds` in `Gameboard`'s effect, `gameboard.tsx:314-325`) will jump to "7-9",
not "10-12". If `answers[9]` had been filled instead, the walk would have continued
through cells 8 and 7 before finally hitting the block at 6 and landing on
`right = 12`, wandering through two unrelated clues before arriving, by luck, at the
correct clue's end.

### Why "first empty square" is a plausible memory

The divergence is invisible in the two most common states: a completely empty
previous clue (both v2 and a true first-empty scan land on the start, trace a) and a
completely full one (both land on the end, trace c). It only surfaces when the
previous clue's *start* cell specifically is filled while some *later* cell in that
same clue is still empty (trace b), a state that is common in practice (an
intersecting down entry fills an across clue's first letter before the across clue
itself is typed) but easy to miss, because the active-word highlight paints the whole
clue the same background regardless of which exact cell has focus
(`gameboard.tsx:421-433`; only the `currentCell` square gets the distinct "current
cell" color). A user tabbing quickly across many clues, watching the highlighted band
rather than the single focus square, would plausibly never register that Shift+Tab
kept parking them one cell short of the actual gap.

## Verdict 2: no rebus entry UX existed in v2

There is no multi-letter cell input anywhere in v2. Searched broadly (`git grep -in
rebus`, `multi.letter`, `multichar` across `crossy-web`: no hits) and read every input
path:

- **Keyboard input is gated to exactly one character.** `value.length === 1 &&
  value.match(/[a-z0-9]/i)` (`gameboard.tsx:278`) is the sole guard admitting a
  keystroke as a letter; anything longer never reaches `setAnswers`.
- **The on-screen keyboard cannot emit more than one character either.** Every key
  dispatches a synthetic single-character `keydown` (`keyboard.tsx:13-19`); the
  layout has no rebus/multi-letter key (`keyboard.tsx:27-33`).
- **Cell rendering has no rebus layout.** `<text>{answers[i]}</text>`
  (`gameboard.tsx:562-576`) has one fixed 24px font size and no width-fit or
  multi-glyph shrink logic: a length-1 string is all it was ever built to receive.
- **The comparator only ever checks the first character, on both client and server**:
  `answers[i]?.charAt(0) !== crosswordData.grid[i]?.charAt(0)` for the client-side
  auto-claim effect (`gameboard.tsx:133`) and the manual "Check" action
  (`check.tsx:26`); `puzzle.grid[i]?.charAt(0) !== grid[i]?.charAt(0)` server-side
  (`claim-complete/route.ts:43`).

The puzzle ingest schema, though, is rebus-*capable* on the data side:
`grid: z.array(z.string())` (`crosswordJson.ts:442`) has no length cap, matching the
upstream XWord Info format where a rebus cell's solution is a full word (e.g.
`"STAR"`). So a rebus puzzle would ingest fine, and `crosswordData.grid[i]` could
genuinely hold a multi-character solution, but the client never lets you type more
than one character into that cell, and the `.charAt(0)` comparator quietly accepts
just the first letter as correct. That is DESIGN.md's own framing exactly: "v2
shipped first-char-only by accident" (`DESIGN.md:119`). There was never a rebus
*feature*; there was a solution format that happened to tolerate rebus cells because
the comparator was too narrow to reject them, with zero corresponding entry, display,
or storage support. This is a plain absence, not a variant worth modeling in the
navigation vectors.

## Audit: every other SP6 navigation claim vs source

| # | Claim (SP6) | Verdict | Citation |
| --- | --- | --- | --- |
| 1 | Typing advances with filled-skip, then wraps to word start if incomplete, else stays on last cell | Confirmed | `gameboard.tsx:289` (`getNextCell(..., 'more', newAnswers)`: filled-skip via `answers` param, `utils.ts:32-41`); `gameboard.tsx:294-305` (outer wrap-to-`bounds[0]`-or-`bounds[1]` re-clamp against the *pre-keystroke* word, which is why typing can never actually escape into the next clue even though the inner call has `canEscapeWord` defaulting `true`) |
| 2 | Backspace on an empty cell steps back with block-skip enabled and clears the previous word's last cell, crossing word boundaries | Confirmed | `gameboard.tsx:247-274`: `isPrevEmpty` check at 248, `getNextCell(currentDirection, i, 'less')` at 263 with no `answers` arg (filled-skip off) and no explicit `canEscapeWord` (defaults `true` at `utils.ts:15`, so block-skip is on); `newAnswers[nextCell] = ''` at 265 clears whatever lands there, in whichever word that is |
| 3 | Backspace on a non-empty cell just clears it, no move | Confirmed | `gameboard.tsx:163` (`nextCell` initialized to `currentCell`, never reassigned when `isPrevEmpty` is false) |
| 4 | Tab (forward) scans for the target clue's first empty cell, falls back to its start if full | Confirmed. Unlike Shift+Tab this scan genuinely works, since incrementing from a word's start stays inside the word | `gameboard.tsx:196-239` general mechanism; forward-specific: stepping from `left` with `towards='more'` moves deeper into the clue each iteration, so the `while (answers[nextCell])` loop actually inspects every interior cell until an empty one is found or the block past the clue's own `right` bound is hit, triggering the `nextCell = left` fallback (`gameboard.tsx:235-236`) |
| 5 | `getNextWord` wraps past either end of the clue list to the grid's first playable cell | Confirmed, both directions | `utils.ts:69-70`: `if (nextIndex < 0 \|\| nextIndex >= clues[currentDirection].length) return grid.findIndex((cell) => cell !== '.')` |
| 6 | Initial position is the first playable cell, direction across | Confirmed | `gameLayout.tsx:34-43` (`getNextCell(..., 'across', -1, 'more')`, `currentDirection` state initialized to `'across'` at `gameLayout.tsx:44-46`) |
| 7 | Arrows move along the current direction with block-skip and no filled-skip; across the current direction they toggle | Confirmed | `gameboard.tsx:168-195`: each `ArrowRight/Left/Down/Up` branch calls `getNextCell(direction, currentCell[, 'less'])` with no `answers` arg (no filled-skip, `canEscapeWord` defaults `true` so block-skip is on); the mismatched-direction branches call `toggleDirection()` (`gameboard.tsx:84-86`) without moving `currentCell` |
| 8 | `canEscapeWord=false` returns the raw adjacent index, bypassing block-skip, filled-skip, and the bounds clamp entirely; its only call site is the Tab/Shift-Tab scan loop | Confirmed | `utils.ts:22-24` (early return before any of the later logic); sole call site with an explicit `false` is `gameboard.tsx:221-227` (grepped the whole `crossy-web` tree for `getNextCell(` and `canEscapeWord`, and no other site passes `false`) |
| 9 | Tab at the last clue of an axis does *not* cross from across to down | Confirmed (SP6 did not make this claim explicitly; added here since it gates track-d vectors) | `getNextWord` operates only within `clues[currentDirection]` (`utils.ts:63-71`) and the Tab handler never calls `setCurrentDirection` (`gameboard.tsx:196-244`, absent), so wrapping past the last across clue lands on the grid's first playable cell *still in across direction*, even though that cell may also be a down-clue start |

All nine hold up against source; none needed correction beyond the added precision on
items 4 and 8, and the new item 9 (SP6 did not test the axis-crossing question, and it
directly affects how "Tab wraps to grid's first playable cell" should be worded in a
vector).

## Catalog: v2 interaction model, for writing the track-d vectors

Each item tagged `[mined]` (read directly from source) or `[inferred]` (reasoned from
mined code, not itself a line of code).

- **Click-to-toggle direction.** `[mined]` Clicking a non-block cell sets it as
  current; clicking the *already-selected* cell toggles direction without moving
  (`gameboard.tsx:92-99`). Clicking any other cell, even one in the same word, never
  toggles: direction only changes via the same-cell click or an across-axis arrow.
  Clicking a block cell is a no-op (`gameboard.tsx:93`).
- **Clue-list click bypasses all scanning.** `[mined]` Clicking a clue in the sidebar
  jumps straight to `gridnums.indexOf(clueNum)`: the clue's start cell,
  unconditionally, regardless of fill state (`clues.tsx:118-123`). No first-empty logic runs on this
  path; it differs from both Tab and Shift+Tab.
- **Clue "solved" strikethrough is dead code.** `[mined]` `clues.tsx:74` hardcodes
  `const clueIsFilled = false` and never recomputes it; the strikethrough CSS class
  wired to it (`clues.tsx:131`) never fires. Worth knowing only so nobody mistakes it
  for a real "auto-detect solved clue" feature when reading the UI.
- **Tab does not cross axes at either end of a clue list.** `[mined]` See audit item 9
  above. A track-d vector for "wrap to grid's first playable cell" should pin both
  `currentDirection` unchanged and the landing cell, since the landing cell is not
  guaranteed to be a start of a word in the *current* direction if the grid's first
  playable cell only starts a word in the other direction.
- **Navigation stays live after the game leaves `ongoing`; mutation does not.**
  `[mined]` The Arrow/Tab block in `handleSetCell` runs unconditionally at the top of
  the function (`gameboard.tsx:168-244`); the `if (!gameIsOngoing) return` guard sits
  after it, only gating Backspace/Delete/typing (`gameboard.tsx:246-247`). Click
  navigation has no `gameIsOngoing` check at all (`gameboard.tsx:92-99`). So a
  completed or abandoned game still lets a client move the cursor and toggle
  direction; it just can't write letters. `[inferred]` Since v4 navigation is
  client-only local state with no wire effect, this is consistent with v4's INV-4
  ("terminal states freeze" is about board *mutation*) and needs no special-casing in
  the vectors, but it is worth a vector case if the reducer or store ever grows an
  opinion about cursor state, so a "navigate after completion" case does not
  regress silently.
- **Swipe maps to Tab/Shift-Tab along the current direction, arrow-equivalent across
  it.** `[mined]` Swiping in the current direction's axis (`Left`/`Right` when across,
  `Up`/`Down` when down) dispatches `Tab`, with `shiftKey` set for the "backward" swipe
  (`Left` or `Up`) (`gameboard.tsx:342-364`). Swiping across the current axis
  dispatches the matching arrow key, which the arrow handler turns into a direction
  toggle since direction mismatches (`gameboard.tsx:168-195`). No swipe-to-toggle
  distinct from the arrow path exists; it is fully reused.
- **On-screen keyboard has no Tab/Shift-Tab or arrow keys at all.** `[mined]` The
  layout is `q`-`m` plus a single `Delete` key (`keyboard.tsx:27-33`); mobile
  navigation between clues is swipe-only or the clue-list tap. There is no on-screen
  equivalent of desktop Tab.
- **No double-click handling anywhere.** `[mined]` Grepped `crossy-web` for
  `dblclick`/`doubleclick`/`ondoubleclick`: no hits. Only single click (select or
  toggle) exists.
- **No Enter or Escape handling anywhere.** `[mined]` Grepped for both: no hits,
  confirming and extending SP6's "no Enter handling exists" finding to include
  Escape.
- **`Delete` and mobile `del` are aliased to Backspace, including the step-back.**
  `[mined]` Reconfirms SP6: `['Backspace', 'Delete', 'del'].includes(value)`
  (`gameboard.tsx:247`) is one branch, not two.
- **Word-full fallback direction is asymmetric between Tab and typing.** `[inferred]`
  from mined code: a fully-filled *next* clue and forward Tab lands on that clue's
  *start* (`gameboard.tsx:235-236`, `towards='more'` branch), while typing into a
  fully-filled *current* word leaves the cursor on the current word's *end*
  (`gameboard.tsx:300-304`). Both are "stop, don't advance further," but they resolve
  to opposite ends of a word depending on whether the trigger was Tab or the last
  keystroke. Not a bug exactly, just an asymmetry worth an explicit vector pair so it
  is pinned on purpose rather than by accident, the way case 12 already pins the
  mid-word `canEscapeWord` no-op.
- **`findBounds` is memoized per `(grid identity or puzzle id, cols, rows, direction,
  cell)`.** `[mined]` `utils.ts:80-98`. Not navigation semantics itself, but relevant
  if a vector ever exercises repeated bounds lookups against a mutated grid array
  without a stable puzzle `id`: the fixture's cache key falls back to
  `grid.join('')`, which is safe for the vectors (all `given` state is a fresh array
  literal) but would be a real staleness bug in a long-lived client that mutates
  `grid` in place instead of replacing the array.

None of these catalog items require changing an existing vector or PROTOCOL.md
wording. The one item that *should* change how a planned vector is written is
Shift+Tab (Verdict 1): the "clue's first empty cell (start or end when the clue is
full)" phrasing already in PROTOCOL.md section 13 is correct as a *target*
specification and should be implemented as genuine symmetric first-empty scanning,
not the v2 mechanism this audit traced.
