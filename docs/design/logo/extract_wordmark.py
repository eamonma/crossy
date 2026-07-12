#!/usr/bin/env python3
"""Outline the Crossy wordmark from Harfang Pro and write wordmark_data.py.

Harfang Pro is the brand serif, served by the project's Adobe Fonts kit (the
Typekit stylesheet linked in apps/web/index.html). This script fetches that
kit, downloads the normal-600 face (fvd n6, the weight the lockup uses),
outlines the six letters of "Crossy" plus their advances and GPOS kerning,
and writes them as plain path data to wordmark_data.py.

Only the outlines are committed. The font file itself never enters the repo;
Adobe Fonts licensing permits logo artwork made from an active kit, not
redistribution of the font. Rerun this only if the kit or the face changes.

Requires network, fontTools and brotli: pip3 install fonttools brotli
"""

import io
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))

WORD = "Crossy"
FVD = "n6"  # normal 600, the lockup weight
UA = {"User-Agent": "Mozilla/5.0"}


def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req) as r:
        return r.read()


def kit_url():
    with open(os.path.join(REPO, "apps", "web", "index.html")) as fh:
        m = re.search(r'href="(https://use\.typekit\.net/[a-z0-9]+\.css)"', fh.read())
    if not m:
        sys.exit("no Typekit kit link found in apps/web/index.html")
    return m.group(1)


def face_url(css):
    """The harfang-pro woff2 URL for FVD from the kit CSS."""
    for block in css.split("@font-face"):
        if '"harfang-pro"' not in block:
            continue
        m = re.search(r'url\("([^"]+fvd=' + FVD + r'[^"]*)"\)\s*format\("woff2"\)', block)
        if m:
            return m.group(1)
    sys.exit(f"harfang-pro {FVD} not in the kit")


def gpos_kern(font, g1, g2):
    gpos = font["GPOS"].table
    lookups = set()
    for fr in gpos.FeatureList.FeatureRecord:
        if fr.FeatureTag == "kern":
            lookups.update(fr.Feature.LookupListIndex)
    total = 0
    for li in sorted(lookups):
        lk = gpos.LookupList.Lookup[li]
        for st in lk.SubTable:
            typ = lk.LookupType
            if typ == 9:
                st = st.ExtSubTable
                typ = st.LookupType
            if typ != 2:
                continue
            cov = st.Coverage.glyphs
            if g1 not in cov:
                continue
            if st.Format == 1:
                for pvr in st.PairSet[cov.index(g1)].PairValueRecord:
                    if pvr.SecondGlyph == g2 and pvr.Value1:
                        total += getattr(pvr.Value1, "XAdvance", 0)
            elif st.Format == 2:
                c1 = st.ClassDef1.classDefs.get(g1, 0)
                c2 = st.ClassDef2.classDefs.get(g2, 0)
                v = st.Class1Record[c1].Class2Record[c2].Value1
                if v:
                    total += getattr(v, "XAdvance", 0)
    return total


def main():
    try:
        from fontTools.ttLib import TTFont
        from fontTools.pens.boundsPen import BoundsPen
        from fontTools.pens.svgPathPen import SVGPathPen
    except ImportError:
        sys.exit("pip3 install fonttools brotli")

    kit = kit_url()
    css = fetch(kit).decode("utf-8")
    font = TTFont(io.BytesIO(fetch(face_url(css))))

    head, hhea, os2 = font["head"], font["hhea"], font["OS/2"]
    cmap = font.getBestCmap()
    gs = font.getGlyphSet()
    hmtx = font["hmtx"]
    names = [cmap[ord(ch)] for ch in WORD]

    glyphs = []
    for i, (ch, gname) in enumerate(zip(WORD, names)):
        sp = SVGPathPen(gs)
        gs[gname].draw(sp)
        bp = BoundsPen(gs)
        gs[gname].draw(bp)
        kern = gpos_kern(font, gname, names[i + 1]) if i < len(names) - 1 else 0
        glyphs.append((ch, hmtx[gname][0], kern, bp.bounds, sp.getCommands()))

    version = font["name"].getDebugName(5) or ""
    full = font["name"].getDebugName(4) or ""
    out = os.path.join(HERE, "wordmark_data.py")
    with open(out, "w") as fh:
        fh.write('"""Crossy wordmark outlines: Harfang Pro, normal 600 (Typekit fvd n6).\n'
                 "\n"
                 "Written by extract_wordmark.py from the project's Adobe Fonts kit; see\n"
                 "that script for provenance and licensing. Path data is in font units,\n"
                 'y-up; generate.py flips and scales it into the lockup.\n"""\n\n')
        fh.write(f"FONT = {full!r}\n")
        fh.write(f"VERSION = {version!r}\n")
        fh.write(f"KIT = {kit!r}\n")
        fh.write(f"FVD = {FVD!r}\n")
        fh.write(f"WORD = {WORD!r}\n")
        fh.write(f"UPEM = {head.unitsPerEm}\n")
        fh.write(f"ASCENT = {hhea.ascent}\n")
        fh.write(f"DESCENT = {hhea.descent}\n")
        fh.write(f"LINE_GAP = {hhea.lineGap}\n")
        fh.write(f"CAP_HEIGHT = {os2.sCapHeight}\n")
        fh.write(f"X_HEIGHT = {os2.sxHeight}\n\n")
        fh.write("# (char, advance, kern to next, ink bounds (x0 y0 x1 y1), path)\n")
        fh.write("GLYPHS = [\n")
        for ch, adv, kern, bounds, d in glyphs:
            fh.write(f"    ({ch!r}, {adv}, {kern}, {tuple(int(v) for v in bounds)},\n")
            fh.write(f"     {d!r}),\n")
        fh.write("]\n")
    print(f"wrote wordmark_data.py  font={full} v{version} upem={head.unitsPerEm} "
          f"cap={os2.sCapHeight}")


if __name__ == "__main__":
    main()
