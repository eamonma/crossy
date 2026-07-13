// "Continue another way": the quiet tertiary path off the provider buttons, and the modal it opens.
// Two ways in: Hisbaan (a custom OIDC provider, the same OAuth machinery as Apple/Discord) and an
// email one-time code. Self-contained so it drops into every gate SignInButtons renders (the
// landing, the create gate, the invite gate, the spectate banner) without shifting those layouts:
// the trigger is one subdued link, the rest lives in a portal Dialog.
//
// Success is never read from a verify return (the port returns no session, types.ts): a verified
// session lands through identity.onChange exactly like OAuth. This component subscribes to that and
// closes itself the moment a session appears, so the app re-renders authenticated on its own.
//
// The email send is captcha-gated when the project's Turnstile protection is on (GoTrue rejects
// /otp with captcha_failed otherwise): the email step renders an invisible Turnstile (the same
// managed widget GuestSignIn uses, appearance "interaction-only"), captures the single-use token
// via onSuccess, and threads it into sendEmailOtp. The token is reset before each send and resend
// so every request carries a fresh one. When no site key is configured (dev/local, mock) the
// widget is skipped and the send goes through with no token, so those paths still work.
import { useEffect, useRef, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import type { Identity } from "../identity";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOtpFlowMarker } from "./otpFlowMarker";
import type { OtpEmailState } from "./otpModalMachine";
import {
  backToEmail,
  initialEmailState,
  isCompleteCode,
  isPlausibleEmail,
  sanitizeCode,
  sendFailed,
  toCodeEntry,
  toSending,
  toVerifying,
  verifyFailed,
} from "./otpModalMachine";

/** The resend cooldown: long enough to not hammer the provider's rate limit, short enough to not
 *  strand a user whose first mail never arrived. */
const RESEND_COOLDOWN_SEC = 45;

/**
 * The subdued trigger plus its modal. Rendered by SignInButtons below the primary buttons.
 * `turnstileSiteKey` comes from config, threaded down to the email step so the captcha-gated send
 * carries a token; it is undefined in dev/local, where the send goes through without one.
 */
export function ContinueAnotherWay({
  identity,
  turnstileSiteKey,
}: {
  identity: Identity;
  turnstileSiteKey?: string | undefined;
}) {
  const [open, setOpen] = useState(false);

  // Close the moment a session lands, however it landed (the Hisbaan redirect returns to a fresh
  // page, so that path closes by unmount; this covers the email verify, which resolves in place).
  useEffect(
    () =>
      identity.onChange((session) => {
        if (session !== null) setOpen(false);
      }),
    [identity],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* A subdued ghost link, visually subordinate to the provider buttons and consistent with the
          calm "or" / guest treatment: no icon, muted text, centered under the tray. */}
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="text-text-subtle hover:text-text-muted"
          onClick={() => setOpen(true)}
        >
          Continue another way
        </Button>
      </div>
      <DialogContent className="sm:max-w-sm">
        <ContinueAnotherWayBody
          identity={identity}
          open={open}
          turnstileSiteKey={turnstileSiteKey}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The modal body, remounted per open (keyed on `open` by the parent's conditional content) so it
 * always opens on the chooser with no stale email or code. Two paths: Hisbaan, and the email code
 * sub-flow driven by the pure machine in otpModalMachine.ts.
 */
function ContinueAnotherWayBody({
  identity,
  open,
  turnstileSiteKey,
}: {
  identity: Identity;
  open: boolean;
  turnstileSiteKey?: string | undefined;
}) {
  // "chooser" is the two-path menu; once the user picks email we hand off to the machine's states.
  const [mode, setMode] = useState<"chooser" | "email">("chooser");
  const [hisbaanBusy, setHisbaanBusy] = useState(false);
  const [state, setState] = useState<OtpEmailState>(initialEmailState);

  // Reset to the chooser every time the modal reopens, so a reopened modal never resumes a half
  // typed code from a dismissed attempt.
  useEffect(() => {
    if (open) {
      setMode("chooser");
      setHisbaanBusy(false);
      setState(initialEmailState);
    }
  }, [open]);

  function onHisbaan(): void {
    setHisbaanBusy(true);
    // Redirects the page; a failure to even start (rare) drops the busy state so the button is live
    // again. No in-modal success state: the return lands on a fresh page and the app boots signed in.
    void identity
      .signInWithProvider("hisbaan")
      .catch(() => setHisbaanBusy(false));
  }

  if (mode === "chooser") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Continue another way</DialogTitle>
          <DialogDescription>
            Sign in with Hisbaan, or get a one-time code by email.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2.5">
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            disabled={hisbaanBusy}
            onClick={onHisbaan}
          >
            {hisbaanBusy ? "Redirecting..." : "Continue with Hisbaan"}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => setMode("email")}
          >
            Continue with email
          </Button>
        </div>
      </>
    );
  }

  return (
    <EmailFlow
      identity={identity}
      state={state}
      setState={setState}
      turnstileSiteKey={turnstileSiteKey}
    />
  );
}

