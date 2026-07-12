#!/usr/bin/env python3
"""The Crossy logo, generated. One geometry definition feeds every artifact:

  mark-light.svg / mark-dark.svg              the canonical mark (3x3 core crop)
  wordmark-light.svg / wordmark-dark.svg      Crossy, Harfang Pro outlines
  lockup-horizontal-*.svg / lockup-stacked-*  the canonical logo
  app-icon/icon-light.svg / icon-dark.svg     the CROSSY crossword (crop-medium)
  apps/web/public/favicon.svg                 the 2x2 reduction, scheme-aware

The crossword core is defined once (CORE, CORE_BLOCKS, GOLD_CORE); the app icon
crops wide around it, the mark crops tight to it, the favicon reduces it to its
two signature cells. The wordmark outlines live in wordmark_data.py, written
once by extract_wordmark.py from the project's Adobe Fonts kit. A drift check
asserts the web mark in apps/web/src/ui/primitives.tsx still carries the
canonical geometry.

Pure stdlib. Run `python3 generate.py`; run ./render.sh for the preview PNGs
and app-icon/render.sh when the icon geometry changes.
"""

import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the docs tree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))

# ---------------------------------------------------------------- tokens
GROUND_L = "#F2F1EC"  # Studio ground (bone paper)
GROUND_D = "#121118"  # Observatory ground
INK = "#1D1B18"
BONE = "#EDEAE2"
GOLD = "#978365"  # gold-9, the single accent: the Y's cell

# ------------------------------------------------- the crossword core (3x3)
# Blocks step down the anti-diagonal; the six open cells spell CROSSY row-major;
# the gold cell is the Y. Every artifact below is a crop or reduction of this.
CORE = {(0, 0): "C", (1, 0): "R", (0, 1): "O", (2, 1): "S", (1, 2): "S", (2, 2): "Y"}
CORE_BLOCKS = {(2, 0), (1, 1), (0, 2)}
GOLD_CORE = (2, 2)


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


def fmt3(v):
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return s if s else "0"


# ==========================================================================
# App icon: crop-medium. A 5x5 grid around the core; the frame slices the
# outer ring mid-cell so the puzzle reads as continuing past the icon.
# Letterforms are drawn geometric paths, no fonts. iOS applies its own
# squircle mask, so the emitted SVG is a full square.
# ==========================================================================

CANVAS = 1024
MASK_R = 230   # iOS squircle stand-in, used only to verify letter clearance
ICON_R = 0     # emitted SVG is a full square; iOS applies its own mask


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


def render_icon(g, dark, comment):
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
ICON_N = 5
ICON_S, ICON_GX, ICON_GY = geom(5, 0.50)
ICON_CORE_OFF = (1, 1)
ICON_EXTRA_BLOCKS = make_symmetric(5, ICON_CORE_OFF, [(0, 1), (3, 0)])


def emit_app_icon():
    g = CropGrid(ICON_N, ICON_S, ICON_GX, ICON_GY, ICON_CORE_OFF, ICON_EXTRA_BLOCKS)
    read, sym, dens = g.validate()
    edge_cl, corner_cl = g.letter_clearances()
    assert edge_cl > 12 and corner_cl > 8, "a letter would be clipped by the mask"
    comment = (f"Crossy app icon (crop-medium). Anti-diagonal CROSSY core, frame "
               f"slices the outer ring mid-cell; {ICON_N}x{ICON_N}, cell {ICON_S:.0f}px, block "
               f"density {dens:.2f}, 180-symmetric={sym}. Full square; iOS masks the corners.")
    for dark, fn in [(False, "icon-light.svg"), (True, "icon-dark.svg")]:
        with open(os.path.join(HERE, "app-icon", fn), "w") as fh:
            fh.write(render_icon(g, dark, comment))
    print(f"app-icon: icon-light.svg + icon-dark.svg  read={read} sym={sym} "
          f"dens={dens:.2f} edge_clear={edge_cl:.0f}px corner_clear={corner_cl:.0f}px")


