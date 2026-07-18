// The share card's channel decision, pure and capability-injected. Given only what the
// browser can do, it names which of the three hand-off channels the export takes; the
// glue that probes those capabilities and runs the chosen channel stays in
// shareCardExport.ts, thin and untested (canvas and navigator.share do not exist under
// the node test environment, so everything decision-shaped lives here on the pure side
// of the seam and is unit-tested).

export type ShareChannel = "share" | "copy" | "download";

export interface ShareCapabilities {
  /** navigator can hand the platform these files (canShare({files}) passed). */
  canShareFiles: boolean;
  /** navigator.clipboard.write can take an image/png ClipboardItem. */
  canWriteClipboardImage: boolean;
}

/**
 * The channel order (SHARE.md): the native share sheet first where it genuinely takes
 * files, else copy the image to the clipboard, else download. Each capability gates only
 * its own channel, and download is the floor that always answers.
 */
export function selectShareChannel({
  canShareFiles,
  canWriteClipboardImage,
}: ShareCapabilities): ShareChannel {
  if (canShareFiles) return "share";
  if (canWriteClipboardImage) return "copy";
  return "download";
}
