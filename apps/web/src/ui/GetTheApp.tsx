// The "get the app" prompt (iOS only). Crossy's invite links already open the app when it is
// installed (Universal Links); this is the other half — a soft, dismissible nudge for an iPhone
// visitor who does not have it yet, pointing at the external TestFlight beta. It appears only
// when the deploy sets a link (config.testflightUrl), only on iOS, and only until dismissed
// (remembered in localStorage). It never renders on desktop, so it never competes with the
// pointer-first layout, and the router keeps it off the projector and the live board.
import { useState } from "react";
import { ArrowRightIcon, Cross2Icon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import { Logo } from "./primitives";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "crossy.app-prompt.dismissed";

/**
 * The pure show/hide decision, so the platform sniff and the config gate are unit-testable
 * without a DOM. iPadOS 13+ reports a desktop Safari UA on a "MacIntel" platform, so a Mac
 * that reports touch points is treated as iOS too.
 */
export function shouldShowAppPrompt(input: {
  testflightUrl: string | undefined;
  dismissed: boolean;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}): boolean {
  if (input.dismissed) return false;
  if (input.testflightUrl === undefined || input.testflightUrl === "")
    return false;
  const handheldIOS = /iPhone|iPod|iPad/.test(input.userAgent);
  const iPadOS = input.platform === "MacIntel" && input.maxTouchPoints > 1;
  return handheldIOS || iPadOS;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Storage blocked (private mode, cookies off): treat as not dismissed.
    return false;
  }
}

export function GetTheApp({ config }: { config: AppConfig }) {
  const [dismissed, setDismissed] = useState(readDismissed);

  const nav = typeof navigator === "undefined" ? null : navigator;
  const show =
    nav !== null &&
    shouldShowAppPrompt({
      testflightUrl: config.testflightUrl,
      dismissed,
      userAgent: nav.userAgent,
      platform: nav.platform,
      maxTouchPoints: nav.maxTouchPoints,
    });
  if (!show) return null;

  function dismiss(): void {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage blocked: the dismissal holds for this session only, which is fine.
    }
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 px-3 pt-3"
      // Clear the home indicator so the bar never sits under it.
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <div className="relative mx-auto flex max-w-[26rem] items-center gap-3 rounded-3 border border-border-strong bg-panel p-3 pr-10 shadow-lg">
        <Logo size={40} withName={false} />
        <div className="min-w-0 flex-1">
          <div className="text-2 font-semibold text-text">
            Crossy for iPhone
          </div>
          <div className="text-1 text-text-muted">Now in TestFlight beta</div>
        </div>
        <Button asChild variant="default" size="sm">
          <a
            href={config.testflightUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismiss}
          >
            Get it
            <ArrowRightIcon />
          </a>
        </Button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-text-subtle transition-colors hover:bg-sand-4 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <Cross2Icon />
        </button>
      </div>
    </div>
  );
}