# ==========================================================================
# The canonical mark: the 3x3 core alone, letters retired. Next to the
# wordmark the full CROSSY tile would say the name twice, so the lockup
# carries this fragment: three blocks stepping down the anti-diagonal to
# the one gold cell (the Y's cell). Grid lines run to the frame so the
# puzzle reads as continuing past the crop.
#
# Light: ink blocks and lines on the ground, open cells transparent.
# Dark: the paper glows. Bone plates for the open cells, gold for the Y's
# cell, the ground showing through as blocks and grid lines. Same treatment
# as the app icon and favicon in dark.
# ==========================================================================

MARK_VB = 24      # the mark's native box; the lockup recipe is authored at 24
MARK_CELL = 8
MARK_LINE = 1.25  # grid line weight at 24; also the dark plate gap


def mark_cells():
    """Blocks, gold cell, and open cells of the 3x3, in mark coordinates."""
    blocks = [(c * MARK_CELL, r * MARK_CELL) for (c, r) in sorted(CORE_BLOCKS)]
    gold = (GOLD_CORE[0] * MARK_CELL, GOLD_CORE[1] * MARK_CELL)
    opens = [(c * MARK_CELL, r * MARK_CELL)
             for (c, r) in sorted(CORE) if (c, r) != GOLD_CORE]
    return blocks, gold, opens


def mark_grid_path():
    v = MARK_VB
    c = MARK_CELL
    return f"M{c} 0v{v}M{2 * c} 0v{v}M0 {c}h{v}M0 {2 * c}h{v}"


def rect_attrs(x, y, w, h):
    a = []
    if x:
        a.append(f'x="{fmt3(x)}"')
    if y:
        a.append(f'y="{fmt3(y)}"')
    a.append(f'width="{fmt3(w)}"')
    a.append(f'height="{fmt3(h)}"')
    return " ".join(a)


def plate_rect(cx, cy):
    """A dark-appearance plate: bleeds to the frame on outer sides, insets by
    half the line weight on interior sides, so the grid gap equals MARK_LINE."""
    h = MARK_LINE / 2
    x0 = cx + (h if cx > 0 else 0)
    y0 = cy + (h if cy > 0 else 0)
    x1 = cx + MARK_CELL - (h if cx + MARK_CELL < MARK_VB else 0)
    y1 = cy + MARK_CELL - (h if cy + MARK_CELL < MARK_VB else 0)
    return x0, y0, x1 - x0, y1 - y0


def mark_elements(dark, ink, bone, gold):
    """The mark's shapes as SVG element strings in the 24 viewBox space."""
    blocks, gold_cell, opens = mark_cells()
    out = []
    if dark:
        for (x, y) in opens:
            out.append(f'<rect {rect_attrs(*plate_rect(x, y))} fill="{bone}"/>')
        out.append(f'<rect {rect_attrs(*plate_rect(*gold_cell))} fill="{gold}"/>')
    else:
        for (x, y) in blocks:
            out.append(f'<rect {rect_attrs(x, y, MARK_CELL, MARK_CELL)} fill="{ink}"/>')
        gx, gy = gold_cell
        out.append(f'<rect {rect_attrs(gx, gy, MARK_CELL, MARK_CELL)} fill="{gold}"/>')
        out.append(f'<path d="{mark_grid_path()}" stroke="{ink}" '
                   f'stroke-width="{fmt3(MARK_LINE)}" fill="none"/>')
    return out


def svg_doc(w, h, body, comment=None):
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt3(w)} {fmt3(h)}">']
    if comment:
        lines.append(f"  <!-- {comment} -->")
    lines += [f"  {el}" for el in body]
    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def emit_mark():
    for dark, fn in [(False, "mark-light.svg"), (True, "mark-dark.svg")]:
        comment = ("The Crossy mark: the 3x3 core of the CROSSY crossword, letters "
                   "retired. " + ("Dark: bone plates on the Observatory ground, which "
                                  "shows through as blocks and grid lines."
                                  if dark else
                                  "Light: ink blocks and grid lines, the gold Y cell, "
                                  "open cells transparent."))
        with open(os.path.join(HERE, fn), "w") as fh:
            fh.write(svg_doc(MARK_VB, MARK_VB, mark_elements(dark, INK, BONE, GOLD),
                             comment))
    print("mark: mark-light.svg + mark-dark.svg")


