// Chrome hard-rejects an MV3 manifest carrying `background.scripts` ("requires
// manifest version of 2 or lower", owner-observed on a real load 2026-07-12).
// Firefox needs exactly that key and gets it from the build:firefox transform
// (scripts/build-firefox.mjs), never from the committed manifest.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../public/manifest.json", import.meta.url)),
    "utf8",
  ),
) as {
  background: unknown;
  icons: unknown;
  action: { default_icon: unknown };
};

describe("manifest", () => {
  it("keeps the Chrome-loadable MV3 background form, service worker only", () => {
    expect(manifest.background).toEqual({ service_worker: "background.js" });
  });

  it("ships the four icon sizes, committed and rendered from the app-icon source", () => {
    const icons = {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    };
    expect(manifest.icons).toEqual(icons);
    expect(manifest.action.default_icon).toEqual(icons);
    for (const path of Object.values(icons)) {
      expect(
        existsSync(
          fileURLToPath(new URL(`../public/${path}`, import.meta.url)),
        ),
        `${path} must be committed (docs/design/logo/app-icon/render-extension.sh)`,
      ).toBe(true);
    }
  });
});
