#!/usr/bin/env bash
# Sync the built browser extension into the Crossy app's Safari Web Extension target.
#
# apps/extension is the single source of truth for the extension's behavior, and
# apps/extension/dist is its canonical build output (the Chrome and Firefox zips package
# exactly this same output). The Safari appex bundles that output too, but the iOS build
# must stay node-free so a fresh clone builds the app without the JS toolchain (DESIGN.md
# fresh-clone reproducibility gate). So rather than reference dist live at Xcode build
# time, we commit it under SafariResources/ as a derived cache and regenerate it here.
# CI re-runs this and fails on any drift, so the cache can never diverge from source.
#
# SafariResources/ sits beside the Safari target, deliberately OUTSIDE its synchronized
# folder group: a synchronized group feeds Copy Bundle Resources, which flattens, colliding
# the nested content.js files and breaking the manifest's nyt/content.js paths. The Safari
# target's "Bundle web extension resources" shell-script phase instead ditto-copies this
# tree into the appex with structure intact.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

DEST="apps/ios/Crossy/SafariResources"

pnpm --filter @crossy/extension build

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R apps/extension/dist/. "$DEST/"

echo "Synced apps/extension/dist -> $DEST"
