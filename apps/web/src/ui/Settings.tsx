// Settings (/settings): the personal surface inside the signed-in shell. It holds who you are
// (account, sign out, delete), plus the client-local Solving preferences that steer the cursor
// while you type (settings slice 1). Theme lives in the account menu already, so it has no
// second home here; notifications and other server-side settings are still out of scope.
//
// One grammar, top to bottom: every setting is a row — a label with a one-line description on
// the left, its control right-aligned — and the system's dashed rule (primitives.Divider, the
// one structural device) separates rows and groups. No nested shadcn cards, no red "danger
// zone" box: the page reads as the app's paper, not a dashboard template. Sign out and delete
// are two more rows in the same grammar; delete's weight lives in its two-beat confirm dialog.
//
// The Solving prefs are per device and client-local (localStorage via useNavPrefs), no wire
// call: they change only where the local cursor lands after a keystroke, and apply live.
//
// The identity row reads only what the session already carries (userId, displayName,
// isAnonymous); it adds no wire call. Account type is derived from isAnonymous: a guest, or a
// signed-in account. The session carries no provider discriminator (Discord vs Apple), so we do
// not name one we cannot verify. The avatar is the initial monogram the shell and party roster
// use for the signed-in user; the session holds no image URL.
//
// Delete is destructive and two-beat: an explicit confirm dialog that names the consequence
// (identity removed, hosted games handed off or ended, past contributions stay as an anonymous
// former participant, DESIGN.md §8), then DELETE /account with the bearer. On success the app
// signs out locally and returns to the landing page; on failure an inline sentence, never silent.
import { useEffect, useState, type ReactNode } from "react";
import { ExitIcon } from "@radix-ui/react-icons";
import type {
  Identity,
  IdentitySession,
  SetDisplayNameReason,
} from "../identity";
import type { Navigate } from "../nav";
import { homeHref } from "../nav";
import { CapsLabel, Divider, cx } from "./primitives";
import { deleteAccount, type Bearer } from "./homeData";
import { useNavPrefs } from "./useNavPrefs";
import type { EndOfWord } from "../input/prefs";
import {
  sanitizeDisplayName,
  isCompleteDisplayName,
  canonicalizeDisplayName,
} from "../profile/name";
import { displayNameErrorOf } from "./onboardingMachine";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  // Subscribe so the identity row reflects the app-DB name the moment loadProfile reconciles it
  // (the adapter fires onChange("refreshed") on adoption, R5) and so a sign-out flips the page.
  const [session, setSession] = useState<IdentitySession | null>(() =>
    identity.getSession(),
  );
  useEffect(() => identity.onChange(setSession), [identity]);

  // On entering Settings, read GET /me so the row shows the app-DB truth, not the bootstrap
  // (§12). A failed load is harmless here (the row keeps the session's current name); the editor
  // still writes through PATCH /me. Guests have no /me name to load, but the call is cheap and
  // its reconcile is a no-op for an anonymous session, so it is not gated.
  useEffect(() => {
    let live = true;
    void identity
      .loadProfile()
      .catch(() => {
        // Transient GET /me failure: keep the current name, never sign out (INV-11).
      })
      .finally(() => {
        if (!live) return;
      });
    return () => {
      live = false;
    };
  }, [identity]);

  return (
    <div className="h-full min-w-0 p-4 md:p-3 md:pl-0">
      <div className="flex h-full flex-col overflow-hidden rounded-3 border border-border-strong bg-panel shadow-sm">
        {/* The sidebar toggle, anchored like the home panel so a collapse never slides it out
            from under the cursor. Desktop only; the phone header owns the sheet trigger. */}
        <div className="hidden shrink-0 px-3 pt-2 md:block">
          <SidebarTrigger className="text-text-subtle hover:text-text" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          <div className="mx-auto w-full max-w-[38rem] px-5 pt-4 md:pt-2">
            <h1 className="m-0 font-display text-7 text-text">Settings</h1>
            <Divider className="mt-4" />

            {/* Solving prefs are per device, not per account, so they render whether or not
                you're signed in (they only steer the local cursor). */}
            <div className="mt-7 flex flex-col gap-8">
              <SolvingGroup />
              {session === null ? (
                <p className="text-2 text-text-muted">
                  You&apos;re signed out.
                </p>
              ) : (
                <AccountGroup
                  identity={identity}
                  session={session}
                  onSignOut={() => void identity.signOut()}
                  apiBase={apiBase}
                  bearer={bearer}
                  onDeleted={async () => {
                    await identity.signOut();
                    navigate(homeHref(params));
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A titled group: the quiet caps eyebrow over a column of rows. The rows carry their own
 * dashed rules between them (the caller interleaves Divider), so a group is just the eyebrow
 * plus whatever rows it holds — no card, no border, no shadow. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <CapsLabel className="mb-1 text-text-subtle">{label}</CapsLabel>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/** The one row grammar: a label with an optional one-line description on the left, a control
 * right-aligned. An optional inline error sits beneath the row, never silent (used by delete). */
function SettingRow({
  label,
  description,
  control,
  error,
}: {
  label: string;
  description?: string;
  control: ReactNode;
  error?: string | null;
}) {
  return (
    <div>
      {/* flex-wrap + a label min-width: when a wide control (the segmented pair) can't share
          the line on a phone, the control wraps beneath the label rather than crushing the
          label into a mid-phrase break. ml-auto keeps the control right-aligned on either line. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
        <div className="min-w-[9rem] flex-1">
          <div className="text-3 font-medium text-text">{label}</div>
          {description !== undefined && (
            <div className="mt-0.5 text-2 text-text-muted">{description}</div>
          )}
        </div>
        <div className="ml-auto shrink-0">{control}</div>
      </div>
      {error !== undefined && error !== null && (
        <p className="-mt-1.5 pb-3 text-1 text-danger-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Solving: the personal, client-local navigation prefs (settings slice 1). Two rows in the one
 * grammar: a switch for skip-filled, a segmented pair for end-of-word behavior. Both read and
 * write the shared useNavPrefs context, so a change applies live to the board with no reload.
 * Defaults reproduce today's behavior exactly.
 */
function SolvingGroup() {
  const { prefs, setSkipFilledInWord, setEndOfWord } = useNavPrefs();
  return (
    <Group label="Solving">
      <SettingRow
        label="Skip filled squares"
        description="While typing within a word"
        control={
          <Switch
            aria-label="Skip filled squares"
            checked={prefs.skipFilledInWord}
            onCheckedChange={setSkipFilledInWord}
          />
        }
      />
      <Divider />
      <SettingRow
        label="At the end of a word"
        description="Once the word is full"
        control={
          <Segmented<EndOfWord>
            ariaLabel="At the end of a word"
            value={prefs.endOfWord}
            options={[
              { value: "next-clue", label: "Next clue" },
              { value: "first-blank", label: "First blank" },
            ]}
            onChange={setEndOfWord}
          />
        }
      />
    </Group>
  );
}

/** The account group: who you are, then sign out and delete as two more rows in the same
 * grammar. The identity row leads (avatar, name, account type) and, for a permanent account,
 * gains an inline name editor; a dashed rule separates it from the two actions. Delete's inline
 * error and its confirm dialog live in DeleteRow. */
function AccountGroup({
  identity,
  session,
  onSignOut,
  apiBase,
  bearer,
  onDeleted,
}: {
  identity: Identity;
  session: IdentitySession;
  onSignOut: () => void;
  apiBase: string;
  bearer: Bearer;
  onDeleted: () => Promise<void>;
}) {
  return (
    <Group label="Account">
      <IdentityRow identity={identity} session={session} />
      <Divider />
      <SettingRow
        label="Sign out"
        description="On this device. Your games and account stay as they are."
        control={
          <Button variant="secondary" size="sm" onClick={onSignOut}>
            <ExitIcon />
            Sign out
          </Button>
        }
      />
      <Divider />
      <DeleteRow apiBase={apiBase} bearer={bearer} onDeleted={onDeleted} />
    </Group>
  );
}

/**
 * The identity row: avatar + name + account type, with an inline "Edit" affordance for a
 * permanent account (§12). Read mode shows the app-DB name (reconciled by loadProfile in the
 * parent). Edit mode swaps the name line for an Input seeded from the current name, with Save
 * (inverse) and Cancel (ghost), the avatar initial updating live from the draft, and validation
 * failures in the row error slot. A guest sees the existing read-only row (guests are join-only
 * and keep the "Guest" label; the editor is permanent-accounts-only in v1, R2).
 */
function IdentityRow({
  identity,
  session,
}: {
  identity: Identity;
  session: IdentitySession;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SetDisplayNameReason | null>(null);

  // The avatar initial: from the live draft while editing, else the current name. A neutral "Y"
  // (you) when a permanent account has no name yet, matching the prior read-only fallback.
  const source = editing ? draft : session.displayName;
  const initial = source.trim().slice(0, 1).toUpperCase() || "Y";
  const ready = isCompleteDisplayName(draft);

  function beginEdit(): void {
    setDraft(session.displayName);
    setError(null);
    setEditing(true);
  }

  function cancel(): void {
    setEditing(false);
    setError(null);
  }

  async function save(): Promise<void> {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    const result = await identity.setDisplayName(
      canonicalizeDisplayName(draft),
    );
    setSaving(false);
    if (result.ok) {
      // The adapter adopted the canonical name and fired onChange, so the parent re-renders the
      // row with the new name; just leave edit mode.
      setEditing(false);
      return;
    }
    // A NAME_* / rate_limit / network reason: keep the draft, show the row error, stay in edit.
    setError(result.reason);
  }

  const control = editing ? (
    <div className="flex items-center gap-1.5">
      <Button
        variant="inverse"
        size="sm"
        disabled={!ready || saving}
        onClick={() => void save()}
      >
        {saving ? "Saving..." : "Save"}
      </Button>
      <Button variant="ghost" size="sm" disabled={saving} onClick={cancel}>
        Cancel
      </Button>
    </div>
  ) : (
    !session.isAnonymous && (
      <Button variant="ghost" size="sm" onClick={beginEdit}>
        Edit
      </Button>
    )
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
        <div className="flex min-w-[9rem] flex-1 items-center gap-3">
          <Avatar size="lg" aria-hidden={editing}>
            {session.avatarUrl !== null && (
              <AvatarImage src={session.avatarUrl} alt="" />
            )}
            <AvatarFallback className="bg-gold-4 text-gold-11">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                autoFocus
                value={draft}
                disabled={saving}
                aria-label="Display name"
                aria-invalid={error !== null}
                maxLength={80}
                placeholder="Your name"
                onChange={(e) => {
                  setDraft(sanitizeDisplayName(e.target.value));
                  if (error !== null) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
            ) : (
              <div className="truncate text-3 font-medium text-text">
                {session.displayName || "Signed in"}
              </div>
            )}
            <div className="mt-0.5 text-2 text-text-muted">
              {accountTypeLabel(session)}
            </div>
          </div>
        </div>
        {control && <div className="ml-auto shrink-0">{control}</div>}
      </div>
      {error !== null && (
        <p className="-mt-1.5 pb-3 text-1 text-danger-text" role="alert">
          {displayNameErrorOf(error)}
        </p>
      )}
    </div>
  );
}

/** A connected two-option segmented control: one pill container, the chosen segment carries the
 * gold face (the app's single accent), the other stays quiet ink. role="radiogroup"/"radio" for
 * the accessible state. Concise labels so the pair never wraps on a phone. */
function Segmented<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-3 border border-border bg-sand-3 p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cx(
              "rounded-2 px-2.5 py-1 text-1 font-medium transition-colors",
              "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-text-muted hover:text-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Delete account: the destructive row. The control opens the two-beat confirm dialog; the
 * dialog's confirm names the consequence and fires DELETE /account. A failure surfaces inline
 * beneath the row (the dialog closes so the sentence is visible), never silent. No red box: the
 * row reads calm, and the confirm dialog is the real gate.
 */
function DeleteRow({
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
      setError("Your session expired. Continue to delete your account.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(apiBase, bearer);
      await onDeleted();
    } catch {
      setBusy(false);
      // Close the dialog so the inline error is actually visible: an open modal overlay would
      // hide the row beneath it.
      setOpen(false);
      setError(
        "We couldn't delete your account. Nothing changed. Give it another try.",
      );
    }
  }

  return (
    <>
      <SettingRow
        label="Delete account"
        description="Removes your identity for good. This can't be undone."
        error={error}
        control={
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
        }
      />

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
    </>
  );
}
