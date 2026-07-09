// The game's chrome row, straight from v2's board toolbar: back chevron, the puzzle name as
// a quiet chip, the room's mono timer, a Done chip once solved; on the right, who is here,
// the theme toggle, and Share. One row, no bottom border of its own (the dashed rule under
// the clue strip closes the block). The title truncates before anything else is dropped and
// the timer keeps tabular numerals so it never reflows.
import { useEffect, useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  Share1Icon,
} from "@radix-ui/react-icons";
import { AvatarStack, Badge, Button, IconButton, Popover } from "./primitives";
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
      width="19rem"
      trigger={() => (
        <Button variant="soft" size="sm">
          <Share1Icon />
          <span className="hidden sm:inline">Share</span>
        </Button>
      )}
    >
      {() => (
        <div className="flex flex-col gap-2">
          <p className="text-2 text-text-muted">
            Anyone with this link can join or invite others.
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
                className="field w-full h-8 px-2 font-mono text-1"
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
  done = false,
  members,
  selfId = null,
  shareUrl,
  onBack,
}: {
  title: string;
  timer: string;
  done?: boolean;
  members: readonly StackMember[];
  selfId?: string | null;
  shareUrl: string | null;
  onBack: () => void;
}) {
  return (
    <header className="flex items-center gap-2 px-2 sm:px-3 py-2">
      <IconButton
        variant="ghost"
        size="sm"
        onClick={onBack}
        aria-label="Back to start"
      >
        <ChevronLeftIcon />
      </IconButton>

      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Badge tone="neutral" className="min-w-0">
          <span className="truncate">{title}</span>
        </Badge>
        {done && (
          <Badge tone="green" pill>
            Done
          </Badge>
        )}
        <span
          className="shrink-0 font-mono text-2 text-text-muted tabular-nums"
          aria-label="Elapsed time"
        >
          {timer}
        </span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {members.length > 0 && (
          <AvatarStack members={members} selfId={selfId} />
        )}
        <ThemeToggle />
        <SharePopover shareUrl={shareUrl} />
      </div>
    </header>
  );
}
