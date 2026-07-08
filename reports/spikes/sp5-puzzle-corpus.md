# SP5: Puzzle corpus

**Question.** What do real crossword puzzles actually contain, in volume? Measure rebus
answer lengths (is the cap of 10 right?), digits and punctuation in solutions, grid
sizes, circled and shaded cells, and feature flags in the wild. This closes the two
DESIGN.md section 15 items, "confirm no real puzzle needs punctuation" (line 312) and
"rebus length cap of 10" (line 313), with data instead of guesses, and feeds the
ingestion ACL's named rejections (G1) plus comparator vector edge cases (1.1c).

**Answers.**

- **Rebus cap of 10: keep it.** Every rebus cell measured fits in 4 characters; the
  documented 94k-puzzle reference corpus tops out near 7 (`DIAMOND`). Ten has margin.
  An over-cap cell should be a named rejection, not silent truncation.
- **Charset stays `A-Z0-9`: keep it, do not add punctuation.** Solutions are
  A-Z-dominant. Digits occur and earn their place. Punctuation never needs to be
  *enterable*: first-character acceptance (D12) already completes cells like `A/B`. The
  only real hazard is a whole cell that is a lone symbol (`/`, `+`), which no legal
  input can satisfy; that is a named ingestion rejection, exactly as DESIGN line 156
  already prescribes.

Confidence: high on charset shape, grid bounds, and the presence of every structural
oddity below; medium on the exact rebus-length tail and punctuation frequency, which
rest on the reference corpus documentation rather than a random draw of our own. A
definitive maximum needs a scan of the owner's real corpus (see Open items).

## Corpus provenance and n

The local corpus is thin. The `crossy-fetcher` Azurite blob holds one real puzzle (NYT
Friday 2024-11-22) stored as ten identical copies plus two truncated fragments; the
`crossy` prior app carries one fixture (NYT Monday 2026-02-09, triplicated across test
dirs). Both are XWord Info JSON, the exact format ingestion will consume. That is two
distinct puzzles, far too few for a distribution.

The `crossword-fetcher` / `crossy-fetcher` pipeline is a Puppeteer scrape of
`xwordinfo.com/JSON/` behind an Azure timer, writing to Azure Blob storage. The task
forbids running it (it scrapes XWord Info) and the local `.env` is
`UseDevelopmentStorage=true` (Azurite, no real credentials). To re-run the owner's real
pipeline you would set `AzureWebJobsStorage` to a live connection string and POST
`/api/crossword`, or wait for the timer; it fetches only the current day, one puzzle per
run, so it is a slow way to build volume and not a corpus source.

The full open grid corpus does not exist as a single download. Saul Pwanson's xd project
(`century-arcade/xd`) has analyzed 94k+ puzzles, but the grid corpus (`gxd`) is a private
repo; only the clue text is public, and clues carry no grid, rebus, or circle data.

So the measured corpus is assembled from freely available parser test suites, which are
real published puzzles chosen to exercise format edge cases, plus the two local files:

| Source | Files | What it brings |
| --- | --- | --- |
| `alexdej/puzpy` testfiles | 20 `.puz` | NYT weekday/Sunday/rebus/diagramless/shape, WSJ, WaPo, CrosSynergy, AVClub, a UTF-8 test |
| `turnerhayes/xpuz` test files | 15 `.puz`, 1 `.ipuz` | LA Times, Newsday, USA Today, Universal, Joseph, Sheffer, NYT, a rebus, a circled ipuz |
| `svisser/ipuz` fixtures | 3 `.ipuz` | Puzzazz and Arthur Wynne (1913, the first crossword) samples |
| local `crossy-fetcher` blob | 1 | NYT 2024-11-22, XWord Info JSON, the ingestion format |
| local `crossy` fixture | 1 | NYT 2026-02-09, XWord Info JSON |

**n = 39 files, roughly 34 distinct puzzles** after collapsing save-state duplicates (one
rebus puzzle stored three ways, one NYT rebus stored three ways, one tiny test stored two
ways), of which two are synthetic mini test grids (3x3, 5x4). Across roughly 13
publishers and a century of dates (1913 to 2026). This is a convenience-plus-edge sample,
not a random one: test suites over-represent rebus, diagramless, and unicode relative to
a random daily. Distribution shapes below are read with that bias in mind, and each
verdict marks whether it is robust at this n or leans on the reference corpus.

Parsers (throwaway, uncommitted): a from-scratch `.puz` binary reader (header, `GRBS`/
`RTBL` rebus, `GEXT` circles, diagramless and scramble flags), an ipuz reader (JSONP
unwrap, `style.shapebg` circles, block and void cells), and an XWord Info JSON reader.

## Distributions

### Grid sizes

