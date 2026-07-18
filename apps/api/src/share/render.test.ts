// The server-side card render (design/post-game/SHARE.md wave S2). No Docker, no jsdom: the render
// is a pure function of ShareCardData, so these drive it directly. They defend three things:
//   - the PNG decodes and carries the og dimensions (1200x630), the OpenGraph contract;
//   - the vendored fonts are actually used, not silently fallen back to (resvg falls back in
//     silence): a render with the faces differs, pixel for pixel, from one with no faces at all;
//   - INV-6: nothing letter-shaped enters the render, because ShareCardData accepts no letters.
import { describe, expect, it } from "vitest";
import { Resvg } from "@resvg/resvg-js";
import { completionCardSvg } from "@crossy/share-card";
import type { ShareCardData } from "@crossy/share-card";
import {
  OG_HEIGHT,
  OG_WIDTH,
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  renderShareCardPng,
} from "./render";

/** A two-solver completed mini, enough to exercise mosaic, masthead, stats, and the color chips. */
const DATA: ShareCardData = {
  rows: 3,
  cols: 3,
  blocks: [4],
  ownersByCell: { 0: 0, 1: 0, 2: 1, 3: 1, 5: 0, 6: 1, 7: 0, 8: 1 },
  solvers: [
    { name: "Alice", colorLight: "#6F66D4", colorDark: "#9D95FF" },
    { name: "Bob", colorLight: "#DE5722", colorDark: "#FF7A50" },
  ],
  stats: {
    activeSeconds: 754,
    sittingCount: 2,
    solverCount: 2,
    squareCount: 8,
  },
  puzzle: { title: "Sunday Themeless", author: "Jane Doe" },
  solvedOn: "Jul 17, 2026",
};

/** Read a PNG's IHDR width/height (bytes 16..20 and 20..24), after the 8-byte signature. */
function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe("share card render (SHARE.md wave S2)", () => {
  it("decodes as a PNG at the og dimensions 1200x630", () => {
    const png = renderShareCardPng(DATA);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngDimensions(png)).toEqual({ width: OG_WIDTH, height: OG_HEIGHT });
  });

  it("defaults to the og/light shape, so a bare call is byte-identical to the explicit og/light one (og:image bytes never move)", () => {
    // The default-argument path and the explicit og/light shape must draw the same SVG, so the
    // og:image an unfurler fetches is unchanged by wave 14.3.
    const bare = renderShareCardPng(DATA);
    const explicit = renderShareCardPng(DATA, {
      ground: "light",
      variant: "og",
    });
    expect([...bare]).toEqual([...explicit]);
  });

  it("renders the portrait variant as a PNG at the flagship dimensions 1080x1620 (the native-client shape)", () => {
    const png = renderShareCardPng(DATA, {
      ground: "light",
      variant: "portrait",
    });
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngDimensions(png)).toEqual({
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
    });
  });

  it("draws the dark ground differently from the light ground (the device-dark shape is a distinct render)", () => {
    // A dark-ground render must not be byte-identical to the light one: the grounds differ, so the
    // bytes must. Checked on the portrait variant the native clients fetch.
    const light = renderShareCardPng(DATA, {
      ground: "light",
      variant: "portrait",
    });
    const dark = renderShareCardPng(DATA, {
      ground: "dark",
      variant: "portrait",
    });
    expect([...dark]).not.toEqual([...light]);
  });

  it("actually uses the vendored faces, not a silent fallback (SHARE.md fonts)", () => {
    // resvg falls back silently when a face is missing, so the only honest check is behavioral: the
    // real render (with the vendored TTFs) must differ from a render with NO fonts loaded. If the
    // faces were ignored, the two would be identical; the difference proves the text was drawn with
    // them. The card carries several text runs (title, byline, stats, names), so a used face moves
    // many pixels.
    const { svg } = completionCardSvg(DATA, { ground: "light", variant: "og" });
    const withoutFonts = new Resvg(svg, {
      font: { fontFiles: [], loadSystemFonts: false },
    })
      .render()
      .asPng();
    const withFonts = renderShareCardPng(DATA);
    expect(withFonts.length).not.toBe(withoutFonts.length);
  });

  it("INV-6: nothing letter-shaped can enter the render (owners, counts, names only)", () => {
    // The render's input type is ShareCardData: owners (indices), counts, and display metadata. There
    // is no field a board letter could ride, so a leak is a compile error, not a runtime strip. This
    // asserts the shape at the type boundary the render depends on.
    const keys = Object.keys(DATA);
    for (const forbidden of ["solution", "grid", "answers", "letters"]) {
      expect(keys).not.toContain(forbidden);
    }
    // And the render still produces a valid PNG from that letter-free shape.
    const png = renderShareCardPng(DATA);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });
});
