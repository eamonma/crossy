// The game's chrome row, straight from v2's board toolbar: back chevron, the puzzle name as
// a quiet chip, the room's mono timer, a Done chip once solved; on the right, who is here,
// the theme toggle, and Share. One row, no bottom border of its own (the dashed rule under
// the clue strip closes the block). The title truncates before anything else is dropped and
// the timer keeps tabular numerals so it never reflows.
//
// The room's three action surfaces live here (docs/design/room-actions-control.md §2): Share
// (the room's reach: invite link, code, QR, system share, party mode), the roster popover on
// the avatar stack (the people: host kick behind a confirm dialog, DELETE
// /games/{id}/members/{userId}), and the room-actions popover (the game everyone shares:
// check puzzle over the wire, PROTOCOL.md §5/§10, and the host's End game, POST
// /games/{id}/abandon, migrated out of Share). Gating is `isHost` from roomAdmin.ts plus the
// pure derivations in roomActions.ts; the server enforces every role gate regardless, so a
// non-host simply never sees those rows.
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircledIcon,
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  DesktopIcon,
  Share1Icon,
} from "@radix-ui/react-icons";
import { renderSVG } from "uqr";
import type { GameStatus } from "@crossy/protocol";
import type { SyncState } from "../store/gameStore";
import { AvatarStack, CapsLabel } from "./primitives";
import type { StackMember } from "./primitives";
import { abandonGame, isHost, kickMember, partitionRoster } from "./roomAdmin";
import {
  checkedCountLabel,
  emptyCellsHint,
  showRoomActions,
} from "./roomActions";
import { HoldButton } from "./checkVote/HoldButton";
import type { Bearer } from "./homeData";
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
  bearer: Bearer;
  /** Called after a successful end-game or kick so the caller can refresh state; optional. */
  onChanged?: () => void;
}

/** Room-actions wiring (docs/design/room-actions-control.md §5), threaded from LiveApp only —
 * the RoomAdmin pattern — so the demo and other storeless surfaces never grow a check control
 * (R8). Everything here is already derived; the popover renders, it does not decide. */
