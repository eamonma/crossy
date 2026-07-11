#!/usr/bin/env python3
"""Generator for the Crossy social preview (Open Graph) image, 1200x630.

The image is the Crossy identity end to end: the CROSSY crossword mark (the same
crop-medium grid as the app icon, six open cells spelling CROSSY with the gold Y)
set as a full-bleed panel on the left, and the serif "Crossy" wordmark with a one
line tagline on the right, on the bone ground. Letterforms are geometric paths, no
fonts, so it rasterizes identically anywhere (the wordmark keys on a system serif
so qlmanage needs no Typekit).

Run `python3 og.py` to (re)write og.svg next to this file, then `./og.render.sh`
(or the command it prints) to rasterize og.svg into og.png at exactly 1200x630.

The SVG canvas is a 1200x1200 SQUARE: the 1200x630 design lives in the top band,
bone fills the rest. This is deliberate. macOS `qlmanage` (the only rasterizer
here) renders a non-square viewBox with the wrong vertical scale, but a square
one renders 1:1, so the render script crops the top 1200x630 back out.

Pure stdlib. Palette and letterforms are lifted from
docs/design/logo/app-icon/generate.py so the two marks stay one identity.
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))

W, H = 1200, 630
CANVAS = 1200  # square SVG canvas; the design occupies the top W x H band.

GROUND = "#F2F1EC"  # bone (ink-on-bone light)
INK = "#1D1B18"
GOLD = "#978365"

# The mark panel: a square crop of the CROSSY grid, bled off the left edge.
PANEL = 630            # full-height square panel on the left
CELL = PANEL / 4       # crop-medium reads a 5x5 grid with a half-cell ring, so
                       # visible = (5-2)*CELL + 2*0.5*CELL = 4*CELL = PANEL.
FRAC = 0.5             # outer ring cut at 50%
GX0 = -FRAC * CELL     # grid origin so the ring slices mid-cell on every side
GY0 = -FRAC * CELL

# crop-medium core placed at cell offset (1,1) inside a 5x5 grid.
CORE = {(0, 0): "C", (1, 0): "R", (0, 1): "O", (2, 1): "S", (1, 2): "S", (2, 2): "Y"}
CORE_BLOCKS = {(2, 0), (1, 1), (0, 2)}
GOLD_CORE = (2, 2)
CORE_OFF = (1, 1)
# extra blocks = symmetric partners of the crop-medium seeds, matching generate.py.
EXTRA_BLOCKS = {(1, 0), (0, 1), (3, 0), (1, 4), (4, 3), (3, 4)}


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


def glyph(name, size, t):
    """Geometric letterform, centered on the origin. Ported from the app-icon
    generator so the grid letters here are the same shapes as on the icon."""
    hh = (size - t) / 2
    ww = (0.72 * size - t) / 2
    f = fmt
    if name == "O":
        r = hh
        return f"M {f(-r)} 0 A {f(r)} {f(r)} 0 1 0 {f(r)} 0 A {f(r)} {f(r)} 0 1 0 {f(-r)} 0"
    if name == "C":
        r = hh
        x, y = 0.766 * r, 0.643 * r
        return f"M {f(x)} {f(-y)} A {f(r)} {f(r)} 0 1 0 {f(x)} {f(y)}"
    if name == "R":
        rb = hh / 2
        return (f"M {f(-ww)} {f(hh)} L {f(-ww)} {f(-hh)} L {f(ww - rb)} {f(-hh)} "
                f"A {f(rb)} {f(rb)} 0 0 1 {f(ww - rb)} 0 L {f(-ww)} 0 "
                f"M {f(ww - rb)} 0 L {f(ww)} {f(hh)}")
    if name == "S":
        rs = hh / 2
        k = 1.35
        xs = 0.866 * k * rs
        return (f"M {f(xs)} {f(-1.5 * rs)} A {f(k * rs)} {f(rs)} 0 1 0 0 0 "
                f"A {f(k * rs)} {f(rs)} 0 1 1 {f(-xs)} {f(1.5 * rs)}")
    if name == "Y":
        hw = 0.28 * size
        return f"M {f(-hw)} {f(-hh)} L 0 0 L {f(hw)} {f(-hh)} M 0 0 L 0 {f(hh)}"
    raise ValueError(name)


def cell_xy(c, r):
    return GX0 + c * CELL, GY0 + r * CELL


def build_svg():
    ox, oy = CORE_OFF
    letters = {(ox + c, oy + r): ch for (c, r), ch in CORE.items()}
    blocks = {(ox + c, oy + r) for (c, r) in CORE_BLOCKS} | set(EXTRA_BLOCKS)
    gold = (ox + GOLD_CORE[0], oy + GOLD_CORE[1])

    read = "".join(letters[cr] for cr in sorted(letters, key=lambda p: (p[1], p[0])))
    assert read == "CROSSY", f"grid reads {read}"
    assert letters[gold] == "Y", "gold is not on the Y"
    assert not (set(letters) & blocks), "a letter landed on a block"

    sep = max(6.0, CELL * 0.045)  # grid line weight, same ratio as the icon
    p = []
    p.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" '
             f'height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">')
    p.append(f'  <!-- Crossy social preview (Open Graph), {W}x{H} design in the top '
             f'band of a {CANVAS}x{CANVAS} square canvas (qlmanage renders squares '
             f'1:1; the render script crops the top {W}x{H}). CROSSY crossword mark '
             f'(crop-medium, gold Y) left, serif wordmark + tagline right, on the bone '
             f'ground. Regenerate: python3 og.py && ./og.render.sh -->')
    p.append(f'  <rect width="{CANVAS}" height="{CANVAS}" fill="{GROUND}"/>')

    # Left panel: the crossword mark, clipped to the square that bleeds off the left.
    p.append(f'  <defs><clipPath id="panel"><rect x="0" y="0" width="{PANEL}" '
             f'height="{PANEL}"/></clipPath></defs>')
    p.append('  <g clip-path="url(#panel)">')
    # gold cell first (it sits under the grid lines)
    gx, gy = cell_xy(*gold)
    p.append(f'    <rect x="{fmt(gx)}" y="{fmt(gy)}" width="{fmt(CELL)}" '
             f'height="{fmt(CELL)}" fill="{GOLD}"/>')
    for (c, r) in sorted(blocks):
        x, y = cell_xy(c, r)
        p.append(f'    <rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(CELL)}" '
                 f'height="{fmt(CELL)}" fill="{INK}"/>')
    # grid lines run past the frame so the puzzle reads as continuing
    x0, y0 = cell_xy(0, 0)
    for i in range(6):
        p.append(f'    <line x1="{fmt(x0 + i * CELL)}" y1="{fmt(y0 - CELL)}" '
                 f'x2="{fmt(x0 + i * CELL)}" y2="{fmt(y0 + 5 * CELL)}" '
                 f'stroke="{INK}" stroke-width="{fmt(sep)}"/>')
        p.append(f'    <line x1="{fmt(x0 - CELL)}" y1="{fmt(y0 + i * CELL)}" '
                 f'x2="{fmt(x0 + 5 * CELL)}" y2="{fmt(y0 + i * CELL)}" '
                 f'stroke="{INK}" stroke-width="{fmt(sep)}"/>')
    gsize = 0.54 * CELL
    gt = 0.19 * gsize
    for (c, r), ch in letters.items():
        x, y = cell_xy(c, r)
        p.append(f'    <path d="{glyph(ch, gsize, gt)}" '
                 f'transform="translate({fmt(x + CELL / 2)} {fmt(y + CELL / 2)})" '
                 f'fill="none" stroke="{INK}" stroke-width="{fmt(gt)}" '
                 f'stroke-linecap="round" stroke-linejoin="round"/>')
    p.append('  </g>')

    # Hairline seam between the panel and the ground.
    p.append(f'  <line x1="{PANEL}" y1="0" x2="{PANEL}" y2="{H}" '
             f'stroke="{INK}" stroke-opacity="0.08" stroke-width="1"/>')

    # Right side: serif wordmark over the tagline. Text baselines are hand-placed;
    # tx / sizes are tuned so both lines clear the right edge with a comfortable
    # margin under the display serif's fallback (Georgia in qlmanage).
    tx = PANEL + 76
    serif = "Newsreader, Georgia, 'Times New Roman', 'Times', serif"
    p.append(f'  <text x="{tx}" y="320" font-family="{serif}" font-size="130" '
             f'font-weight="500" fill="{INK}" '
             f'letter-spacing="-2">Crossy</text>')
    p.append(f'  <text x="{tx + 3}" y="384" font-family="{serif}" font-size="30" '
             f'font-weight="400" fill="{INK}" fill-opacity="0.7" '
             f'letter-spacing="0.2">Solve the crossword together, live.</text>')

    p.append('</svg>')
    return "\n".join(p) + "\n"


def main():
    svg = build_svg()
    with open(os.path.join(HERE, "og.svg"), "w") as fh:
        fh.write(svg)
    print(f"wrote og.svg  ({W}x{H})  grid reads CROSSY, gold on the Y")


if __name__ == "__main__":
    main()
