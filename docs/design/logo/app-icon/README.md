---
status: descriptive
---

# App icon source

The Crossy app icon is the **wordless mark at `crop-medium`**: a full-bleed,
zoomed-in crossword grid, three ink blocks stepping down the anti-diagonal to
one gold cell (the Y), on the bone (`#F2F1EC`) / Observatory (`#121118`)
grounds. The six open cells still hold the CROSSY skeleton with its letters
retired; the outer blocks mirror across the main diagonal, so the scatter never
reads as a pinwheel. The frame slices mid-cell through the outer ring so the
puzzle reads as continuing past the icon, rather than a floating logo.

The whole icon is **reproducible from code**, in two steps:

```sh
python3 ../generate.py   # the canonical logo generator -> icon-light.svg + icon-dark.svg
./render.sh              # SVG -> light.png, dark.png, tinted.png (into AppIcon.appiconset)
```

- `../generate.py` is the source of truth: the icon shares its crossword core
  with the mark, favicon and web mark (see `../README.md`). It asserts the six
  open cells still read CROSSY with the gold on the Y and that the block scatter
  is 180-rotationally symmetric. It emits a full square (no rounded corners: iOS
  applies its own mask).
- `icon-light.svg` / `icon-dark.svg` are its output (committed so the vector is
  diffable without running the generator).
- `render.sh` rasterizes the SVGs into the PNGs Xcode's `AppIcon.appiconset`
  requires; `tinted.png` is the grayscale of the dark appearance (iOS applies the
  user's tint).
- `render-extension.sh` rasterizes the same light art into the browser
  extension's manifest icons (`apps/extension/public/icons/`, 16/32/48/128).

Requires `python3` + Pillow and macOS `qlmanage`.
