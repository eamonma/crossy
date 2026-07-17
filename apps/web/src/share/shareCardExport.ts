// The share card's export adapter: the ONLY module that carries the card fonts (six
// woff2 files inlined as data URIs) and touches the DOM, loaded via dynamic import from
// the Share button so none of it weighs the main bundle. The pure work happens in
// shareCardData.ts (assembly, tested) and @crossy/share-card (the SVG, tested); this
// file is the thin browser rim — rasterize, then share or download — and is deliberately
// left untested: canvas and navigator.share do not exist under the node test
// environment, and everything decision-shaped lives on the pure side of the seam.
import { completionCardSvg } from "@crossy/share-card";
import {
  assembleShareCard,
  groundFromTheme,
  type ShareCardInput,
} from "./shareCardData";
// The card's own faces (SHARE.md type contract): Newsreader 500 (display, plus the
// italic the credits titles wear), Schibsted Grotesk 400/500/600 (names, labels),
// Geist Mono 500 (stat digits). ?inline makes each import a data: URI, so the SVG is
// self-contained and the rasterizer needs no font fetch.
import newsreader500 from "@fontsource/newsreader/files/newsreader-latin-500-normal.woff2?inline";
import newsreader500Italic from "@fontsource/newsreader/files/newsreader-latin-500-italic.woff2?inline";
import schibsted400 from "@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-400-normal.woff2?inline";
import schibsted500 from "@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-500-normal.woff2?inline";
import schibsted600 from "@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-600-normal.woff2?inline";
import geistMono500 from "@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff2?inline";

const face = (
  family: string,
  weight: number,
  style: "normal" | "italic",
  src: string,
): string =>
  `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url(${src}) format('woff2')}`;

const FONT_CSS =
  face("Newsreader", 500, "normal", newsreader500) +
  face("Newsreader", 500, "italic", newsreader500Italic) +
  face("Schibsted Grotesk", 400, "normal", schibsted400) +
  face("Schibsted Grotesk", 500, "normal", schibsted500) +
  face("Schibsted Grotesk", 600, "normal", schibsted600) +
  face("Geist Mono", 500, "normal", geistMono500);

/** Export scale: the card is authored at 1x logical pixels and rendered at 2x. */
const EXPORT_SCALE = 2;

export type ShareOutcome = "shared" | "downloaded" | "canceled" | "failed";

/**
 * Build, rasterize, and hand off the card. The ground follows the active theme
 * (data-theme on <html>, the useTheme stamp) at the moment of the tap. Files go
 * through navigator.share when the platform can share files; otherwise the PNG
 * downloads. No clipboard image writes (the brief's rule; clipboard support for PNGs
 * is too patchy to be the quiet fallback).
 */
export async function shareCompletionCard(
  input: ShareCardInput,
): Promise<ShareOutcome> {
  const ground = groundFromTheme(
    document.documentElement.getAttribute("data-theme"),
  );
  const { data, variant, filename } = assembleShareCard(input, new Date());
  const { svg, width, height } = completionCardSvg(data, {
    ground,
    variant,
    fontCss: FONT_CSS,
  });

  let png: Blob;
  try {
    png = await rasterize(svg, width, height, EXPORT_SCALE);
  } catch {
    return "failed";
  }

  const file = new File([png], filename, { type: "image/png" });
  if (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (err) {
      // The user closed the share sheet: their decision, not a failure, and not a
      // license to surprise them with a download instead.
      if (err instanceof DOMException && err.name === "AbortError") {
        return "canceled";
      }
      // A share-channel failure (NotAllowedError and friends) falls back to the file.
    }
  }
  download(png, filename);
  return "downloaded";
}

/** SVG string -> PNG blob at `scale`x, via Blob -> Image -> canvas. Browser-only. */
async function rasterize(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<Blob> {
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob !== null ? resolve(blob) : reject(new Error("toBlob"))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg decode failed"));
    img.src = url;
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click's navigation has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
