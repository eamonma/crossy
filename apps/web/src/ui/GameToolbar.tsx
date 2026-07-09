// The game toolbar: back, puzzle title, the room's mono timer, who is here, theme, and share.
// One row, mobile-first: the title truncates before anything else is dropped, the timer stays
// on tabular numerals so it never reflows. Share is a popover with the invite link and a copy
// button (the v2 pattern), reusing the panel-over-panel overlay recipe.
import { useEffect, useState } from "react";
import {
  ChevronLeftIcon,
  CheckIcon,
  CopyIcon,
  Link2Icon,
} from "@radix-ui/react-icons";
import { AvatarStack, Button, IconButton, Popover, cx } from "./primitives";
import type { StackMember } from "./primitives";
import { ThemeToggle } from "./TopBar";

function SharePopover({ shareUrl }: { shareUrl: string | null }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy(): Promise<void> {
    if (shareUrl === null) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Popover
      align="end"
      width="20rem"
      trigger={() => (
        <Button variant="soft" size="sm">
          <Link2Icon />
          <span className="hidden sm:inline">Share</span>
        </Button>
      )}
    >
      {() => (
        <div className="flex flex-col gap-3">
          <p className="text-2 text-text-muted">
            Anyone with this link can join to watch, then tap once to solve.
          </p>
          {shareUrl === null ? (
            <p className="text-2 text-text-subtle">
              Open this game from its invite link to share it onward.
            </p>
          ) : (
            <>
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full h-9 px-3 rounded-3 bg-sand-2 border border-border font-mono text-1 text-text"
              />
              <div className="flex justify-end">
                <Button variant="solid" size="sm" onClick={() => void copy()}>
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

export function GameToolbar({
  title,
  timer,
  members,
  shareUrl,
  onBack,
}: {
  title: string;
  timer: string;
  members: readonly StackMember[];
  shareUrl: string | null;
  onBack: () => void;
}) {
  return (
    <header
      className={cx(
        "flex items-center gap-2 h-14 px-2 sm:px-4",
        "bg-panel border-b border-border",
      )}
    >
      <IconButton
        variant="ghost"
        size="md"
        onClick={onBack}
        aria-label="Back to start"
      >
        <ChevronLeftIcon />
      </IconButton>

      <div className="flex items-baseline gap-3 min-w-0 flex-1">
        <span className="truncate font-display text-5 font-medium text-text">
          {title}
        </span>
        <span
          className="shrink-0 font-mono text-3 text-text-muted tabular-nums"
          aria-label="Elapsed time"
        >
          {timer}
        </span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {members.length > 0 && <AvatarStack members={members} />}
        <ThemeToggle />
        <SharePopover shareUrl={shareUrl} />
      </div>
    </header>
  );
}
