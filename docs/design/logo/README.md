# Crossy logo

The canonical identity: one mark, one wordmark, two lockups, light and dark.
Every SVG here is emitted by `generate.py`. Edit the generator, never the SVGs.

| file                                       | what                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| `mark-light.svg` / `mark-dark.svg`         | the mark alone                                       |
| `wordmark-light.svg` / `wordmark-dark.svg` | Crossy, Harfang Pro outlines                         |
| `lockup-horizontal-*.svg`                  | mark, gap, wordmark                                  |
| `lockup-stacked-*.svg`                     | mark above wordmark                                  |
| `wordmark_data.py`                         | committed Harfang outlines (see below)               |
| `app-icon/`                                | the CROSSY crossword icon: emitted SVGs + PNG cutter |
| `preview/`                                 | rendered lockups for review                          |

## The mark

The 3x3 heart of the CROSSY crossword: three blocks stepping down the
anti-diagonal to one gold cell, the Y's cell. Grid lines run to the frame so
the puzzle reads as continuing past the crop. The full CROSSY tile (the app
icon) spells the name, so it never sits beside the wordmark; the lockup
carries this fragment.

Light draws ink on the ground, open cells transparent. Dark is the plate
treatment the app icon and favicon already use: open cells glow bone, the
gold cell stays gold, the ground shows through as blocks and grid lines.

## The wordmark

Crossy in Harfang Pro, normal 600, the brand serif the app already sets.
Typekit text is render-unstable (the kit may not load, the fallback differs),
so the canonical wordmark is outlined to vector paths: `wordmark_data.py`
holds the six glyphs, their advances and GPOS kerning, extracted from the
project's own Adobe Fonts kit by `extract_wordmark.py`. Only outlines are
committed, never a font file; Adobe Fonts permits logo artwork made from an
active kit. Rerun the extractor only if the kit or the face changes.

## The lockup recipe

Horizontal: mark 24, gap 6 to the type origin, Crossy at 18 semibold,
tracking -0.00625em, mark box and text box center-aligned. With Harfang's
metrics (ascent 947, descent 275, upem 1000) the baseline lands 18.048 below
the mark top; the SVGs bake that in. This is exactly what the web renders
live (`Logo` in `apps/web/src/ui/primitives.tsx`, mark 24, gap 6, text 18).

Stacked: mark 24 centered over the word ink, gap 6 from mark bottom to the
cap line.

## Tokens

| token                     | value                                                      |
| ------------------------- | ---------------------------------------------------------- |
| ink                       | `#1D1B18`                                                  |
| bone                      | `#EDEAE2`                                                  |
| gold                      | `#978365` (gold-9, the single accent, always the Y's cell) |
| Studio ground (light)     | `#F2F1EC`                                                  |
| Observatory ground (dark) | `#121118`                                                  |

No gradients, no bevels, no third color. One object per mark.

## Clear space and minimum size

Clear space: one grid cell (a third of the mark) on all sides, minimum.
The mark holds from 20px up; below that use the favicon reduction. Lockups
hold from mark height 20 up. In-app UI text near the logo follows the app's
own type system; the wordmark is never re-set in live text on brand surfaces
(store pages, social cards, print).

## One geometry, four artifacts

The crossword core (blocks on the anti-diagonal, CROSSY in the open cells,
gold on the Y) is defined once in `generate.py`. Everything else is a crop or
reduction of it:

- the mark: the 3x3 core, letters retired
- app icon: crop-medium, a 5x5 grid around the core, the frame slicing the
  outer ring mid-cell (`app-icon/`)
- favicon: a 2x2 reduction keeping the mark's two signature corner cells,
  the top-right block and the gold Y cell (`apps/web/public/favicon.svg`,
  emitted here)
- web mark: the same 3x3 as JSX in `apps/web/src/ui/primitives.tsx`
  (`CrosswordMark`), themed with currentColor and the gold token;
  `generate.py` fails if its geometry drifts

## Regenerating

```sh
python3 generate.py   # all SVGs + the web favicon + the drift check
./render.sh           # the above, then preview PNGs (qlmanage + Pillow)
app-icon/render.sh    # appiconset PNGs, only when the icon geometry changes
```
