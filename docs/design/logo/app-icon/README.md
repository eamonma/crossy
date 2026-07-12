# App icon source

The Crossy app icon is the **CROSSY crossword** (`crop-medium`): a full-bleed,
zoomed-in crossword grid whose six open cells spell CROSSY, with one gold cell
(the Y), on the bone (`#F2F1EC`) / Observatory (`#121118`) grounds. The frame
slices mid-cell through the outer ring so the puzzle reads as continuing past the
icon, rather than a floating logo.

The whole icon is **reproducible from code**, in two steps:

```sh
python3 ../generate.py   # the canonical logo generator -> icon-light.svg + icon-dark.svg
./render.sh              # SVG -> light.png, dark.png, tinted.png (into AppIcon.appiconset)
```

- `../generate.py` is the source of truth: the icon shares its crossword core
  with the mark, favicon and web mark (see `../README.md`). It draws the grid
  and the letterforms as geometric paths (no fonts), asserts the six open cells
  read CROSSY with the gold on the Y, that the block scatter is
  180-rotationally symmetric, and that no letter is clipped by the iOS squircle
  mask. It emits a full square (no rounded corners: iOS applies its own mask,
  clipping only empty/block cells, never a letter).
- `icon-light.svg` / `icon-dark.svg` are its output (committed so the vector is
  diffable without running the generator).
- `render.sh` rasterizes the SVGs into the PNGs Xcode's `AppIcon.appiconset`
  requires; `tinted.png` is the grayscale of the dark appearance (iOS applies the
  user's tint).

Requires `python3` + Pillow and macOS `qlmanage`.
