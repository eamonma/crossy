// The Chrome-to-Firefox manifest transform, kept here (not in the build script) so
// manifest.test.ts can pin it as a pure function on a fresh clone, with no build run.
// scripts/build-firefox.mjs applies exactly these two edits; keep the two in step.

/** A manifest as a loose object; the transform touches only two known keys. */
export type ManifestObject = Record<string, unknown>;

/**
 * Two edits. Swap the background to `scripts`: Chrome hard-rejects an MV3 manifest
 * carrying `background.scripts` while Firefox runs MV3 backgrounds as event pages via
 * exactly that key, so one manifest cannot serve both. And drop the top-level `key`:
 * it pins the Chrome unpacked dev id and means nothing to Firefox, which logs "Reading
 * manifest: Warning processing key" and ignores it. The input is not mutated.
 */
export function toFirefoxManifest(
  chromeManifest: ManifestObject,
): ManifestObject {
  const manifest = { ...chromeManifest };
  manifest["background"] = { scripts: ["background.js"] };
  delete manifest["key"];
  return manifest;
}
