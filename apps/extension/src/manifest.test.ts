// Chrome hard-rejects an MV3 manifest carrying `background.scripts` ("requires
// manifest version of 2 or lower", owner-observed on a real load 2026-07-12).
// Firefox needs exactly that key and gets it from the build:firefox transform
// (scripts/build-firefox.mjs), never from the committed manifest.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toFirefoxManifest } from "./firefox-manifest";

const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../public/manifest.json", import.meta.url)),
    "utf8",
  ),
) as {
  key: unknown;
  background: unknown;
  icons: unknown;
  action: { default_icon: unknown };
  content_scripts: ReadonlyArray<{
    matches: readonly string[];
    js: readonly string[];
    all_frames?: boolean;
    run_at?: string;
  }>;
};

describe("manifest", () => {
  it("keeps the Chrome-loadable MV3 background form, service worker only", () => {
    expect(manifest.background).toEqual({ service_worker: "background.js" });
  });

  it("keeps pill surfaces top-level: only the AmuseLabs frame adapter runs all_frames (D22)", () => {
    const byEntry = new Map(manifest.content_scripts.map((s) => [s.js[0], s]));
    expect(byEntry.get("content.js")?.all_frames).toBeUndefined();
    expect(byEntry.get("nyt/content.js")?.all_frames).toBeUndefined();
    expect(byEntry.get("amuselabs/content.js")?.all_frames).toBe(true);
  });

  it("matches the crossy.party web-signal script to the real host only, at document_idle", () => {
    const byEntry = new Map(manifest.content_scripts.map((s) => [s.js[0], s]));
    const entry = byEntry.get("web-signal/content.js");
    // The apex host only: the web app serves crossy.party, never www (settings.ts
    // WEB_ORIGIN). A wildcard host would over-grant for no gain.
    expect(entry?.matches).toEqual(["https://crossy.party/*"]);
    expect(entry?.run_at).toBe("document_idle");
    expect(entry?.all_frames).toBeUndefined();
  });

  it("commits the Chrome dev-id key; the Firefox transform strips it (owner warning)", () => {
    // Chrome derives the unpacked dev id from `key`; Firefox flags it and warns.
    expect(typeof manifest.key).toBe("string");
    const firefox = toFirefoxManifest(manifest as Record<string, unknown>);
    expect(firefox["key"]).toBeUndefined();
    // Firefox still needs the background as `scripts`, not a service worker.
    expect(firefox["background"]).toEqual({ scripts: ["background.js"] });
    // The transform must not mutate the Chrome manifest it reads from.
    expect(typeof manifest.key).toBe("string");
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
