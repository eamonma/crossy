#!/usr/bin/env bash
# Regenerate every logo artifact and the reviewer previews.
#
#   generate.py        -> mark, wordmark, lockup SVGs; app-icon SVGs; web favicon
#   this script        -> preview/*.png (the four lockups on their grounds)
#   app-icon/render.sh -> AppIcon.appiconset PNGs; run it only when the icon
#                         geometry actually changes
#
# Requires macOS `qlmanage` and `python3` + Pillow.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

python3 "$here/generate.py" --previews "$tmp"

mkdir -p "$here/preview"
for f in "$tmp"/*.svg; do
  qlmanage -t -s 1024 -o "$tmp" "$f" >/dev/null 2>&1
done

python3 - "$tmp" "$here/preview" <<'PY'
import glob
import os
import sys
from PIL import Image

tmp, out = sys.argv[1], sys.argv[2]
for png in sorted(glob.glob(f"{tmp}/*.svg.png")):
    name = os.path.basename(png).replace(".svg.png", ".png")
    im = Image.open(png).convert("RGBA")
    ground = (18, 17, 24, 255) if "dark" in name else (242, 241, 236, 255)
    flat = Image.new("RGBA", im.size, ground)
    flat.alpha_composite(im)
    flat.convert("RGB").save(os.path.join(out, name))
    print(f"preview/{name}")
PY
echo "done"
