#!/usr/bin/env python3
"""Generator for the Crossy app icon: the "CROSSY crossword" (crop-medium).

A tighter crop of the anti-diagonal CROSSY core: the icon frame slices through the
outer ring of cells MID-CELL, so partial cells show on all four straight edges and
the grid reads as a cropped-in view of a bigger puzzle. Core (fixed): 3x3, blocks
on the {3,5,7} anti-diagonal, CROSSY in the six open cells (row-major skip-block),
gold on the Y:

    C R #
    O # S
    # S Y

Emits full-square SVGs (no rounded corners: iOS applies its own squircle mask, and
clips only empty/block cells, never a letter). A glyph-clearance check verifies no
letter would be cut by that mask. Letterforms are drawn geometric paths, no fonts.
Derives from the 06-crossword/tile-crop exploration (branch design/logo-crossword).

Pure stdlib. Run `python3 generate.py` to (re)write icon-light.svg / icon-dark.svg
next to this file; then run ./render.sh to rasterize them into the appiconset PNGs.
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))

GROUND_L = "#F2F1EC"
GROUND_D = "#121118"
INK = "#1D1B18"
BONE = "#EDEAE2"
GOLD = "#978365"

CANVAS = 1024
MASK_R = 230   # iOS squircle stand-in, used only to verify letter clearance
ICON_R = 0     # emitted SVG is a full square; iOS applies its own mask

CORE = {(0, 0): "C", (1, 0): "R", (0, 1): "O", (2, 1): "S", (1, 2): "S", (2, 2): "Y"}
CORE_BLOCKS = {(2, 0), (1, 1), (0, 2)}
GOLD_CORE = (2, 2)


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


def glyph(name, H, t):
    hh = (H - t) / 2
    ww = (0.72 * H - t) / 2
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
        hw = 0.28 * H
        return f"M {f(-hw)} {f(-hh)} L 0 0 L {f(hw)} {f(-hh)} M 0 0 L 0 {f(hh)}"
    raise ValueError(name)


class Icon:
    def __init__(self, dark, comment):
        self.dark = dark
        self.ground = GROUND_D if dark else GROUND_L
        self.parts = [
            f"  <!-- {comment} -->",
            f'  <defs><clipPath id="mask"><rect width="{CANVAS}" height="{CANVAS}" '
            f'rx="{ICON_R}"/></clipPath></defs>',
            f'  <rect width="{CANVAS}" height="{CANVAS}" rx="{ICON_R}" fill="{self.ground}"/>',
            '  <g clip-path="url(#mask)">',
        ]
        self._closed = False

    def rect(self, x, y, w, h, fill):
        self.parts.append(f'  <rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" '
                          f'height="{fmt(h)}" fill="{fill}"/>')

    def stroke_path(self, d, tx, ty, color, t):
        self.parts.append(f'  <path d="{d}" transform="translate({fmt(tx)} {fmt(ty)})" '
                          f'fill="none" stroke="{color}" stroke-width="{fmt(t)}" '
                          f'stroke-linecap="round" stroke-linejoin="round"/>')

    def line(self, x1, y1, x2, y2, w, color):
        self.parts.append(f'  <line x1="{fmt(x1)}" y1="{fmt(y1)}" x2="{fmt(x2)}" '
                          f'y2="{fmt(y2)}" stroke="{color}" stroke-width="{fmt(w)}"/>')

    def svg(self):
        if not self._closed:
            self.parts.append("  </g>")
            self._closed = True
        body = "\n".join(self.parts)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" '
                f'height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">\n{body}\n</svg>\n')


class CropGrid:
    """N x N grid, cell size S, origin (gx, gy) that may be negative so the frame
    slices the outer ring mid-cell. Core placed at cell offset (ox, oy)."""

    def __init__(self, n, s, gx, gy, core_off, extra_blocks):
        self.n, self.s, self.gx, self.gy = n, s, gx, gy
        cx, cy = core_off
        self.letters = {(cx + c, cy + r): ch for (c, r), ch in CORE.items()}
        self.blocks = {(cx + c, cy + r) for (c, r) in CORE_BLOCKS} | set(extra_blocks)
        self.gold = (cx + GOLD_CORE[0], cy + GOLD_CORE[1])

    def cell_xy(self, c, r):
        return self.gx + c * self.s, self.gy + r * self.s

    def validate(self):
        assert not (set(self.letters) & self.blocks), "letter on a block"
        read = "".join(self.letters[cr]
                       for cr in sorted(self.letters, key=lambda p: (p[1], p[0])))
        assert read == "CROSSY", f"reads {read}"
        assert self.gold in self.letters and self.letters[self.gold] == "Y"
        n = self.n
        sym = all((n - 1 - c, n - 1 - r) in self.blocks for (c, r) in self.blocks)
        dens = len(self.blocks) / (n * n)
        return read, sym, dens

    def letter_clearances(self):
        """Min distance from any letter glyph bbox to each frame edge and to the
        squircle corner arc (MASK_R). Positive = the letter stays clear."""
        half = 0.32 * self.s
        min_edge = 1e9
        min_corner = 1e9
        for (c, r) in self.letters:
            cx, cy = self.cell_xy(c, r)
            gx0, gy0 = cx + self.s / 2 - half, cy + self.s / 2 - half
            gx1, gy1 = cx + self.s / 2 + half, cy + self.s / 2 + half
            min_edge = min(min_edge, gx0, gy0, CANVAS - gx1, CANVAS - gy1)
            for gx in (gx0, gx1):
                for gy in (gy0, gy1):
                    inx = gx < MASK_R or gx > CANVAS - MASK_R
                    iny = gy < MASK_R or gy > CANVAS - MASK_R
                    if inx and iny:
                        ccx = MASK_R if gx < CANVAS / 2 else CANVAS - MASK_R
                        ccy = MASK_R if gy < CANVAS / 2 else CANVAS - MASK_R
                        d = MASK_R - ((gx - ccx) ** 2 + (gy - ccy) ** 2) ** 0.5
                        min_corner = min(min_corner, d)
        return min_edge, min_corner


def render(g, dark, comment):
    ic = Icon(dark, comment)
    s = g.s
    sep = max(6.0, s * 0.045)
    n = g.n
    if dark:
        for c in range(n):
            for r in range(n):
                if (c, r) in g.blocks:
                    continue
                x, y = g.cell_xy(c, r)
                fill = GOLD if (c, r) == g.gold else BONE
                ic.rect(x + sep / 2, y + sep / 2, s - sep, s - sep, fill)
    else:
        gx, gy = g.cell_xy(*g.gold)
        ic.rect(gx, gy, s, s, GOLD)
        for (c, r) in g.blocks:
            x, y = g.cell_xy(c, r)
            ic.rect(x, y, s, s, INK)
        x0, y0 = g.cell_xy(0, 0)
        for i in range(n + 1):
            ic.line(x0 + i * s, y0 - s, x0 + i * s, y0 + (n + 1) * s, sep, INK)
            ic.line(x0 - s, y0 + i * s, x0 + (n + 1) * s, y0 + i * s, sep, INK)
    H = 0.54 * s
    t = 0.19 * H
    for (c, r), ch in g.letters.items():
        x, y = g.cell_xy(c, r)
        ic.stroke_path(glyph(ch, H, t), x + s / 2, y + s / 2, INK, t)
    return ic.svg()


def make_symmetric(n, core_off, seeds):
    """Block set = core blocks + seeds + all 180 partners, dropping (symmetrically)
    any that would land on a letter. Returns the extras only (beyond core blocks)."""
    cx, cy = core_off
    letters = {(cx + c, cy + r) for (c, r) in
               {(0, 0), (1, 0), (0, 1), (2, 1), (1, 2), (2, 2)}}
    core_b = {(cx + c, cy + r) for (c, r) in CORE_BLOCKS}
    closed = set()
    for (c, r) in set(core_b) | set(seeds):
        closed.add((c, r))
        closed.add((n - 1 - c, n - 1 - r))
    bad = {p for p in closed if p in letters}
    bad |= {(n - 1 - c, n - 1 - r) for (c, r) in bad}
    return sorted((closed - bad) - core_b)


def geom(n, frac):
    """Cell size + symmetric origin so the outer ring cuts at `frac` on all sides:
    visible = (n-2)*S + 2*(1-frac)*S = CANVAS."""
    s = CANVAS / ((n - 2) + 2 * (1 - frac))
    return s, -frac * s, -frac * s


def ascii_view(g):
    rows = []
    for r in range(g.n):
        row = []
        for c in range(g.n):
            row.append(g.letters.get((c, r), "#" if (c, r) in g.blocks else "."))
        rows.append(" ".join(row))
    return "\n".join(rows)


# crop-medium: 5x5, anti-diagonal core centered (offset 1,1), half-cell ring (cut 50%).
N = 5
S, GX, GY = geom(5, 0.50)
CORE_OFF = (1, 1)
EXTRA_BLOCKS = make_symmetric(5, CORE_OFF, [(0, 1), (3, 0)])


def main():
    g = CropGrid(N, S, GX, GY, CORE_OFF, EXTRA_BLOCKS)
    read, sym, dens = g.validate()
    edge_cl, corner_cl = g.letter_clearances()
    assert edge_cl > 12 and corner_cl > 8, "a letter would be clipped by the mask"
    comment = (f"Crossy app icon (crop-medium). Anti-diagonal CROSSY core, frame "
               f"slices the outer ring mid-cell; {N}x{N}, cell {S:.0f}px, block "
               f"density {dens:.2f}, 180-symmetric={sym}. Full square; iOS masks the corners.")
    for dark, fn in [(False, "icon-light.svg"), (True, "icon-dark.svg")]:
        with open(os.path.join(HERE, fn), "w") as fh:
            fh.write(render(g, dark, comment))
    print(f"wrote icon-light.svg + icon-dark.svg  read={read} sym={sym} "
          f"dens={dens:.2f} edge_clear={edge_cl:.0f}px corner_clear={corner_cl:.0f}px")
    print(ascii_view(g))


if __name__ == "__main__":
    main()