/** The email sub-flow: address entry, then the eight-digit code, with resend and a back action. */
function EmailFlow({
  identity,
  state,
  setState,
  turnstileSiteKey,
}: {
  identity: Identity;
  state: OtpEmailState;
  setState: (next: OtpEmailState) => void;
  turnstileSiteKey?: string | undefined;
}) {
  const [emailDraft, setEmailDraft] = useState("");
  const [codeDraft, setCodeDraft] = useState("");
  const [cooldown, setCooldown] = useState(0);
  // The latest Turnstile token, or null before one has arrived (or after a reset). Only meaningful
  // when a site key is configured; with no key the send never waits on it.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance | undefined>(undefined);
  const captchaGated = turnstileSiteKey !== undefined;

  // The resend cooldown ticks down once per second while it is above zero. It arms when a code is
  // first sent and after every resend, so the "Resend code" control is quiet until it is useful.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  async function requestCode(email: string): Promise<void> {
    // Snapshot and immediately clear the token: it is single-use, so once it is spent on this send
    // the next send (a resend) must wait on a fresh one. Reset the widget so it re-solves and hands
    // back a new token via onSuccess. With no site key there is no widget and no token to reset.
    const token = captchaToken;
    if (captchaGated) {
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    }
    setState(toSending(email));
    // Set the same-browser marker BEFORE sending, so a magic-link finish (even one that outraces
    // this resolve) finds the marker and verifies silently on /auth/confirm.
    setOtpFlowMarker(email);
    const result = await identity.sendEmailOtp(
      email,
      token !== null ? { captchaToken: token } : undefined,
    );
    if (result.ok) {
      setState(toCodeEntry(email));
      setCodeDraft("");
      setCooldown(RESEND_COOLDOWN_SEC);
    } else {
      setState(sendFailed(result.reason));
    }
  }

  async function submitCode(email: string, code: string): Promise<void> {
    setState(toVerifying(email));
    const result = await identity.verifyEmailOtp({ email, token: code });
    // On ok nothing to do here: the session lands through identity.onChange and the modal closes
    // itself (ContinueAnotherWay's subscription). Only a failure needs handling.
    if (!result.ok) setState(verifyFailed(email, result.reason));
  }

  // The invisible captcha, rendered inside the email step when a site key is configured. Appearance
  // "interaction-only" keeps Cloudflare's managed box out of sight and out of the layout: the token
  // arrives on its own through onSuccess in the common case, and the box only surfaces if Cloudflare
  // forces an interactive challenge. A width-zero, height-zero container keeps it off the layout.
  const captcha =
    turnstileSiteKey !== undefined ? (
      <div aria-hidden className="h-0 w-0 overflow-hidden">
        <Turnstile
          ref={turnstileRef}
          siteKey={turnstileSiteKey}
          onSuccess={(token) => setCaptchaToken(token)}
          onExpire={() => setCaptchaToken(null)}
          onError={() => setCaptchaToken(null)}
          options={{ size: "compact", appearance: "interaction-only" }}
        />
      </div>
    ) : null;
  // With a site key, the send waits on a fresh token; with none, it never does. Cleared to null on
  // spend/expire/error, so the button re-disables until the widget hands back a new one.
  const captchaReady = !captchaGated || captchaToken !== null;

  if (state.step === "emailEntry" || state.step === "sending") {
    const sending = state.step === "sending";
    const ready = isPlausibleEmail(emailDraft);
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || sending || !captchaReady) return;
          void requestCode(emailDraft.trim());
        }}
      >
        <DialogHeader>
          <DialogTitle>Continue with email</DialogTitle>
          <DialogDescription>
            We'll send a one-time code to your inbox.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-3">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={emailDraft}
            disabled={sending}
            onChange={(e) => setEmailDraft(e.target.value)}
            aria-label="Email address"
          />
          {state.step === "emailEntry" && state.error !== null && (
            <p className="m-0 text-2 text-danger-text" role="status">
              {state.error}
            </p>
          )}
          <Button
            type="submit"
            variant="inverse"
            size="lg"
            className="w-full"
            disabled={!ready || sending || !captchaReady}
          >
            {sending ? "Sending..." : "Send code"}
          </Button>
        </div>
        {captcha}
      </form>
    );
  }

  // codeEntry or verifying: both show the code field; verifying only disables it.
  const email = state.email;
  const verifying = state.step === "verifying";
  const ready = isCompleteCode(codeDraft);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || verifying) return;
        void submitCode(email, sanitizeCode(codeDraft));
      }}
    >
      <DialogHeader>
        <DialogTitle>Enter your code</DialogTitle>
        <DialogDescription>We sent a code to {email}.</DialogDescription>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-3">
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={8}
          placeholder="00000000"
          value={codeDraft}
          disabled={verifying}
          onChange={(e) => setCodeDraft(sanitizeCode(e.target.value))}
          aria-label="Eight-digit code"
          className="text-center text-5 tracking-[0.4em] tabular-nums"
        />
        {state.step === "codeEntry" && state.error !== null && (
          <p className="m-0 text-2 text-danger-text" role="status">
            {state.error}
          </p>
        )}
        <Button
          type="submit"
          variant="inverse"
          size="lg"
          className="w-full"
          disabled={!ready || verifying}
        >
          {verifying ? "Verifying..." : "Verify"}
        </Button>
        <div className="flex items-center justify-between text-1 text-text-subtle">
          <button
            type="button"
            className="hover:text-text-muted disabled:opacity-50"
            disabled={cooldown > 0 || verifying || !captchaReady}
            onClick={() => void requestCode(email)}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          <button
            type="button"
            className="hover:text-text-muted disabled:opacity-50"
            disabled={verifying}
            onClick={() => {
              setCodeDraft("");
              setState(backToEmail());
            }}
          >
            Use a different email
          </button>
        </div>
      </div>
      {captcha}
    </form>
  );
}
