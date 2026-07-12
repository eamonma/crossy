#!/usr/bin/env bash
# Regenerate the browser-extension icons from the committed SVG source.
#
# Same art as the favicon: the 2x2 window on the mark (top-right block on the
# anti-diagonal, bottom-right gold Y cell, grid lines running past the frame),
# owner ruling 2026-07-12 over the full CROSSY crossword, which reads busy at
# toolbar sizes. The favicon SVG is itself emitted by generate.py, so this stays
# single-source: rasterize it once at 1024 and Lanczos-downsample to the four
# manifest sizes. qlmanage renders the light scheme of its media query; one set
# serves both browser themes.
#
# Requires macOS `qlmanage` and `python3` + Pillow.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
out="$repo/apps/extension/public/icons"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

qlmanage -t -s 1024 -o "$tmp" "$repo/apps/web/public/favicon.svg" >/dev/null 2>&1

python3 - "$tmp" "$out" <<'PY'
import os
import sys
from PIL import Image

tmp, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)

im = Image.open(f"{tmp}/favicon.svg.png").convert("RGBA")
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
