// Chrome hard-rejects an MV3 manifest carrying `background.scripts` ("requires
// manifest version of 2 or lower", owner-observed on a real load 2026-07-12).
// Firefox needs exactly that key and gets it from the build:firefox transform
// (scripts/build-firefox.mjs), never from the committed manifest.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../public/manifest.json", import.meta.url)),
    "utf8",
  ),
) as { background: unknown };

describe("manifest", () => {
  it("keeps the Chrome-loadable MV3 background form, service worker only", () => {
    expect(manifest.background).toEqual({ service_worker: "background.js" });
  });
});
