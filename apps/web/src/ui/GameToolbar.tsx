// The game's chrome row, straight from v2's board toolbar: back chevron, the puzzle name as
// a quiet chip, the room's mono timer, a Done chip once solved; on the right, who is here,
// the theme toggle, and Share. One row, no bottom border of its own (the dashed rule under
// the clue strip closes the block). The title truncates before anything else is dropped and
// the timer keeps tabular numerals so it never reflows.
//
// Host room-admin controls (the web port of iOS's RoomFactsCard + RosterMenu, PROTOCOL.md §12):
// the Share popover gains a "Copy invite code" row for any member and, host only, a destructive
// "End game" row behind a confirm dialog (POST /games/{id}/abandon). The avatar stack gains a
// host-only roster popover with a per-member "Remove from room" action, also behind a confirm
// dialog (DELETE /games/{id}/members/{userId}). Both reuse the existing REST endpoints the API
// already serves; no new wire field. Gating is `isHost` from roomAdmin.ts; the server enforces
// host-only and self-target regardless, so a non-host simply never sees these rows.
import { useEffect, useMemo, useState } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  Share1Icon,
} from "@radix-ui/react-icons";
import { renderSVG } from "uqr";
import { AvatarStack } from "./primitives";
import type { StackMember } from "./primitives";
import { abandonGame, isHost, kickMember } from "./roomAdmin";
import type { TokenSource } from "./homeData";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "./TopBar";

/** Room-admin wiring, threaded from LiveApp so GameToolbar stays reusable without it (the demo
 * and party surfaces pass nothing, and the popovers render their host rows as absent). */
export interface RoomAdmin {
  apiBase: string;
  gameId: string;
  getToken: TokenSource;
  /** Called after a successful end-game or kick so the caller can refresh state; optional. */
  onChanged?: () => void;
}

function CopyRow({
  label,
  value,
  ariaLabel,
}: {
  label: string;
  value: string;
  ariaLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-1 font-medium text-text-subtle">{label}</span>
      {/* One 28px bar: the value and its copy action share a single field. */}
      <div className="field flex h-[1.75rem] items-center gap-1.5 pr-1 pl-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={ariaLabel}
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
    </div>
  );
}

/** The invite QR, the share surface's in-person channel (secondary in the hierarchy the iOS
 * share card decides too, docs/design/share-surface.md): opening the popover IS the act: you
 * show your screen, no further click. Same generator and register as the party projector
 * (PartyView: uqr, ecc M, dark modules on white regardless of theme, the way a scannable code
 * must be), so the code a phone reads here is module-for-module the projector's. */
function ShareQR({ shareUrl }: { shareUrl: string }) {
  const qrMarkup = useMemo(
    () =>
      renderSVG(shareUrl, {
        ecc: "M",
        border: 2,
        whiteColor: "#ffffff",
        blackColor: "#21201c",
      }),
    [shareUrl],
  );
  return (
    <div className="flex items-center gap-3">
      <div
        role="img"
        aria-label="QR code to join this game"
        className="w-[7.5rem] shrink-0 rounded-md bg-white p-1.5 leading-none shadow-sm [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: qrMarkup }}
      />
      <p className="m-0 min-w-0 text-1 text-text-subtle">
        Scan with a phone camera to join in person.
      </p>
    </div>
  );
}

/** The system share, the catch-all channel (tertiary): navigator.share where the platform
 * offers it, feature-detected, and simply absent where it does not; the copy row above is
 * the graceful fallback, never a broken button. */
function NativeShareRow({ shareUrl }: { shareUrl: string }) {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function"
  ) {
    return null;
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      className="w-full justify-center"
      onClick={() => {
        // A dismissed sheet rejects with AbortError; dismissal is not an error.
        void navigator.share({ url: shareUrl }).catch(() => {});
      }}
    >
      <Share1Icon />
      Share…
    </Button>
  );
}

/** End game: the one destructive host row, a two-beat confirm (Settings.tsx's DeleteBlock
 * pattern; iOS's RoomFactsPanel confirmationDialog is the same shape). */
