// Display-name onboarding: the one-field interrupt that lands a real name for a nameless
// permanent account the moment one is found (DESIGN.md name-onboarding §11). A Radix Dialog, the
// same modal pattern ContinueAnotherWay uses, driven by the pure onboardingMachine. It is not
// casually dismissable while the account is nameless (no close button, outside-click ignored),
// but it is never a dead end (R4): the field is prefilled with a valid suggestion, so "required"
// costs one tap on Continue, and the submit is resilient (auto-retry on network/5xx, honors a
// 429's Retry-After, never signs out).
//
// Where it fires: the app root renders this whenever signed in; the component reads GET /me
// (identity.loadProfile) on a real session and opens iff the server says needsName (R3). The
// name the chrome renders is the app-DB value the adapter reconciles on load (R5); this dialog
// only writes it.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Identity, IdentitySession } from "../identity";
import { prefillName } from "../profile/suggestName";
import {
  sanitizeDisplayName,
  isCompleteDisplayName,
  canonicalizeDisplayName,
} from "../profile/name";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ONBOARDING_COPY,
  displayNameErrorOf,
  initialOnboardingState,
  saveFailed,
  toSaving,
  clearError,
  type OnboardingState,
} from "./onboardingMachine";

/** The retry policy for a resilient submit (R4): bounded auto-retries on a transport/5xx failure
 *  with growing backoff, so a flaky network self-heals without a lockout and without hammering. */
const MAX_AUTO_RETRIES = 3;
const RETRY_BACKOFF_MS = [400, 1200, 3000] as const;
/** The load retry when GET /me fails transiently: never a sign-out (INV-11), just try again. */
const LOAD_RETRY_MS = 2000;

