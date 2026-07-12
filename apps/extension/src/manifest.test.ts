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
  content_scripts: ReadonlyArray<{
    matches: readonly string[];
    js: readonly string[];
    all_frames?: boolean;
    run_at?: string;
    world?: string;
  }>;
  browser_specific_settings: { gecko: { strict_min_version: string } };
};

const byEntry = new Map(manifest.content_scripts.map((s) => [s.js[0], s]));

describe("manifest", () => {
  it("keeps the Chrome-loadable MV3 background form, service worker only", () => {
    expect(manifest.background).toEqual({ service_worker: "background.js" });
  });

  it("keeps pill surfaces top-level: only the AmuseLabs frame scripts run all_frames (D22)", () => {
    expect(byEntry.get("content.js")?.all_frames).toBeUndefined();
    expect(byEntry.get("nyt/content.js")?.all_frames).toBeUndefined();
    expect(byEntry.get("amuselabs/content.js")?.all_frames).toBe(true);
    expect(byEntry.get("amuselabs/page-capture.js")?.all_frames).toBe(true);
  });

  it("runs the AmuseLabs capture in the MAIN world at document_start, matches shared with the adapter", () => {
    const adapter = byEntry.get("amuselabs/content.js");
    const capture = byEntry.get("amuselabs/page-capture.js");
    expect(capture?.world).toBe("MAIN");
    expect(capture?.run_at).toBe("document_start");
    expect(capture?.matches).toEqual([
      "https://*.amuselabs.com/pmm/crossword*",
      "https://*.amuselabs.com/*/crossword*",
    ]);
    expect(adapter?.matches).toEqual(capture?.matches);
    // The adapter's message listener must predate the page's first JSON.parse,
    // so it starts at document_start too, in its default ISOLATED world.
    expect(adapter?.run_at).toBe("document_start");
    expect(adapter?.world).toBeUndefined();
  });

  it("pins the Firefox floor at 128, where MAIN-world content scripts arrive", () => {
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe(
      "128.0",
    );
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
