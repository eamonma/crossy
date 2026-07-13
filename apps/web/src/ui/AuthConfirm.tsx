// The magic-link landing (`/auth/confirm`). A code-or-link email carries a link here with
// `token_hash` and `type` on the query string. Whether we verify it silently turns on the
// same-browser marker (otpFlowMarker): a link clicked in the SAME browser that started the flow is
// this device finishing its own sign-in, so we verify at once (the Claude.ai behavior). A link
// opened in a DIFFERENT browser (a phone tap of a link the desktop requested) is not auto-verified:
// signing in the wrong device is the failure mode this gate exists to prevent. We show calm
// guidance to finish on the original device with the code, plus one explicit escape hatch to sign
// in here anyway.
//
// Success lands through identity.onChange like every other sign-in, so the marker is cleared and
// the app is sent home; nothing reads a session from the verify return (types.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import type { Identity } from "../identity";
import type { Navigate } from "../nav";
import { homeHref } from "../nav";
import { TopBar } from "./TopBar";
import { Button } from "@/components/ui/button";
import type { AppConfig } from "../config/config";
import { clearOtpFlowMarker, hasOtpFlowMarker } from "./otpFlowMarker";
import { otpReasonMessage } from "./otpModalMachine";

/** The verify lifecycle on this page. `guidance` is the cross-device state: no marker, so we wait
 *  for an explicit "sign in here anyway" rather than auto-verifying. `missing` is a malformed link
 *  with no token to verify. */
type ConfirmState =
  | { step: "verifying" }
  | { step: "guidance" }
  | { step: "missing" }
  | { step: "error"; message: string };

export function AuthConfirm({
  identity,
  config,
  params,
  navigate,
}: {
  identity: Identity;
  config: AppConfig;
  params: URLSearchParams;
  navigate: Navigate;
}) {
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const hasToken = tokenHash !== null && tokenHash !== "";

  // The initial state is decided once, synchronously: a missing token is a dead link; a present
  // token with the marker verifies straight away; a present token without the marker waits on the
  // escape hatch. Computed in the initializer so the first paint is already correct.
  const [state, setState] = useState<ConfirmState>(() => {
    if (!hasToken) return { step: "missing" };
    return hasOtpFlowMarker() ? { step: "verifying" } : { step: "guidance" };
  });

  // True only when we entered on the same-browser (marker present) path, which starts in
  // "verifying": the effect below then kicks the one auto-verify. The cross-device path starts in
  // "guidance" and waits for the explicit escape hatch instead.
  const autoVerify = useRef(state.step === "verifying");

  // A verified session sends the app home. onChange is the single success path (OAuth and email
  // both), so this is where the confirm route leaves for the app, clearing the marker on the way.
  useEffect(
    () =>
      identity.onChange((session) => {
        if (session !== null) {
          clearOtpFlowMarker();
          navigate(homeHref(params));
        }
      }),
    [identity, navigate, params],
  );

  // Guard the verify against StrictMode's double-invoke and a manual escape-hatch re-entry, so the
  // same token is never verified twice. A useCallback keeps it a stable effect dependency.
  const verifying = useRef(false);

  const verify = useCallback(async (): Promise<void> => {
    if (verifying.current || tokenHash === null) return;
    verifying.current = true;
    setState({ step: "verifying" });
    const result = await identity.verifyEmailLink({
      tokenHash,
      type: type ?? "email",
    });
    // On ok the onChange effect above navigates home; only a failure needs a message here.
    if (!result.ok) {
      verifying.current = false;
      setState({ step: "error", message: otpReasonMessage(result.reason) });
    }
  }, [identity, tokenHash, type]);

  // On the same-browser path (marker present) the initial state is already "verifying", so kick the
  // verify off once. The ref keeps it idempotent under StrictMode's double mount; the escape hatch
  // calls the same verify for the cross-device path.
  useEffect(() => {
    if (autoVerify.current) {
      autoVerify.current = false;
      void verify();
    }
  }, [verify]);

  return (
    <div className="min-h-dvh flex flex-col">
      <TopBar identity={identity} config={config} />
      <main className="flex-1 grid place-items-center p-4 py-8 sm:py-12">
        <div className="w-full max-w-sm rounded-6 border border-border bg-panel p-7 shadow-xl">
          <ConfirmBody
            state={state}
            onVerifyHere={() => void verify()}
            onHome={() => navigate(homeHref(params))}
          />
        </div>
      </main>
    </div>
  );
}

function ConfirmBody({
  state,
  onVerifyHere,
  onHome,
}: {
  state: ConfirmState;
  onVerifyHere: () => void;
  onHome: () => void;
}) {
  if (state.step === "verifying") {
    return (
      <div className="flex flex-col gap-2">
        <div className="font-display text-5 text-text">Signing you in...</div>
        <p className="m-0 text-2 text-text-muted">One moment.</p>
      </div>
    );
  }

  if (state.step === "guidance") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="font-display text-5 text-text">Almost there</div>
          <p className="m-0 text-2 text-text-muted">
            You started signing in on another device. Enter the code from your
            email there to finish.
          </p>
        </div>
        {/* The safety valve: this browser can take over the sign-in if the original device is gone. */}
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={onVerifyHere}
        >
          Sign in on this device instead
        </Button>
      </div>
    );
  }

  if (state.step === "missing") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="font-display text-5 text-text">Link incomplete</div>
          <p className="m-0 text-2 text-text-muted">
            This sign-in link is missing part of its address. Open it again from
            your email, or start over.
          </p>
        </div>
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={onHome}
        >
          Back to sign in
        </Button>
      </div>
    );
  }

  // error
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="font-display text-5 text-text">
          That didn't go through
        </div>
        <p className="m-0 text-2 text-text-muted">{state.message}</p>
      </div>
      <Button variant="secondary" size="lg" className="w-full" onClick={onHome}>
        Back to sign in
      </Button>
    </div>
  );
}
