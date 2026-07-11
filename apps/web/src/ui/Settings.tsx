// Settings (/settings): the thin account surface inside the signed-in shell. It holds exactly
// three things and nothing else (no theme, no notifications): who you are, sign out, and delete
// account. Theme lives in the account menu already, so it has no second home here.
//
// The identity block reads only what the session already carries (userId, displayName,
// isAnonymous); it adds no wire call. Account type is derived from isAnonymous: a guest, or a
// signed-in account. The session carries no provider discriminator (Discord vs Apple), so we do
// not name one we cannot verify without a new wire call. The avatar is the initial monogram the
// shell and party roster use for the signed-in user; the session holds no image URL.
//
// Delete is destructive and two-beat: an explicit confirm dialog that names the consequence
// (identity removed, hosted games handed off or ended, past contributions stay as an anonymous
// former participant, DESIGN.md §8), then DELETE /account with the bearer. On success the app
// signs out locally and returns to the landing page; on failure an inline sentence, never silent.
import { useState } from "react";
import { ExitIcon } from "@radix-ui/react-icons";
import type { Identity, IdentitySession } from "../identity";
import type { Navigate } from "../nav";
import { homeHref } from "../nav";
import { CapsLabel, Divider } from "./primitives";
import { deleteAccount, type TokenSource } from "./homeData";
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
import { SidebarTrigger } from "@/components/ui/sidebar";

/** The account type, derived from the session (no extra wire call). The session carries no
 * provider discriminator, so a signed-in account is not labeled Discord or Apple specifically. */
function accountTypeLabel(session: IdentitySession): string {
  return session.isAnonymous ? "Guest account" : "Signed-in account";
}

export function Settings({
  identity,
  apiBase,
  getToken,
  navigate,
  params,
}: {
  identity: Identity;
  apiBase: string;
  /** The bearer source for DELETE /account, resolved fresh at the confirm click. */
  getToken: TokenSource;
  navigate: Navigate;
  params: URLSearchParams;
}) {
  const session = identity.getSession();

  return (
    <div className="h-full min-w-0 p-4 md:p-3 md:pl-0">
      <div className="flex h-full flex-col overflow-hidden rounded-3 border border-border-strong bg-panel shadow-sm">
        {/* The sidebar toggle, anchored like the home panel so a collapse never slides it out
            from under the cursor. Desktop only; the phone header owns the sheet trigger. */}
        <div className="hidden shrink-0 px-3 pt-2 md:block">
          <SidebarTrigger className="text-text-subtle hover:text-text" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="mx-auto w-full max-w-[42rem] px-4 pt-4 md:pt-2">
            <h1 className="m-0 font-display text-6 text-text">Settings</h1>
            <p className="mt-1 text-2 text-text-muted">
              Your account. Sign out or delete it here.
            </p>
            <Divider className="mt-3" />

            {session === null ? (
              <p className="mt-6 text-2 text-text-muted">
                You&apos;re signed out.
              </p>
            ) : (
              <div className="mt-6 flex flex-col gap-8">
                <IdentityBlock session={session} />
                <SignOutBlock onSignOut={() => void identity.signOut()} />
                <DeleteBlock
                  apiBase={apiBase}
                  getToken={getToken}
                  onDeleted={async () => {
                    await identity.signOut();
                    navigate(homeHref(params));
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Who you are: the initial avatar, the display name, and the provider and account type. */
function IdentityBlock({ session }: { session: IdentitySession }) {
  const initial = session.displayName.slice(0, 1).toUpperCase() || "Y";
  return (
    <section className="flex flex-col gap-3">
      <CapsLabel className="text-text-subtle">Account</CapsLabel>
      <div className="flex items-center gap-3 rounded-4 border border-border bg-panel p-4 shadow-sm">
        <Avatar size="lg">
          <AvatarFallback className="bg-gold-4 text-gold-11">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-3 font-medium text-text">
            {session.displayName}
          </div>
          <div className="mt-0.5 text-1 text-text-muted">
            {accountTypeLabel(session)}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Sign out: the existing machinery, one calm control. */
function SignOutBlock({ onSignOut }: { onSignOut: () => void }) {
  return (
    <section className="flex flex-col gap-3">
      <CapsLabel className="text-text-subtle">Session</CapsLabel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[28rem] text-2 text-text-muted">
          Sign out on this device. Your games and account stay as they are.
        </p>
        <Button variant="secondary" size="sm" onClick={onSignOut}>
          <ExitIcon />
          Sign out
        </Button>
      </div>
    </section>
  );
}

/**
 * Delete account: the destructive block. The primary control opens the two-beat confirm dialog;
 * the dialog's confirm names the consequence and fires DELETE /account, surfacing a failure inline.
 */
function DeleteBlock({
  apiBase,
  getToken,
  onDeleted,
}: {
  apiBase: string;
  getToken: TokenSource;
  onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete(): Promise<void> {
    // Resolved at the click, not at mount: a null here means genuinely signed out
    // (this tab raced a sign-out elsewhere), named plainly rather than as a failure.
    if ((await getToken()) === null) {
      setOpen(false);
      setError("Your session expired. Sign in again to delete your account.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(apiBase, getToken);
      await onDeleted();
    } catch {
      setBusy(false);
      // Close the dialog so the inline error is actually visible: the alert lives in the
      // danger card, and an open modal overlay would hide it.
      setOpen(false);
      setError(
        "We couldn't delete your account. Nothing changed. Give it another try.",
      );
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <CapsLabel className="text-danger-text">Danger zone</CapsLabel>
      <div className="flex flex-col gap-3 rounded-4 border border-border bg-danger-bg/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 max-w-[30rem] text-2 text-text-muted">
            Delete your account. This removes your identity for good. It
            can&apos;t be undone.
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            Delete account
          </Button>
        </div>
        {error !== null && (
          <p className="m-0 text-1 text-danger-text" role="alert">
            {error}
          </p>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. Your identity is removed. Games you
              host are handed to another solver, or ended if you&apos;re the
              last one. Your past letters stay in the puzzles you helped solve,
              as an anonymous former participant.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Keep my account
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {busy ? "Deleting..." : "Delete account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
