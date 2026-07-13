// The guest sign-in path (Task M4/Turnstile): rendered by SignInButtons only when the caller
// has confirmed config.guestsEnabled and a Turnstile site key are both set. A tap swaps the button
// for an invisible Turnstile (appearance "interaction-only"): in the common case nothing shows and
// the token arrives on its own, signing the guest in right away, no second tap; the managed box
// only surfaces if Cloudflare forces an interactive challenge. The Identity port's signInGuest has
// no display-name field (types.ts), so a guest stays "Guest" here; naming would be an additive
// change to the port, out of scope for this pass.
import { useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import type { Identity } from "../identity";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "verifying" | "joining";

const REJECTION_COPY: Record<"guests_disabled" | "provider_rejected", string> =
  {
    guests_disabled: "Guest play isn't available right now.",
    provider_rejected: "That didn't go through. Try again in a moment.",
  };

export function GuestSignIn({
  identity,
  siteKey,
  onNotice,
}: {
  identity: Identity;
  siteKey: string;
  onNotice: (message: string | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");

  function onSuccess(token: string): void {
    setPhase("joining");
    void identity.signInGuest({ captchaToken: token }).then((result) => {
      if (!result.ok) {
        onNotice(REJECTION_COPY[result.reason]);
        setPhase("idle");
      }
    });
  }

  function onFailure(): void {
    onNotice("Verification didn't go through. Try again.");
    setPhase("idle");
  }

  if (phase === "idle") {
    return (
      // "Watch": a guest seat is a spectator seat (DESIGN section 8), so the label
      // promises exactly what the click delivers.
      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => {
          onNotice(null);
          setPhase("verifying");
        }}
      >
        Watch as a guest
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 py-1">
      {/* Invisible in the common case: appearance "interaction-only" keeps Cloudflare's managed box
          out of sight, and the token still arrives through onSuccess on its own. The widget only
          surfaces if Cloudflare forces an interactive challenge (rare), so the guest flow no longer
          shows the managed box. onSuccess/onError wiring is unchanged. */}
      <Turnstile
        siteKey={siteKey}
        onSuccess={onSuccess}
        onError={onFailure}
        onExpire={onFailure}
        options={{ size: "compact", appearance: "interaction-only" }}
      />
      <span className="text-1 text-text-subtle">
        {phase === "joining" ? "Joining as a guest..." : "Verifying..."}
      </span>
    </div>
  );
}
