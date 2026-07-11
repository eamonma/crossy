#!/usr/bin/env bash
# Regenerate the social preview PNG from the committed SVG source.
#
#   python3 og.py        # code -> og.svg (1200x630, the Crossy identity)
#   ./og.render.sh       # og.svg -> og.png (exactly 1200x630, opaque)
#
# The only rasterizer on this machine is macOS `qlmanage`. It mis-scales a
# non-square viewBox vertically, but renders a SQUARE viewBox 1:1, so og.py emits
# a 1200x1200 square with the 1200x630 design in the top band. `-s 1200` gives a
# 1200x1200 PNG; we crop the top 1200x630, flatten onto the opaque bone ground,
# and save. No resampling of the artwork, so the mark stays crisp.
#
# Requires macOS `qlmanage` and `python3` + Pillow.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

python3 "$here/og.py"
qlmanage -t -s 1200 -o "$tmp" "$here/og.svg" >/dev/null 2>&1

python3 - "$tmp/og.svg.png" "$here/og.png" <<'PY'
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
W, H = 1200, 630
CANVAS = 1200
GROUND = (242, 241, 236)  # #F2F1EC bone, matches the SVG ground

im = Image.open(src).convert("RGBA")
if im.size != (CANVAS, CANVAS):
    im = im.resize((CANVAS, CANVAS), Image.LANCZOS)
crop = im.crop((0, 0, W, H))          # the design band, top of the square
flat = Image.new("RGB", (W, H), GROUND)  # opaque, no alpha
flat.paste(crop, (0, 0), crop)
flat.save(dst)
print(f"wrote og.png  {flat.size}  mode={flat.mode}")
PY
echo "done"