export function DisplayNameOnboarding({ identity }: { identity: Identity }) {
  // The session the dialog serves. Read synchronously and kept fresh via onChange, so a sign-in
  // that lands after mount arms the check. Null when signed out: the dialog never opens (INV-11).
  const [session, setSession] = useState<IdentitySession | null>(() =>
    identity.getSession(),
  );
  const [open, setOpen] = useState(false);

  useEffect(
    () =>
      identity.onChange((next) => {
        setSession(next);
        // A sign-out closes the dialog; a name that just landed (refreshed) is handled by the
        // load effect re-confirming needsName. Never keep the dialog open with no session.
        if (next === null) setOpen(false);
      }),
    [identity],
  );

  // Confirm "needs a name" against the server (R3) whenever a real session is present. INV-11:
  // arm only on a true session; a failed loadProfile retries with a timer, never signs out.
  useEffect(() => {
    if (session === null) return;
    let live = true;
    let timer: number | undefined;
    const confirm = (): void => {
      identity
        .loadProfile()
        .then((profile) => {
          if (!live) return;
          if (profile.needsName) setOpen(true);
          else setOpen(false);
        })
        .catch(() => {
          // Transient GET /me failure: retry, do not sign out and do not open the dialog on a
          // guess. The account's namelessness is only ever the server's answer.
          if (!live) return;
          timer = window.setTimeout(confirm, LOAD_RETRY_MS);
        });
    };
    confirm();
    return () => {
      live = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // Re-confirm on a new identity (userId) or when the session appears/disappears.
  }, [identity, session?.userId, session === null]);

  if (session === null) return null;

  return (
    <Dialog
      open={open}
      // Not dismissable while nameless: ignore every close request (outside click, Escape). The
      // dialog closes only when the write confirms and the load effect sees needsName go false.
      onOpenChange={() => {}}
    >
      <DialogContent
        // No close button (the account must get a name); ignore outside-click and Escape so the
        // one-tap prefill is the only way forward, never a hole to fall through (R4, §11.3).
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="sm:max-w-sm"
      >
        {open && <OnboardingBody identity={identity} session={session} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog body, mounted only while open (so it always starts on the prefill with no stale
 * draft). Holds the draft, the machine state, and the resilient submit. Success is not a state:
 * the write fires onChange, the load effect re-confirms needsName is false, and the parent closes
 * the dialog.
 */
function OnboardingBody({
  identity,
  session,
}: {
  identity: Identity;
  session: IdentitySession;
}) {
  const [draft, setDraft] = useState(() => prefillName(session));
  const [state, setState] = useState<OnboardingState>(initialOnboardingState);
  // A live ref so an in-flight retry chain reads the newest draft if the user edits mid-retry.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const saving = state.step === "saving";
  const ready = isCompleteDisplayName(draft);
  const errorReason = state.step === "entry" ? state.error : null;

  const submit = useCallback(async (): Promise<void> => {
    setState(toSaving());
    // Canonicalize the confirmed draft once; the server canonicalizes authoritatively too, so we
    // send the same shape it will store. Retry only transient failures (network/unknown) with
    // backoff; a NAME_* or rate_limit stops and shows its copy (R4).
    for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt += 1) {
      const name = canonicalizeDisplayName(draftRef.current);
      const result = await identity.setDisplayName(name);
      if (result.ok) {
        // The adapter adopted the canonical name and fired onChange; the parent's load effect
        // will see needsName false and close. Nothing else to do here.
        return;
      }
      if (
        result.reason === "NAME_REQUIRED" ||
        result.reason === "NAME_TOO_LONG" ||
        result.reason === "NAME_INVALID" ||
        result.reason === "rate_limited"
      ) {
        // Not transport-transient: show the reason and let the user fix or retry. For a 429 the
        // copy asks for patience; the button is live again immediately (a manual retry is always
        // available, never a hard lockout).
        setState(saveFailed(result.reason));
        return;
      }
      // network / unknown: auto-retry with backoff, unless this was the last attempt.
      if (attempt === MAX_AUTO_RETRIES) {
        setState(saveFailed(result.reason));
        return;
      }
      await new Promise((r) =>
        window.setTimeout(r, RETRY_BACKOFF_MS[attempt] ?? 3000),
      );
    }
  }, [identity]);

  // The live avatar preview initial, from the sanitized draft (aria-hidden; the name is announced
  // by the field). Empty draft falls back to a neutral dot so the puck is never blank-jarring.
  const initial = draft.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || saving) return;
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-display">
          {ONBOARDING_COPY.title}
        </DialogTitle>
        <DialogDescription>{ONBOARDING_COPY.description}</DialogDescription>
      </DialogHeader>

      <div className="mt-4 flex flex-col items-center gap-4">
        {/* The live preview: the fallback initial updates as the user types. Decorative, so it is
            hidden from assistive tech; the field announces the name. */}
        <Avatar size="lg" aria-hidden>
          {session.avatarUrl !== null && (
            <AvatarImage src={session.avatarUrl} alt="" />
          )}
          <AvatarFallback className="bg-gold-4 text-gold-11">
            {initial}
          </AvatarFallback>
        </Avatar>

        <div className="flex w-full flex-col gap-2">
          <Input
            autoFocus
            value={draft}
            disabled={saving}
            aria-label="Display name"
            aria-invalid={errorReason !== null}
            // A generous UTF-16 guard; the real bound is 40 graphemes, enforced by the sanitizer
            // and the server. sanitizeDisplayName keeps the field clean per keystroke.
            maxLength={80}
            placeholder={ONBOARDING_COPY.placeholder}
            onChange={(e) => {
              setDraft(sanitizeDisplayName(e.target.value));
              // Clear a stale error the moment the user edits, so the field is not scolding while
              // they fix it.
              if (errorReason !== null) setState(clearError());
            }}
          />
          {errorReason !== null && (
            <p className="m-0 text-1 text-danger-text" role="alert">
              {displayNameErrorOf(errorReason)}
            </p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button
          type="submit"
          variant="inverse"
          size="lg"
          className="w-full"
          disabled={!ready || saving}
        >
          {saving ? "Saving..." : ONBOARDING_COPY.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
