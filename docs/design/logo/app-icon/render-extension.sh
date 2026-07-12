#!/usr/bin/env bash
# Regenerate the browser-extension icons from the committed SVG source.
#
# Same art as the iOS app icon: the CROSSY crossword (crop-medium), rendered once
# at 1024 and Lanczos-downsampled to the four manifest sizes. The light art serves
# both browser themes; extension manifests carry one icon set, and the bone tile
# holds on light and dark toolbars alike. At 16 the letters recede to texture and
# the block scatter plus the gold cell carry the identity, the favicon's lesson.
#
# Requires macOS `qlmanage` and `python3` + Pillow.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
out="$repo/apps/extension/public/icons"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

qlmanage -t -s 1024 -o "$tmp" "$here/icon-light.svg" >/dev/null 2>&1

python3 - "$tmp" "$out" <<'PY'
import os
import sys
from PIL import Image

tmp, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

im = Image.open(f"{tmp}/icon-light.svg.png").convert("RGBA")
if im.size != (1024, 1024):
    im = im.resize((1024, 1024), Image.LANCZOS)
flat = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
flat.alpha_composite(im)
flat = flat.convert("RGB")

for size in (128, 48, 32, 16):
    flat.resize((size, size), Image.LANCZOS).save(f"{out}/icon-{size}.png")
    print(f"wrote icon-{size}.png")
PY
echo "done"
