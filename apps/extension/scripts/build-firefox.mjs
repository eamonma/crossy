// Firefox packaging variant. Chrome hard-rejects an MV3 manifest carrying
// `background.scripts` ("'background.scripts' requires manifest version of 2 or
// lower", observed on a real load 2026-07-12), and Firefox runs MV3 backgrounds
// as event pages via `background.scripts`, so one manifest cannot serve both.
// dist/ stays the Chrome form; this copies it to dist-firefox/ with the background
// swapped and the Chrome-only top-level `key` dropped (it pins the Chrome unpacked
// dev id and only makes Firefox log "Reading manifest: Warning processing key").
// These two edits are the canonical, tested transform in src/firefox-manifest.ts;
// this script applies them by hand because it runs as plain node, not bundled TS.
// Run via `pnpm --filter @crossy/extension build:firefox`.
import { cpSync, readFileSync, writeFileSync } from "node:fs";

cpSync("dist", "dist-firefox", { recursive: true });
const path = "dist-firefox/manifest.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));
manifest.background = { scripts: ["background.js"] };
delete manifest.key;
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
