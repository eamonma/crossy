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
import { AvatarStack } from "./primitives";
import type { StackMember } from "./primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
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
    <Popover>
      <PopoverTrigger asChild>
        {/* 44px-tall hit box on the 24px Share control (hit-target-y, styles.css). */}
        <Button variant="secondary" size="sm" className="hit-target-y">
          <Share1Icon />
          <span className="hidden sm:inline">Share</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] gap-2">
        <PopoverHeader>
          <PopoverTitle>Share this game</PopoverTitle>
          <PopoverDescription className="text-1">
            Anyone with the link can join or invite others.
          </PopoverDescription>
        </PopoverHeader>
        {shareUrl === null ? (
          <p className="m-0 text-1 text-text-subtle">
            Open this game from an invite link to get one you can share.
          </p>
        ) : (
          // One 28px bar: the link and its copy action share a single field, so the
          // popover holds a sentence and a control instead of three stacked rows.
          <div className="field flex h-[1.75rem] items-center gap-1.5 pr-1 pl-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Invite link"
              className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-1 text-text-muted outline-none"
            />
            <Button
              variant="default"
              size="xs"
              onClick={() => void copy()}
              // 44px-tall hit box on the 20px Copy control; width stays inside the field row
              // (hit-target-y, styles.css).
              className="hit-target-y min-w-[3.75rem]"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
      </PopoverContent>
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
  leading,
}: {
  title: string;
  timer: string;
  done?: boolean;
  members: readonly StackMember[];
  selfId?: string | null;
  shareUrl: string | null;
  onBack: () => void;
  /** Replaces the back chevron; inside the shell this is the sidebar trigger on desktop
   * (a rail plus a back button would double the chrome) with the chevron kept on phones. */
  leading?: React.ReactNode;
}) {
  return (
    // Reserve a stable row height so late-arriving presence never jolts the chrome or the
    // board below it: 24px controls plus the py-1.5 gutter is the resting height already, so
    // pinning it as a floor keeps the first paint (before members load) the same height.
    <header className="flex min-h-[calc(1.5rem+0.75rem)] items-center gap-2 px-2 sm:px-3 py-1.5">
      {leading ?? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          aria-label="Back to start"
          // 44px-tall hit box on the 24px back control (hit-target-y, styles.css).
          className="hit-target-y"
        >
          <ChevronLeftIcon />
        </Button>
      )}

      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Badge variant="neutral" className="min-w-0">
          <span className="truncate">{title}</span>
        </Badge>
        {done && <Badge variant="success">Done</Badge>}
        <span
          className="shrink-0 font-mono text-2 text-text-muted tabular-nums"
          aria-label="Elapsed time"
        >
          {timer}
        </span>
      </div>

      {/* gap-3 throughout: the theme toggle and Share carry 44px hit boxes (hit-target), so the
          12px gutter keeps those targets from colliding while the controls stay compact. */}
      <div className="flex items-center gap-3">
        {/* The presence slot always occupies its space, right-aligned, with a stable width
            that already fits the capped stack (5 avatars at 24px overlapped by 6px, plus the
            +N tail). Reserving it means the theme toggle and Share never slide, and the title
            never re-truncates, when members populate after the first paint. The stack still
            grows into this reservation, so the width never overflows it. */}
        <div className="flex min-w-[8rem] shrink-0 items-center justify-end">
          <AvatarStack members={members} selfId={selfId} />
        </div>
        <ThemeToggle />
        <SharePopover shareUrl={shareUrl} />
      </div>
    </header>
  );
}
