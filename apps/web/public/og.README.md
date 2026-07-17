---
status: descriptive
verified: 133db08
---

# Social preview (Open Graph) image

`og.png` is the card that renders when a `https://crossy.party` link is shared.
It is the Crossy identity: the **CROSSY crossword** mark (the same crop-medium
grid as the app icon, six open cells spelling CROSSY with the gold `Y`, on the
bone `#F2F1EC` ground) on the left, and the serif "Crossy" wordmark over the
tagline "Solve the crossword together, live." on the right.

`index.html` points `og:image` and `twitter:image` at the absolute
`https://crossy.party/og.png` (1200x630). The absolute URL is deliberate: link
unfurlers do not resolve relative paths against the page origin, so the card needs a
fully qualified image URL.

## Reproduce from source

```sh
cd apps/web/public
./og.render.sh        # runs og.py -> og.svg, then rasterizes to og.png (1200x630)
```

- `og.py` is the source of truth: it draws the grid and the CROSSY letterforms as
  geometric paths (palette and glyphs lifted from
  `docs/design/logo/app-icon/generate.py`, so the two marks stay one identity),
  asserts the six open cells read CROSSY with the gold on the `Y`, and writes
  `og.svg`. The wordmark and tagline are set in a system serif (Georgia is the
  fallback the rasterizer resolves), so no Typekit fetch is needed to render.
- `og.svg` is `og.py`'s output, committed so the vector is diffable.
- `og.render.sh` rasterizes it. The only rasterizer on the build machine is macOS
  `qlmanage`, which mis-scales a non-square viewBox but renders a **square** one
  1:1. So `og.py` emits a 1200x1200 square with the 1200x630 design in the top
  band; the script renders that square and crops the top 1200x630, then flattens
  onto the opaque bone ground (no alpha).

Requires macOS `qlmanage` and `python3` + Pillow.

Commit the source (`og.py`, `og.svg`, `og.render.sh`), not just `og.png`.
