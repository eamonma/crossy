// The full participants list: everyone in the room, spectators quietly marked (owner ruling
// 2026-07-10 keeps the full list whole while the top-bar stack shows only who is playing). It
// opens from the toolbar's presence cluster. When the local user is host, each other row carries a
// kick affordance (never the host's own row): a menu to a plain confirm dialog that says what
// happens (removed, cannot rejoin by code), then the DELETE call (PROTOCOL.md section 12). A
// failure shows in the dialog; a 403 is the server saying no, stated plainly.
import { useState } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RestResult } from "../net/rest";
import { cx } from "./primitives";

export interface ParticipantRow {
  userId: string;
  displayName: string;
  color: string;
  role: "host" | "solver" | "spectator";
  connected: boolean;
  self: boolean;
}

/** The one-line role tag on a row: the host is named, a spectator is marked watching, a solver
 * carries no tag (playing is the default the list is read against). */
function RoleTag({ role }: { role: ParticipantRow["role"] }) {
  if (role === "host")
    return <span className="text-1 text-text-subtle">Host</span>;
  if (role === "spectator")
    return <span className="text-1 text-text-subtle">Watching</span>;
  return null;
}

export function ParticipantsList({
  participants,
  isHost,
  onKick,
}: {
  participants: readonly ParticipantRow[];
  /** True when the local user is host: the only role the kick affordance shows for. */
  isHost: boolean;
  /** Runs the kick; resolves ok, or a plain message for the confirm dialog to surface. */
  onKick: (userId: string) => Promise<RestResult>;
}) {
  // The row a confirm dialog is open for, plus the in-flight and error state of that one kick.
  const [target, setTarget] = useState<ParticipantRow | null>(null);
  const [kicking, setKicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openConfirm(row: ParticipantRow): void {
    setError(null);
    setKicking(false);
    setTarget(row);
  }

  function closeConfirm(): void {
    if (kicking) return;
    setTarget(null);
  }

  async function confirmKick(): Promise<void> {
    if (target === null) return;
    setKicking(true);
    setError(null);
    const result = await onKick(target.userId);
    setKicking(false);
    if (result.ok) setTarget(null);
    else setError(result.message);
  }

  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {participants.map((p) => {
          // The kick affordance is host-only and never on the host's own row (the server refuses
          // self-targeting with 403; this keeps it out of reach in the first place).
          const canKick = isHost && !p.self;
          return (
            <li
              key={p.userId}
              className="flex items-center gap-2 rounded-md px-1 py-1"
            >
              <Avatar
                size="sm"
                className={cx(!p.connected && "opacity-55")}
                title={p.displayName}
              >
                <AvatarFallback
                  className={
                    p.self ? "bg-gold-4 text-gold-11" : "bg-sand-4 text-sand-11"
                  }
                >
                  {(p.displayName.charAt(0) || "?").toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-2 font-medium text-text">
                {p.displayName}
                {p.self && (
                  <span className="ml-1 text-1 text-text-subtle">(you)</span>
                )}
              </span>
              <RoleTag role={p.role} />
              {canKick && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Manage ${p.displayName}`}
                    >
                      <DotsHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => openConfirm(p)}
                    >
                      Remove from game
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
      >
        <DialogContent showCloseButton={!kicking}>
          <DialogHeader>
            <DialogTitle>Remove {target?.displayName}?</DialogTitle>
            <DialogDescription>
              They will be removed from this game and cannot rejoin with the
              invite code.
            </DialogDescription>
          </DialogHeader>
          {error !== null && (
            <p className="m-0 text-2 text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={closeConfirm}
              disabled={kicking}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmKick()}
              disabled={kicking}
            >
              {kicking ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