export interface RoomActions {
  /** The live game status (R4: the popover renders only while `ongoing`; the toolbar's `done`
   * boolean would misread an abandoned room as check-able). */
  status: GameStatus;
  /** Spectators see neither row, so the whole trigger hides for them (design doc §5). */
  spectator: boolean;
  /** The store's connection state: pre-first-welcome (`connecting`) the status above is
   * only a placeholder, so the trigger waits for authoritative state. */
  sync: SyncState;
  /** Empty playable cells by SEQUENCED state only (R9); 0 enables the check row. */
  emptyCount: number;
  /** The game's accepted checks so far, for the quiet "Checked N times" line (R10). */
  checkCount: number;
  /** The confirmed check: re-derives fullness from sequenced state at the confirm tap and
   * sends only while still full (R2). Returns whether it sent; the dialog closes quietly
   * either way, because when stale the row is already disabled again with its hint. */
  onCheckPuzzle: () => boolean;
  /** Solo (the only connected host/solver): the proposal auto-passes at the server, so the solo
   * client keeps the confirm dialog (there is no room to interpose). Multiplayer drops the dialog
   * for hold-to-propose (PROTOCOL.md §10 client guidance; D32; the UX spec beat 1). */
  solo: boolean;
  /** A check vote is already open: a fresh proposal would be VOTE_PENDING, and a new proposal needs
   * a fresh deliberate hold (the UX spec beat 5), so the propose control rests while a vote stands. */
  voteOpen: boolean;
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
      await abandonGame(admin.apiBase, admin.bearer, admin.gameId);
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

/**
 * The room-actions popover body (design doc §5), exported for the node render tests. Check
 * puzzle for hosts and solvers (the spectator gate already hid the whole popover), then,
 * host-only under the register's dashed hairline, End game — its new home, moved out of
 * Share (§2: Share grows the room, room actions act on the game everyone shares).
 */
export function RoomActionsPanel({
  actions,
  admin,
  hostHere,
}: {
  actions: RoomActions;
  admin: RoomAdmin | null;
  hostHere: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const full = actions.emptyCount === 0;
  const countLabel = checkedCountLabel(actions.checkCount);
  return (
    <>
      <PopoverHeader>
        <PopoverTitle>Room actions</PopoverTitle>
        <PopoverDescription className="text-1">
          These act on the puzzle for everyone.
        </PopoverDescription>
      </PopoverHeader>
      <div className="flex flex-col gap-1.5">
        {/* A vote is already open: the propose control rests (a fresh proposal needs a fresh hold,
            the UX spec beat 5), and the surface above the grid carries the ceremony. */}
        {actions.voteOpen ? (
          <p className="m-0 text-center text-1 text-text-subtle">
            A check vote is open above the board.
          </p>
        ) : actions.solo ? (
          // Solo: keep the confirm dialog, the ceremony there is no room to interpose.
          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-center"
            disabled={!full}
            onClick={() => setConfirmOpen(true)}
          >
            Check puzzle
          </Button>
        ) : (
          // Multiplayer: hold-to-propose opens the room vote; no confirm dialog (D32; beat 1).
          <HoldButton
            label="Check puzzle"
            disabled={!full}
            className="w-full"
            onComplete={() => actions.onCheckPuzzle()}
          />
        )}
        {/* Below a full grid the row teaches the gate instead of erroring into it (§5);
            once checks exist, the neutral record rides the same quiet register (R10). */}
        {!full && !actions.voteOpen && (
          <p className="m-0 text-center text-1 text-text-subtle">
            {emptyCellsHint(actions.emptyCount)}
          </p>
        )}
        {countLabel !== null && (
          <p className="m-0 text-center text-1 text-text-subtle">
            {countLabel}
          </p>
        )}
      </div>
      {hostHere && admin !== null && (
        <>
          <div className="border-t border-dashed border-border-dashed" />
          <EndGameRow admin={admin} />
        </>
      )}
      {/* The check confirmation: the end-game Dialog register exactly, non-destructive
          styling (PROTOCOL.md §10: the command is the confirmed intent, so this dialog is
          the whole soft gate; D27). Confirm re-derives fullness from sequenced state (R2)
          and the dialog closes quietly either way — when stale, the disabled row and its
          remaining-cells hint are the explanation, never a toast. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check the puzzle for everyone?</DialogTitle>
            <DialogDescription>
              Wrong letters get marked for the whole room. This is recorded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmOpen(false)}
            >
              Keep solving
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                actions.onCheckPuzzle();
                setConfirmOpen(false);
              }}
            >
              Check puzzle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The room-actions popover: the Share/roster register (same components, same visual
 * weight), trigger sited immediately left of Share (R11). A quiet check-circle icon —
 * check puzzle is the surface's everyday occupant; end-game rides behind the hairline. */
function RoomActionsPopover({
  actions,
  admin,
  hostHere,
}: {
  actions: RoomActions;
  admin: RoomAdmin | null;
  hostHere: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* 44px-tall hit box on the 24px control (hit-target-y, styles.css). */}
        <Button
          variant="secondary"
          size="icon-sm"
          className="hit-target-y"
          aria-label="Room actions"
        >
          <CheckCircledIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[17rem] gap-3">
        <RoomActionsPanel actions={actions} admin={admin} hostHere={hostHere} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The Share popover body, exported for the node render tests. Invite concerns plus Party
 * mode only: End game moved to the room-actions popover (design doc R3, §2 — Share is the
 * room's reach, and putting the room on a TV is exactly that). The party row deliberately
 * takes no game status: it rides every status, so the completed-mosaic projector stays
 * reachable from a finished room.
 */
export function SharePanel({
  shareUrl,
  inviteCode,
  onEnterParty,
}: {
  shareUrl: string | null;
  inviteCode: string | null;
  onEnterParty?: (() => void) | undefined;
}) {
  return (
    <>
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
        <CopyRow label="Invite link" value={shareUrl} ariaLabel="Invite link" />
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
      {onEnterParty !== undefined && (
        <>
          <div className="border-t border-dashed border-border-dashed" />
          {/* The projector on a TV across the room: the room's reach in person, so it
              lives with the QR it complements rather than in an account menu (R3). */}
          <Button
            variant="secondary"
            size="sm"
            className="w-full justify-center"
            onClick={onEnterParty}
          >
            <DesktopIcon />
            Party mode
          </Button>
        </>
      )}
    </>
  );
}

function SharePopover({
  shareUrl,
  inviteCode,
  onEnterParty,
}: {
  shareUrl: string | null;
  inviteCode: string | null;
  onEnterParty?: (() => void) | undefined;
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
        <SharePanel
          shareUrl={shareUrl}
          inviteCode={inviteCode}
          onEnterParty={onEnterParty}
        />
      </PopoverContent>
    </Popover>
  );
}

/** One presence section of the roster: a quiet caps heading (the panel's eyebrow recipe, the
 * same CapsLabel "Solving now" wears) over its member rows. An away row keeps the dimmed avatar
 * (opacity-55, the AvatarStack away treatment) so the section reads calm without shouting. The
 * kick affordance rides in per row via the render child, so both sections share one row shape. */
function RosterSection({
  label,
  people,
  selfId,
  children,
}: {
  label: string;
  people: readonly StackMember[];
  selfId: string | null;
  /** The trailing control for a row, or null (self carries none). */
  children: (m: StackMember) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <CapsLabel className="px-1.5 pt-0.5">{label}</CapsLabel>
      {people.map((m) => (
        <div
          key={m.userId}
          className="flex items-center gap-2 rounded-md px-1.5 py-1"
        >
          <Avatar size="sm" className={!m.connected ? "opacity-55" : ""}>
            {m.avatarUrl !== null && <AvatarImage src={m.avatarUrl} alt="" />}
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
            {m.userId === selfId ? "You" : m.name}
          </span>
          {children(m)}
        </div>
      ))}
    </div>
  );
}

/** The host's roster popover: the avatar stack becomes the trigger for a plain member list
 * with a per-row "Remove from room" action (RosterMenu.swift's kick, host only, never the
 * host's own row). A non-host sees the plain stack with no popover, unchanged from today.
 * The list splits by presence: the people here now lead, away members gather below. */
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

  const { online, away } = useMemo(
    () => partitionRoster(members, selfId),
    [members, selfId],
  );

  /** The per-row kick affordance: everyone but self (the server refuses a self-target), the same
   * rule in both sections so an away member is still removable. */
  function renderKick(m: StackMember) {
    if (m.userId === selfId) return null;
    return (
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
    );
  }

  async function confirmKick(): Promise<void> {
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      await kickMember(
        admin.apiBase,
        admin.bearer,
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
          {/* Presence split (PROTOCOL.md §4 `connected`): the people here now lead, the away
              members gather below their own quiet heading, skipped when nobody is away so no ghost
              heading stands. Store order holds inside each section (self stays first). */}
          <RosterSection label="Here" people={online} selfId={selfId}>
            {(m) => renderKick(m)}
          </RosterSection>
          {away.length > 0 && (
            <RosterSection label="Away" people={away} selfId={selfId}>
              {(m) => renderKick(m)}
            </RosterSection>
          )}
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
            <DialogTitle>Remove {target?.name} from the room?</DialogTitle>
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
  roomActions = null,
  onEnterParty,
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
  /** The room-actions popover's wiring (check puzzle, end game). Threaded from LiveApp only,
   * so surfaces with no live transport never mount the surface at all (R8). */
  roomActions?: RoomActions | null;
  /** Enters party mode (the `?party=1` projector), the Share popover's party row (R3).
   * Absent where there is no game route to toggle (the row simply does not render). */
  onEnterParty?: (() => void) | undefined;
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
        {/* The two room popovers sit adjacent, the personal theme toggle outside them (R11).
            Room actions renders only while ongoing and never for spectators (R4, §5). */}
        {roomActions !== null &&
          roomActions !== undefined &&
          showRoomActions(
            roomActions.status,
            roomActions.spectator,
            roomActions.sync,
          ) && (
            <RoomActionsPopover
              actions={roomActions}
              admin={admin}
              hostHere={hostHere}
            />
          )}
        <SharePopover
          shareUrl={shareUrl}
          inviteCode={inviteCode}
          onEnterParty={onEnterParty}
        />
      </div>
    </header>
  );
}
