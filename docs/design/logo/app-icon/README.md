# App icon source

The Crossy app icon is the **CROSSY crossword** (`crop-medium`): a full-bleed,
zoomed-in crossword grid whose six open cells spell CROSSY, with one gold cell
(the Y), on the bone (`#F2F1EC`) / Observatory (`#121118`) grounds. The frame
slices mid-cell through the outer ring so the puzzle reads as continuing past the
icon, rather than a floating logo.

`icon-light.svg` / `icon-dark.svg` are the **vector source**, drawn as a full
square (no rounded corners: iOS applies its own squircle mask, and clips only
empty and block cells, never a letter). They are the `crop-medium` cut from the
crossword exploration under `docs/design/logo/06-crossword` (on the
`design/logo-crossword` branch), where the SVGs are emitted by a Python generator.

## Regenerate the appiconset PNGs

Xcode's `AppIcon.appiconset` requires PNGs. They are derived from the source above:

```sh
./render.sh   # writes light.png, dark.png, tinted.png into AppIcon.appiconset
```

`tinted.png` is the grayscale of the dark appearance (iOS applies the user's tint).
Requires macOS `qlmanage` and `python3` + Pillow.