# ==========================================================================
# Favicon: the 16px reduction. The 3x3 dies below ~20px, so the favicon
# keeps the mark's two signature corner cells at 2x2: the top-right block
# and the bottom-right gold cell, the left column open. Grid lines run to
# the frame. Scheme-aware: the favicon cannot see the app's data-theme, so
# it keys on prefers-color-scheme; dark uses the same plate treatment as
# the mark and the app icon.
# ==========================================================================

def emit_favicon():
    path = os.path.join(REPO, "apps", "web", "public", "favicon.svg")
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <!-- The Crossy mark reduced for 16px: a 2x2 window keeping the mark's two
       signature corner cells, the top-right block (on the anti-diagonal, as in
       the mark) and the bottom-right gold cell (the Y). Grid lines run to the
       frame so the puzzle reads as continuing past it. Light mirrors the mark
       (ink on bone); dark mirrors it too (bone plates on Observatory, the
       ground showing through as the grid line). Emitted by
       docs/design/logo/generate.py; edit the generator, not this file. -->
  <style>
    .ground {{ fill: {GROUND_L}; }}
    .open {{ fill: {GROUND_L}; }}
    .block {{ fill: {INK}; }}
    .line {{ stroke: {INK}; }}
    @media (prefers-color-scheme: dark) {{
      .ground {{ fill: {GROUND_D}; }}
      .open {{ fill: {BONE}; }}
      .block {{ fill: {GROUND_D}; }}
      .line {{ stroke: {GROUND_D}; }}
    }}
  </style>
  <rect class="ground" width="32" height="32"/>
  <rect class="open" width="16" height="16"/>
  <rect class="open" y="16" width="16" height="16"/>
  <rect class="block" x="16" width="16" height="16"/>
  <rect x="16" y="16" width="16" height="16" fill="{GOLD}"/>
  <path class="line" d="M16 0v32M0 16h32" stroke-width="2" fill="none"/>
