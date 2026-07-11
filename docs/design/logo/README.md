# Crossy logo exploration

A selection set, not final assets. Nothing here is wired into the app; the live iOS
icon, favicon, and sidebar are untouched. Pick a direction, and the survivor gets
rebuilt on real tokens (ImageRenderer app icon, scheme-aware SVG favicon, `Logo` in
`apps/web/src/ui/primitives.tsx`).

Open `sheet.html` in a browser to judge everything side by side. Each direction ships
four SVGs: `icon-light.svg` and `icon-dark.svg` (1024, Studio and Observatory grounds,
squircle as a stand-in for the system mask), `favicon.svg` (drawn on a 32 grid, must
survive 16), and `wordmark.svg` (the sidebar lockup: mark 24, gap 6, display serif
semibold 18, the recipe `AppShell.tsx` already carries).

This sheet builds on the earlier A to D contact sheet: A the crossword cell, B round
caps, C 1-Across, D the ink block. Directions 01 through 04 are those four pushed to a
full identity each; 05 stages the web's existing drawn monogram against them so the
incumbents compete honestly.

## Ground rules the set obeys

- Real tokens only: `Grounds.swift` Studio and Observatory palettes, web `gold-9`
  (#978365) as the single permitted accent. No gradients, no bevels, no third color.
- One object per mark. If it needs a caption to parse, it is out.
- Favicon and wordmark SVGs flip ink with `prefers-color-scheme`, so toggle OS
  appearance to judge dark tabs and the dark sidebar.

## The directions

### 01 · The Cell (from A)

One square of the grid holding its clue number and a C. This is the shipped app icon
restaged as the whole identity; below icon scale the number retires and the mark
becomes cell plus C.

Fits because the cell is the atom of the product and it is already on the phone.
Risk: the letterform does the work, so at 16px it is a letter in a box, quiet to the
point of anonymous. Also the least differentiated from every other letter-in-a-tile
app icon.

### 02 · The Crossing (from C, 1-Across)

A four-cell across entry and a three-cell down entry sharing one square; the shared
square is the one gold accent. Deliberately asymmetric so it reads as a grid crossing,
never a pharmacy plus. This is the only direction that says the actual product: two
words, two people, one cell.

Fits the space-age register best: flat interlocking geometry, Panton-bold, no type.
Strongest shrinker in the set; at 16px it is still exactly itself. Risk: abstract
enough that it needs a beat to read as crossword rather than generic tetromino.

### 03 · The Checker (from D, the ink block)

The smallest true crossword fragment: a 2x2 tile, two open cells, two ink blocks on
the rising diagonal. The icon shows the full tile on the ground tokens; the favicon
reduces to the two blocks and lets negative space imply the rest.

Fits because the black square is the most iconic single object in crosswords and
nobody owns it. Quietest mark here, pure Eames economy. Risk: two rounded squares can
drift toward generic geometry, and it says "crossword" more than it says "Crossy",
there is no letter anywhere.

### 04 · The Open C (from B, round caps)

A round-capped C stroke with a cell docked in its aperture, completing the implied
circle. The letter carries its square: C for Crossy, cell for crossword, one object.

The most designed mark of the set, orbit-and-station space-age. Drawn geometry rather
than type, so the favicon holds at 16. Risk: rotated it flirts with power-button and
spinner cliches; the square (not a dot) in the gap is what keeps it honest. Judge it
upside down and small before trusting it.

### 05 · The Ligature (the web incumbent, undisked)

The existing drawn Cy monogram from `primitives.tsx`, lifted out of its gold disc and
staged bare: ink on Studio, bone on Observatory. Included so the current web equity
competes on the same board instead of dying by default.

Fits the claude.ai register: a single confident piece of type as the whole brand.
Risk is scale: a drawn serif ligature at 16px mushes, and the favicon file here is the
honest stress test. If it wins, it likely wins as icon and sidebar mark with a
simplified favicon cut from it.

## How to choose fast

1. Squint at the 16px column in `sheet.html`. Kill anything that dies.
2. Toggle OS dark mode. Kill anything that only works on bone.
3. Imagine it alone on a phone screen with no name under it. Kill anything that
   could belong to another app.

## What happens to the survivor

- App icon: rebuilt via the existing SwiftUI ImageRenderer pipeline on Ground tokens
  (light, dark, tinted; opaque flattened, 1024).
- Favicon: a real scheme-aware SVG favicon plus fallback PNGs.
- Web sidebar: `Logo` swap in `primitives.tsx`, keeping the mark-holds-still,
  wordmark-tucks behavior `AppShell.tsx` already implements.
- iOS wordmark and any in-app brand moments follow, same tokens.
