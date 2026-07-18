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
  // rest | sent (a quiet check, label unchanged) | copied (check + "Copied", so the user
  // knows the image went to the clipboard, not a file). Mirrors CopyButton's beat.
  const [feedback, setFeedback] = useState<"rest" | "sent" | "copied">("rest");

  useEffect(() => {
    if (feedback === "rest") return;
    const id = window.setTimeout(() => setFeedback("rest"), 1600);
    return () => window.clearTimeout(id);
  }, [feedback]);

  async function run(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const mod = await import("./shareCardExport");
      const outcome = await mod.shareCompletionCard(input);
      // A copy tells the user where the image went; a shared sheet or a download keeps the
      // quiet check with the unchanged label; a canceled sheet or a failure returns the
      // button to rest, no scolding.
      if (outcome === "copied") setFeedback("copied");
      else if (outcome === "shared" || outcome === "downloaded")
        setFeedback("sent");
      else setFeedback("rest");
    } catch {
      setFeedback("rest");
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
      {feedback === "rest" ? <Share2Icon /> : <CheckIcon />}
      {feedback === "copied" ? "Copied" : "Share card"}
    </Button>
  );
}