| Size | Puzzles | Note |
| --- | --- | --- |
| 15x15 | 22 | the daily standard |
| 21x21 | 7 | Sunday / large |
| 13x13 | 3 | Joseph, Sheffer, a themed daily |
| 11x13 | 1 | Joseph (non-square) |
| 16x17, 17x17 | 2 | diagramless |
| 22x22 | 1 | oversized NYT |
| 5x4, 3x3 | 3 | synthetic test grids |

15x15 and 21x21 are the two real clusters. Largest dimension seen is 22. **Nothing
exceeds the 25x25 cap (D13); the cap holds.** Two facts the ACL must not assume away:
grids are **not always square** (16x17, 11x13, 5x4) and **not always odd-dimensioned**
(22x22). The cap must check both dimensions independently. Black-square density on real
grids runs about 16 to 22 percent (a 15x15 with 36 blocks is 16 percent); diagramless
runs higher (45 percent), the 3x3 test has none.

### Rebus

7 of 39 files carry a rebus (about 4 distinct rebus puzzles after dedup): 36 rebus cells,
14 distinct values, every one a short uppercase token: month abbreviations `JAN`..`DEC`
(3 chars), `STAR` and `ANT` and the like.

- Length: min 3, max **4**, median 3. 75 percent are 3 characters, 100 percent are 4 or
  fewer.
- **The cap of 10 sits at the 100th percentile with 2.5x headroom over the observed
  maximum.**

The in-sample maximum of 4 is thin, so the tail leans on the xd reference corpus
(94k+ puzzles), documented in `doc/rebus-conventions.md` and the format spec:

- The dominant real pattern is a plain multi-letter rebus, one string used both
  directions. The longest quoted standard value is `DIAMOND` (7). Nothing in the
  documentation implies a common single-cell reading beyond 7 or 8.
- Schrödinger and quantum puzzles pack two readings into a cell with `/` and `|`
  operators (`KIT/KAT`, `UP/DOWN`, `PH/F`, `SE/S|E`). These are rare (about 19 puzzles
  use a non-trivial `/`, exactly one uses `|`, in 94k+). If ingestion ever stored the raw
  slash form the length would still be about 7; XWord Info stores a single canonical
  reading in the grid cell, which is shorter.

Ten characters covers the observed sample and the documented tail with room to spare.

### Charset in solution cells

Across the whole corpus, **8085 of 8085 solution characters are A-Z uppercase.** Zero
digits, zero punctuation, zero non-ASCII in any solution cell measured. Names that carry
accents in life appear transliterated to A-Z in grids, which is why the comparator's
ASCII-only rule (INV-1) and its `İ`/`ı` rejection vector hold against real content.

The exception is real but very rare, and the documentation names it precisely. The xd
spec permits "digits, most symbols, and printable unicode" in rebus cells, and the corpus
contains:

- Digit and symbol rebuses in number-, date-, and math-themed puzzles.
- Single-symbol cells: an AVClub 2017-11-01 puzzle with a cell that is a literal `/`, an
  NY Sun 2005-12-30 puzzle with cells `/ * + -`.

The distinction that matters for us: a cell like `A/B` or `A&B` is fine, because typing
`A` completes it under first-char acceptance. A cell that is *only* `/` or `+` is
unsolvable and must be rejected at ingestion. This is exactly DESIGN line 156, now backed
by named real examples.

Unicode and emoji do appear, but in **clue and metadata text, not solutions**: the puzpy
`unicode.puz` has solution `SPA/OHM/LIT` (plain A-Z) while its clues carry emoji, CJK, and
`φ`. DESIGN already accepts HTML and image clues; the comparator only ever touches
solutions, so clue unicode is not a charset hazard for gameplay.

### Circles and shading

8 files (5 distinct puzzles) carry circles, 5 to 55 cells each, across `.puz` (`GEXT`
0x80) and ipuz (`style.shapebg: "circle"`). Circles are common and structural-overlay
only. `.puz` has no shading concept at all; shading is an ipuz / XWord Info render
variant (`shadecircles`, `interpretcolors`). This confirms DESIGN's stance: accept
circles and shaded circles as a render variant with no gameplay effect.

### Structural features and ACL surprises

- **Diagramless**: 2 puzzles (`.puz` type `0x0401`). Correctly rejected today.
- **Locked / scrambled solution**: 4 puzzles. A locked `.puz` has its solution
  obfuscated behind a 4-digit key and is unreadable without brute force. This is a
  `.puz`-only concern; XWord Info JSON is always unlocked, so the JSON ingestion path is
  unaffected. Worth a line only if `.puz` ingestion is ever added.
