// Server-side rasterization of the completion card (design/post-game/SHARE.md wave S2). The card is
// the pure @crossy/share-card SVG (the og variant, 1200x630, light ground), rendered to PNG by
// resvg. This is the "lift, not a port" the standalone-package rule buys: the identical builder that
// draws the web card draws this one, so the unfurl and the in-app export cannot drift.
//
// Fonts: resvg cannot read woff2 (the format the web bundle inlines), so the faces are vendored as
// committed TTFs beside this module (share/fonts, OFL-licensed, license text alongside them) and
// loaded through resvg's fontFiles option, NOT via an SVG fontCss data URI. loadSystemFonts is off,
// so the render is hermetic and deterministic: it depends only on the committed faces, never on
// whatever the host machine happens to have installed. The face family names are normalized so
// resvg selects them by the CSS families the SVG names ("Newsreader", "Schibsted Grotesk",
// "Geist Mono"); render.test.ts proves the faces are actually used, not silently fallen back to.
//
// INV-6: the SVG comes from ShareCardData, which carries owners, counts, and display metadata only,
// so nothing letter-shaped can enter the raster (SHARE.md "No letters, ever").
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { completionCardSvg } from "@crossy/share-card";
import type { ShareCardData } from "@crossy/share-card";

/** The og unfurl dimensions (SHARE.md layout contract). Exported so a caller can set the OpenGraph
 * og:image:width / og:image:height without re-deriving them. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** The vendored faces the card names (SHARE.md type contract): Newsreader 500 normal + italic,
 * Schibsted Grotesk 400/500/600, Geist Mono 500. Hardcoded (not a directory scan) so the loaded set
 * is exactly the reviewed faces and nothing a stray file could sneak in. */
const FONT_FILES = [
  "Newsreader-500-normal.ttf",
  "Newsreader-500-italic.ttf",
  "SchibstedGrotesk-400-normal.ttf",
  "SchibstedGrotesk-500-normal.ttf",
  "SchibstedGrotesk-600-normal.ttf",
  "GeistMono-500-normal.ttf",
].map((name) => fileURLToPath(new URL(`./fonts/${name}`, import.meta.url)));

/** Rasterize the og completion card for `data` to PNG bytes. Light ground, og layout, 1200x630; the
 * render is font-hermetic (only the vendored faces, no system fonts). Returns a plain Uint8Array (an
 * ArrayBuffer-backed copy) so it drops straight into a Hono response body. */
export function renderShareCardPng(
  data: ShareCardData,
): Uint8Array<ArrayBuffer> {
  const { svg } = completionCardSvg(data, { ground: "light", variant: "og" });
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: "Schibsted Grotesk",
    },
  });
  const png = resvg.render().asPng();
  // Copy into a fresh ArrayBuffer-backed view so the type is Uint8Array<ArrayBuffer> (a Hono body),
  // not the Buffer's ArrayBufferLike backing.
  const bytes = new Uint8Array(png.length);
  bytes.set(png);
  return bytes;
}
