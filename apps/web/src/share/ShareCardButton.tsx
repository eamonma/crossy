// The Share card button: the completion overlay's action row and the Analysis header
// both mount this. It holds only plain input data; the heavy end (six inlined fonts,
// the SVG builder, canvas) lives in shareCardExport.ts behind the dynamic import below,
// so the main bundle never pays for a card nobody exports. Callers render it only once
// the analysis bundle is ready (useGameAnalysis "ready"), so the input is always whole.
import { useEffect, useState } from "react";
import { CheckIcon, Share2Icon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import type { ShareCardInput } from "./shareCardData";

export function ShareCardButton({
  input,
  size = "lg",
}: {
  input: ShareCardInput;
  size?: "sm" | "lg";
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(id);
  }, [done]);

  async function run(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const mod = await import("./shareCardExport");
      const outcome = await mod.shareCompletionCard(input);
      // The brief check marks a card that left the building (sheet or download);
      // a canceled sheet or a failure just returns the button to rest, no scolding.
      setDone(outcome === "shared" || outcome === "downloaded");
    } catch {
      setDone(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="secondary"
      size={size}
      onClick={() => void run()}
      disabled={busy}
    >
      {done ? <CheckIcon /> : <Share2Icon />}
      Share card
    </Button>
  );
}
