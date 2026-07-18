// The share card's export adapter: the ONLY module that carries the card fonts (six
// woff2 files inlined as data URIs) and touches the DOM, loaded via dynamic import from
// the Share button so none of it weighs the main bundle. The pure work happens in
// shareCardData.ts (assembly, tested), @crossy/share-card (the SVG, tested), and
// shareChannel.ts (the channel decision, tested); this file is the thin browser rim —
// rasterize, then share, copy, or download — and is deliberately left untested: canvas,
// navigator.share, and the clipboard do not exist under the node test environment, and
// everything decision-shaped lives on the pure side of the seam.
import { completionCardSvg } from "@crossy/share-card";
import {
  assembleShareCard,
  groundFromTheme,
  type ShareCardInput,
} from "./shareCardData";
import { selectShareChannel } from "./shareChannel";
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

export type ShareOutcome =
  "shared" | "copied" | "downloaded" | "canceled" | "failed";

/**
 * Build, rasterize, and hand off the card. The ground follows the active theme
 * (data-theme on <html>, the useTheme stamp) at the moment of the tap. The card takes
 * the first channel the platform offers (SHARE.md): navigator.share where it genuinely
 * takes files, else a clipboard image copy, else a download. (The original brief barred
 * clipboard image writes; user direction supersedes that, and the clipboard is now the
 * desktop default when a real share sheet is absent.)
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

  // Start the rasterize but hold the pending promise: the clipboard channel must
  // construct its ClipboardItem synchronously inside the user gesture and hand it the
  // UNSETTLED blob promise. Awaiting the raster first and then constructing the item
  // throws NotAllowedError in Safari (SHARE.md). The share and download channels may
  // await the blob first, as before.
  const pngPromise = rasterize(svg, width, height, EXPORT_SCALE);

  const channel = selectShareChannel({
    canShareFiles: canShareFiles(filename),
    canWriteClipboardImage: canWriteClipboardImage(),
  });

  if (channel === "share") {
    let png: Blob;
    try {
      png = await pngPromise;
    } catch {
      return "failed";
    }
    const file = new File([png], filename, { type: "image/png" });
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
    return downloadCard(pngPromise, filename);
  }

  if (channel === "copy") {
    // Pass the pending promise straight into the ClipboardItem (Safari, above).
    if (await writeClipboardImage(pngPromise)) return "copied";
    // A clipboard write that throws (permission, flake) falls through to the download.
  }

  return downloadCard(pngPromise, filename);
}

/** True when navigator can hand the platform a PNG file. Probes canShare with an empty
 * placeholder of the real type: canShare inspects the file kind, not its bytes, so the
 * answer lands without waiting on the rasterize (which the clipboard path must not do). */
function canShareFiles(filename: string): boolean {
  if (
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function"
  ) {
    return false;
  }
  const probe = new File([], filename, { type: "image/png" });
  return navigator.canShare({ files: [probe] });
}

/** True when the clipboard can take an image/png ClipboardItem (SHARE.md support test). */
function canWriteClipboardImage(): boolean {
  return (
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined" &&
    ((
      ClipboardItem as {
        supports?: (type: string) => boolean;
      }
    ).supports?.("image/png") ??
      true)
  );
}

/** Copy the card to the clipboard. The ClipboardItem is constructed synchronously with
 * the PENDING blob promise (Safari, above); a permission or flake resolves false so the
 * caller falls to the download floor. */
async function writeClipboardImage(
  pngPromise: Promise<Blob>,
): Promise<boolean> {
  try {
    const item = new ClipboardItem({ "image/png": pngPromise });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

/** Await the raster and download it; the floor channel. A raster failure is the only
 * "failed" outcome by the time we reach here. */
async function downloadCard(
  pngPromise: Promise<Blob>,
  filename: string,
): Promise<ShareOutcome> {
  let png: Blob;
  try {
    png = await pngPromise;
  } catch {
    return "failed";
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
