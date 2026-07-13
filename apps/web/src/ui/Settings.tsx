// Settings (/settings): the personal surface inside the signed-in shell. It holds who you are
// (account block, sign out, delete), plus the client-local Solving preferences that steer the
// cursor while you type (settings slice 1). Theme lives in the account menu already, so it has
// no second home here; notifications and other server-side settings are still out of scope.
//
// The Solving prefs are per device and client-local (localStorage via useNavPrefs), no wire
// call: they change only where the local cursor lands after a keystroke, and apply live.
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
import { CapsLabel, Divider, cx } from "./primitives";
import { deleteAccount, type Bearer } from "./homeData";
import { useNavPrefs } from "./useNavPrefs";
import type { EndOfWord } from "../input/prefs";
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
  bearer,
  navigate,
  params,
}: {
  identity: Identity;
  apiBase: string;
  /** The REST bearer for DELETE /account: resolve at the confirm click, retry once on 401. */
  bearer: Bearer;
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
              How you solve, and your account.
            </p>
            <Divider className="mt-3" />

            {/* Solving prefs are per device, not per account, so they render whether or not
                you're signed in (they only steer the local cursor). */}
            <div className="mt-6 flex flex-col gap-8">
              <SolvingBlock />
              {session === null ? (
                <p className="text-2 text-text-muted">
                  You&apos;re signed out.
                </p>
              ) : (
                <>
                  <IdentityBlock session={session} />
                  <SignOutBlock onSignOut={() => void identity.signOut()} />
                  <DeleteBlock
                    apiBase={apiBase}
                    bearer={bearer}
                    onDeleted={async () => {
                      await identity.signOut();
                      navigate(homeHref(params));
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Solving: the personal, client-local navigation prefs (settings slice 1). Two controls in the
 * one settings card language: a toggle for skip-filled, and a two-option control for end-of-word
 * behavior. Both read and write the shared useNavPrefs context, so a change applies live to the
 * board with no reload. Defaults reproduce today's behavior exactly.
 */
function SolvingBlock() {
  const { prefs, setSkipFilledInWord, setEndOfWord } = useNavPrefs();
  return (
    <section className="flex flex-col gap-3">
      <CapsLabel className="text-text-subtle">Solving</CapsLabel>
      <div className="flex flex-col divide-y divide-border rounded-4 border border-border bg-panel shadow-sm">
        <ToggleRow
          label="Skip filled squares"
          subtitle="While typing within a word"
          checked={prefs.skipFilledInWord}
          onChange={setSkipFilledInWord}
        />
        <ChoiceRow
          label="At the end of a word"
          value={prefs.endOfWord}
          options={[
            { value: "next-clue", label: "Move to the next clue" },
            { value: "first-blank", label: "Jump back to the first blank" },
          ]}
          onChange={setEndOfWord}
        />
      </div>
    </section>
  );
}

/** A labelled switch row: title plus subtitle on the left, an accessible toggle on the right.
 * Built from a plain button (role="switch") since the shadcn set has no Switch; the pill and
 * knob are the same warm tokens the rest of the surface uses. */
function ToggleRow({
  label,
  subtitle,
  checked,
  onChange,
}: {
  label: string;
  subtitle: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="text-3 font-medium text-text">{label}</div>
        <div className="mt-0.5 text-1 text-text-muted">{subtitle}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          checked ? "bg-primary" : "bg-sand-6",
        )}
      >
        <span
          className={cx(
            "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** A labelled two-option control: the title on top, the options as a segmented pair below. Each
 * option is a Button in the secondary recipe; the chosen one carries aria-pressed and the gold
 * face, matching the settings-strip segmented language without inventing a new primitive. */
function ChoiceRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: EndOfWord;
  options: readonly { value: EndOfWord; label: string }[];
  onChange: (next: EndOfWord) => void;
}) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="text-3 font-medium text-text">{label}</div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              variant={selected ? "default" : "secondary"}
              size="sm"
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </Button>
          );
        })}
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
  bearer,
  onDeleted,
}: {
  apiBase: string;
  bearer: Bearer;
  onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete(): Promise<void> {
    // Resolved at the click, not at mount: a null here means genuinely signed out
    // (this tab raced a sign-out elsewhere), named plainly rather than as a failure.
    if ((await bearer.getToken()) === null) {
      setOpen(false);
      setError("Your session expired. Sign in again to delete your account.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(apiBase, bearer);
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