- **Asymmetric grids**: 5 files are not 180-rotationally symmetric. Two are diagramless,
  two are tiny tests, and **one is a real published daily** (LA Times 2016-01-05, where
  the `ABOUTFACE` and `AHEADOFTIME` rows break rotational symmetry). Ingestion must not
  treat 180-symmetry as a validity invariant.
- **Multiple clues per number**: the xd corpus documents a Schrödinger puzzle
  (NYT 2021-11-04) where `A17`, `A40`, and `D11` each carry two clues for one slot. This
  collides with the `{number, text, cellIndices}` model, which assumes one clue per
  (number, direction). See G1 below.
- **Odd clue numbering**: `puzpy Feb0308_oddnumbering.puz` exists as a named real case of
  non-standard numbering; ingestion should derive numbering from the grid, not trust the
  file's numbers.
- **Unchecked cells**: white cells crossed by only one word. Absent from the American
  corpus (0, except the 5x4 test), but standard in British and cryptic grids. The
  playable-cell and completion model must tolerate a cell in only one direction.
- **Void / null cells**: ipuz supports non-rectangular grids with null cells. Out of
  scope for the XWord Info JSON path (rectangle plus `.` blocks), noted for completeness.

## Verdicts

### Rebus cap: yes, keep 10

Observed max 4, documented standard max about 7. Ten is safe with margin at zero cost.
Recommendation: **keep 10**, and make an over-cap cell a **named rejection**
(`REBUS_TOO_LONG`) rather than a silent truncation, consistent with the ACL's
reject-with-a-reason contract. DESIGN line 313 ("check at M6") can close now; SP5 is the
check.

### Charset: keep `A-Z0-9`, first-char acceptance covers punctuation

Do not broaden the enterable charset. Digits stay (real puzzles use them; v2 parity).
Punctuation and symbols never need to be typed: first-char acceptance completes any cell
whose solution begins with an `A-Z0-9`. The solvability rule (DESIGN line 156) is exactly
right and now has real triggering examples. DESIGN line 312 closes: **no real puzzle needs
punctuation in the input charset.**

### Named rejection list for the ingestion ACL (G1)

Confirmed already-listed rejections, now with concrete triggers:

- **Diagramless** (`.puz` type `0x0401`, XWord Info `type: "diagramless"`). Present in
  corpus.
- **Degenerate grid** (zero playable cells). The 3x3 all-white and tiny tests show cell
  counts vary widely; guard the zero case.
- **Unsolvable cell**, the important one to make concrete: reject any cell whose solution,
  ASCII-uppercased, is non-empty but has no `A-Z0-9` first character and does not match
  `^[A-Z0-9]{1,10}$`. Real triggers: AVClub 2017-11-01 (`/`), NY Sun 2005-12-30
  (`/ * + -`). Name it (`UNSOLVABLE_CELL`).

Additions this spike surfaces:

- **`REBUS_TOO_LONG`**: a cell whose canonical solution exceeds 10 characters. Not
  observed, but a defensive named rejection beats truncation.
- **`OVERSIZE_GRID`**: already implied by the 25x25 cap; the check must test both
  dimensions independently, since real grids are non-square and can be even-dimensioned.
- **Schrödinger / multiple clues per slot**: recommend a named rejection for v4
  (`AMBIGUOUS_SOLUTION`), consistent with rejecting quantum complexity. Real and rare.

Do **not** reject: asymmetric grids, unchecked cells. Both are valid real puzzles; the
model must tolerate them.

### Comparator vector edge cases (1.1c)

- Full-string vs first-char, from a real value: solution `STAR` accepts `STAR`, `star`,
  `S`, `s`; rejects `ST`, `TAR`, `T`.
- First-char over a symbol: solution `A/B` accepts `A` and `a`, rejects `/` and `B`. The
  whole-cell `/` case never reaches the comparator because ingestion rejects it, which is
  the link between G1 and 1.1c worth pinning in a vector comment.
- The `İ`/`ı` rejection and ASCII casing are supported by the corpus: no accented letter
  ever appears in a solution.

## Open items

- **Definitive rebus maximum.** The strongest number here (about 7) is documentation of a
  corpus we cannot scan directly. A one-query pass over the owner's real XWord Info
  archive, `max` of multi-character `grid` cell lengths, would confirm 10 empirically or
  surface an outlier. Cheap once the archive exists.
- **Punctuation frequency.** We know whole-symbol cells exist and are rare; we do not have
  a rate. Not blocking: the handling (named rejection) is the same at any low frequency.
- **XWord Info Schrödinger encoding.** How the JSON `grid` array represents a quantum cell
  (single canonical letter, full word, or slash form) determines whether such puzzles hit
  `AMBIGUOUS_SOLUTION` or pass as ordinary rebus. Verify against one real Schrödinger
  puzzle in the archive before finalizing that rejection.
