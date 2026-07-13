#!/usr/bin/env bash
# Regenerate the app-icon PNGs from the committed SVG source.
#
# The app icon is the wordless mark at crop-medium: a full-bleed, zoomed-in
# crossword grid, ink blocks stepping down the anti-diagonal to one gold cell
# (the Y), on the bone / Observatory grounds. iOS applies its own squircle
# mask, so the vector source is a full square with no rounded corners.
#
# Requires macOS `qlmanage` and `python3` + Pillow.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
iconset="$repo/apps/ios/Crossy/Crossy/Assets.xcassets/AppIcon.appiconset"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

qlmanage -t -s 1024 -o "$tmp" "$here/icon-light.svg" >/dev/null 2>&1
qlmanage -t -s 1024 -o "$tmp" "$here/icon-dark.svg"  >/dev/null 2>&1

python3 - "$tmp" "$iconset" <<'PY'
import sys
from PIL import Image

tmp, iconset = sys.argv[1], sys.argv[2]

def norm(src, dst):
    im = Image.open(src).convert("RGBA")
    if im.size != (1024, 1024):
        im = im.resize((1024, 1024), Image.LANCZOS)
    flat = Image.new("RGBA", (1024, 1024), (255, 255, 255, 255))
    flat.alpha_composite(im)
    out = flat.convert("RGB")
    out.save(dst)
    return out

norm(f"{tmp}/icon-light.svg.png", f"{iconset}/light.png")
dark = norm(f"{tmp}/icon-dark.svg.png", f"{iconset}/dark.png")
# tinted appearance: grayscale of the dark art; iOS applies the user's tint.
dark.convert("L").convert("RGB").save(f"{iconset}/tinted.png")
print("wrote light.png, dark.png, tinted.png")
PY
echo "done"