</svg>
"""
    with open(path, "w") as fh:
        fh.write(svg)
    print(f"favicon: {os.path.relpath(path, REPO)}")


# ==========================================================================
# Wordmark: Crossy in Harfang Pro (normal 600), outlined to paths so the
# lockup renders identically everywhere; live text through Typekit is
# render-unstable and falls back when the kit does not load. The outlines,
# advances and GPOS kerning live in wordmark_data.py, extracted once from
# the project's own Adobe Fonts kit by extract_wordmark.py. Tracked
# -0.00625em, exactly the live recipe.
# ==========================================================================

import wordmark_data as wd

TYPE_SIZE = 18                      # the lockup recipe: type 18 next to mark 24
TRACKING = -0.00625 * TYPE_SIZE     # CSS letter-spacing, applied between letters
LOCKUP_GAP = 6                      # mark box to type origin (horizontal),
                                    # mark bottom to cap top (stacked)


class Wordmark:
    """Glyph layout for wordmark_data at TYPE_SIZE, in lockup coordinates.

    Vertical recipe: the live lockup center-aligns the mark box (24) and the
    text box (18, leading-none). With Harfang's metrics (ascent 947, descent
    275, upem 1000) the browser places the baseline at
    (24 - 18) / 2 + 18 * (947 - (947 + 275 - 1000) / 2) / 1000 = 18.048
    below the top of the mark box. The SVG bakes that in.
    """

    def __init__(self):
        self.scale = TYPE_SIZE / wd.UPEM
        half_leading = (wd.UPEM - (wd.ASCENT - wd.DESCENT + wd.LINE_GAP)) / 2
        self.baseline = ((MARK_VB - TYPE_SIZE) / 2
                         + (half_leading + wd.ASCENT) * self.scale)
        self.cap = wd.CAP_HEIGHT * self.scale
        self.glyphs = []   # (path d in font units, pen x in px)
        pen_x = 0.0
        ink_lo, ink_hi, ink_top, ink_bot = 1e9, -1e9, -1e9, 1e9
        for i, (ch, adv, kern, bounds, d) in enumerate(wd.GLYPHS):
            self.glyphs.append((d, pen_x))
            x0, y0, x1, y1 = bounds
            ink_lo = min(ink_lo, pen_x + x0 * self.scale)
            ink_hi = max(ink_hi, pen_x + x1 * self.scale)
            ink_top = max(ink_top, y1 * self.scale)
            ink_bot = min(ink_bot, y0 * self.scale)
            pen_x += adv * self.scale
            if i < len(wd.GLYPHS) - 1:
                pen_x += kern * self.scale + TRACKING
        self.advance = pen_x
        self.ink_lo, self.ink_hi = ink_lo, ink_hi      # x, relative to pen 0
        self.ink_top, self.ink_bot = ink_top, ink_bot  # y, relative to baseline

    def elements(self, color, dx=0.0, baseline=None):
        base = self.baseline if baseline is None else baseline
        s = fmt3(self.scale)
        out = [f'<g fill="{color}">']
        for d, pen_x in self.glyphs:
            out.append(f'  <path transform="translate({fmt3(dx + pen_x)} {fmt3(base)}) '
                       f'scale({s} -{s})" d="{d}"/>')
        out.append("</g>")
        return out


def emit_wordmark(wm):
    for dark, fn in [(False, "wordmark-light.svg"), (True, "wordmark-dark.svg")]:
        color = BONE if dark else INK
        comment = (f"Crossy, {wd.FONT} ({wd.VERSION}) outlined; GPOS-kerned, tracked "
                   f"-0.00625em. Authored in the lockup band: 24 tall, baseline "
                   f"{fmt3(wm.baseline)}. Emitted by generate.py.")
        with open(os.path.join(HERE, fn), "w") as fh:
            fh.write(svg_doc(wm.advance, MARK_VB, wm.elements(color), comment))
    print(f"wordmark: wordmark-light.svg + wordmark-dark.svg  "
          f"advance={wm.advance:.2f} cap={wm.cap:.2f} baseline={wm.baseline:.2f}")


def emit_lockups(wm):
    # Horizontal: mark 24, gap 6 to the type origin, type 18 on baseline 16.23.
    w = MARK_VB + LOCKUP_GAP + wm.advance
    for dark, fn in [(False, "lockup-horizontal-light.svg"),
                     (True, "lockup-horizontal-dark.svg")]:
        ink = BONE if dark else INK
        body = mark_elements(dark, INK, BONE, GOLD) + \
            wm.elements(ink, dx=MARK_VB + LOCKUP_GAP)
        comment = ("The Crossy lockup: mark 24, gap 6, Crossy 18 SemiBold. "
                   "Emitted by generate.py.")
        with open(os.path.join(HERE, fn), "w") as fh:
            fh.write(svg_doc(w, MARK_VB, body, comment))
    # Stacked: mark centered over the word ink, gap 6 from mark bottom to cap top
    # (cap overshoot included, so the optical gap holds).
    ink_w = wm.ink_hi - wm.ink_lo
    baseline = MARK_VB + LOCKUP_GAP + wm.ink_top
    h = baseline - wm.ink_bot
    mark_x = (ink_w - MARK_VB) / 2
    for dark, fn in [(False, "lockup-stacked-light.svg"),
                     (True, "lockup-stacked-dark.svg")]:
        ink = BONE if dark else INK
        body = [f'<g transform="translate({fmt3(mark_x)} 0)">']
        body += [f"  {el}" for el in mark_elements(dark, INK, BONE, GOLD)]
        body.append("</g>")
        body += wm.elements(ink, dx=-wm.ink_lo, baseline=baseline)
        comment = ("The Crossy stacked lockup: mark 24 centered over the word, "
                   "gap 6 to the cap line. Emitted by generate.py.")
        with open(os.path.join(HERE, fn), "w") as fh:
            fh.write(svg_doc(ink_w, h, body, comment))
    print(f"lockups: horizontal {fmt3(w)}x24, stacked {fmt3(ink_w)}x{fmt3(h)}")


# ==========================================================================
# Previews: square compositions on the grounds, sized for qlmanage (which
# renders square viewBoxes 1:1). render.sh rasterizes these to preview/*.png.
# ==========================================================================

PREVIEW_VB = 512


def preview_doc(inner_body, w, h, dark):
    scale = (0.72 * PREVIEW_VB) / w
    if h * scale > 0.5 * PREVIEW_VB:
        scale = (0.5 * PREVIEW_VB) / h
    tx = (PREVIEW_VB - w * scale) / 2
    ty = (PREVIEW_VB - h * scale) / 2
    body = [
        f'<rect width="{PREVIEW_VB}" height="{PREVIEW_VB}" '
        f'fill="{GROUND_D if dark else GROUND_L}"/>',
        f'<g transform="translate({fmt3(tx)} {fmt3(ty)}) scale({fmt3(scale)})">',
    ]
    body += [f"  {el}" for el in inner_body]
    body.append("</g>")
    return svg_doc(PREVIEW_VB, PREVIEW_VB, body)


def emit_previews(wm, outdir):
    os.makedirs(outdir, exist_ok=True)
    w_h = MARK_VB + LOCKUP_GAP + wm.advance
    ink_w = wm.ink_hi - wm.ink_lo
    baseline = MARK_VB + LOCKUP_GAP + wm.ink_top
    h_s = baseline - wm.ink_bot
    mark_x = (ink_w - MARK_VB) / 2
    for dark in (False, True):
        ink = BONE if dark else INK
        horiz = mark_elements(dark, INK, BONE, GOLD) + \
            wm.elements(ink, dx=MARK_VB + LOCKUP_GAP)
        stack = [f'<g transform="translate({fmt3(mark_x)} 0)">']
        stack += [f"  {el}" for el in mark_elements(dark, INK, BONE, GOLD)]
        stack.append("</g>")
        stack += wm.elements(ink, dx=-wm.ink_lo, baseline=baseline)
        mode = "dark" if dark else "light"
        for name, body, w, h in [
            (f"lockup-horizontal-{mode}", horiz, w_h, MARK_VB),
            (f"lockup-stacked-{mode}", stack, ink_w, h_s),
        ]:
            with open(os.path.join(outdir, name + ".svg"), "w") as fh:
                fh.write(preview_doc(body, w, h, dark))
    print(f"previews: 4 SVGs in {outdir}")


# ==========================================================================
# Drift check: the web mark (apps/web/src/ui/primitives.tsx) carries the
# canonical geometry by hand (it is JSX, themed with currentColor and the
# gold token). Assert its numbers still match this generator.
# ==========================================================================

def check_web_mark():
    path = os.path.join(REPO, "apps", "web", "src", "ui", "primitives.tsx")
    with open(path) as fh:
        tsx = " ".join(fh.read().split())  # prettier wraps attributes; flatten
    blocks, gold_cell, opens = mark_cells()
    want = ['viewBox="0 0 24 24"', f'd="{mark_grid_path()}"']
    for (x, y) in blocks:
        want.append(rect_attrs(x, y, MARK_CELL, MARK_CELL).replace(' fill=', ''))
    want.append(rect_attrs(*gold_cell, MARK_CELL, MARK_CELL))
    for (x, y) in opens:
        want.append(rect_attrs(*plate_rect(x, y)))
    want.append(rect_attrs(*plate_rect(*gold_cell)))
    missing = [w for w in want if w not in tsx]
    if missing:
        sys.exit("web mark drifted from canonical geometry; missing in "
                 f"primitives.tsx: {missing}")
    print("web mark: primitives.tsx matches canonical geometry")


def main():
    emit_app_icon()
    emit_mark()
    emit_favicon()
    wm = Wordmark()
    emit_wordmark(wm)
    emit_lockups(wm)
    if len(sys.argv) > 2 and sys.argv[1] == "--previews":
        emit_previews(wm, sys.argv[2])
    check_web_mark()


if __name__ == "__main__":
    main()