function EndGameRow({ admin }: { admin: RoomAdmin }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmEnd(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await abandonGame(admin.apiBase, admin.getToken, admin.gameId);
      setOpen(false);
      admin.onChanged?.();
    } catch {
      setError("Couldn't end the game. Give it another try.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        className="w-full justify-center"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        End game
      </Button>
      {error !== null && (
        <p className="m-0 text-1 text-danger-text" role="alert">
          {error}
        </p>
      )}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End this game for everyone?</DialogTitle>
            <DialogDescription>
              This ends the game for everyone in the room.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Keep playing
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void confirmEnd()}
            >
              {busy ? "Ending..." : "End game"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SharePopover({
  shareUrl,
  inviteCode,
  admin,
  hostHere,
}: {
  shareUrl: string | null;
  inviteCode: string | null;
  admin: RoomAdmin | null;
  hostHere: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* 44px-tall hit box on the 24px Share control (hit-target-y, styles.css). */}
        <Button variant="secondary" size="sm" className="hit-target-y">
          <Share1Icon />
          <span className="hidden sm:inline">Share</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] gap-3">
        <PopoverHeader>
          <PopoverTitle>Share this game</PopoverTitle>
          <PopoverDescription className="text-1">
            Anyone with the link can join or invite others.
          </PopoverDescription>
        </PopoverHeader>
        {/* The hierarchy, decided with the iOS share card
            (docs/design/share-surface.md): copy-link primary (the group-chat
            paste, one click, inline feedback), the QR secondary (the
            in-person scan; the popover being open is the act), the system
            share tertiary (everything else, where the platform offers it).
            The bare code rides beside the link as the spoken channel. */}
        {shareUrl === null ? (
          <p className="m-0 text-1 text-text-subtle">
            Open this game from an invite link to get one you can share.
          </p>
        ) : (
          <CopyRow
            label="Invite link"
            value={shareUrl}
            ariaLabel="Invite link"
          />
        )}
        {inviteCode !== null && (
          <CopyRow
            label="Invite code"
            value={inviteCode}
            ariaLabel="Invite code"
          />
        )}
        {shareUrl !== null && (
          <>
            <ShareQR shareUrl={shareUrl} />
            <NativeShareRow shareUrl={shareUrl} />
          </>
        )}
        {hostHere && admin !== null && (
          <>
            <div className="border-t border-dashed border-border-dashed" />
            <EndGameRow admin={admin} />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The host's roster popover: the avatar stack becomes the trigger for a plain member list
 * with a per-row "Remove from room" action (RosterMenu.swift's kick, host only, never the
 * host's own row). A non-host sees the plain stack with no popover, unchanged from today. */
function RosterPopover({
  members,
  selfId,
  admin,
}: {
  members: readonly StackMember[];
  selfId: string | null;
  admin: RoomAdmin;
}) {
  const [target, setTarget] = useState<StackMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmKick(): Promise<void> {
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      await kickMember(
        admin.apiBase,
        admin.getToken,
        admin.gameId,
        target.userId,
      );
      setTarget(null);
      admin.onChanged?.();
    } catch {
      setError("Couldn't remove them. Give it another try.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Manage players"
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AvatarStack members={members} selfId={selfId} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[16rem] gap-1 p-1.5">
          <PopoverHeader className="px-1.5 pt-1">
            <PopoverTitle className="text-1">Players</PopoverTitle>
          </PopoverHeader>
          {members.map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-2 rounded-md px-1.5 py-1"
            >
              <Avatar size="sm" className={!m.connected ? "opacity-55" : ""}>
                {m.avatarUrl !== null && (
                  <AvatarImage src={m.avatarUrl} alt="" />
                )}
                <AvatarFallback
                  className={
                    m.userId === selfId
                      ? "bg-gold-4 text-gold-11"
                      : "bg-sand-4 text-sand-11"
                  }
                >
                  {m.initial.toUpperCase().slice(0, 1)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-2 text-text">
                {m.userId === selfId ? "You" : m.initial}
              </span>
              {m.userId !== selfId && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-danger-text hover:bg-destructive/10"
                  onClick={() => {
                    setError(null);
                    setTarget(m);
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          {error !== null && (
            <p className="m-0 px-1.5 text-1 text-danger-text" role="alert">
              {error}
            </p>
          )}
        </PopoverContent>
      </Popover>
      <Dialog
        open={target !== null}
        onOpenChange={(next) => {
          if (busy) return;
          if (!next) setTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {target?.initial} from the room?</DialogTitle>
            <DialogDescription>
              They lose their seat and can&apos;t rejoin with this code.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void confirmKick()}
            >
              {busy ? "Removing..." : "Remove from room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GameToolbar({
  title,
  timer,
  done = false,
  members,
  selfId = null,
  shareUrl,
  inviteCode = null,
  admin = null,
  onBack,
  leading,
}: {
  title: string;
  timer: string;
  done?: boolean;
  members: readonly StackMember[];
  selfId?: string | null;
  shareUrl: string | null;
  /** The bare invite code (PROTOCOL.md §12: `GET /games/{id}` returns it to any member), for
   * the Share popover's "Copy invite code" row alongside the full link. */
  inviteCode?: string | null;
  /** REST wiring for the host controls (end game, kick). Absent on surfaces with no live
   * mutation path (the demo, the party projector), which then render no host rows at all. */
  admin?: RoomAdmin | null;
  onBack: () => void;
  /** Replaces the back chevron; inside the shell this is the sidebar trigger on desktop
   * (a rail plus a back button would double the chrome) with the chevron kept on phones. */
  leading?: React.ReactNode;
}) {
  const hostHere = isHost(members, selfId);
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
          {hostHere && admin !== null ? (
            <RosterPopover members={members} selfId={selfId} admin={admin} />
          ) : (
            <AvatarStack members={members} selfId={selfId} />
          )}
        </div>
        <ThemeToggle />
        <SharePopover
          shareUrl={shareUrl}
          inviteCode={inviteCode}
          admin={admin}
          hostHere={hostHere}
        />
      </div>
    </header>
  );
}
