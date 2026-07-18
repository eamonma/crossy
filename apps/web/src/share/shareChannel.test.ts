// The share card's channel decision (SHARE.md channel order): share sheet first where it
// genuinely takes files, else copy the image to the clipboard, else download. Pure and
// capability-injected so the whole decision is testable off the DOM seam.
import { describe, expect, it } from "vitest";
import { selectShareChannel } from "./shareChannel";

describe("selectShareChannel (SHARE.md channel order)", () => {
  it("prefers the share sheet when the platform can share files", () => {
    expect(
      selectShareChannel({ canShareFiles: true, canWriteClipboardImage: true }),
    ).toBe("share");
    expect(
      selectShareChannel({
        canShareFiles: true,
        canWriteClipboardImage: false,
      }),
    ).toBe("share");
  });

  it("copies the image when share is unavailable but the clipboard takes PNGs", () => {
    expect(
      selectShareChannel({
        canShareFiles: false,
        canWriteClipboardImage: true,
      }),
    ).toBe("copy");
  });

  it("falls to download when neither share nor clipboard is available", () => {
    expect(
      selectShareChannel({
        canShareFiles: false,
        canWriteClipboardImage: false,
      }),
    ).toBe("download");
  });
});
