// A minimal, plainly styled auth affordance: sign in with Discord, sign out, and (only when
// guests are enabled in config) continue as a guest. A full UI pass lands in a later track;
// this is the smallest usable surface plus OAuth return handling (identity.load runs at boot).
import { useEffect, useState } from "react";
import type { AppConfig } from "../config/config";
import type { Identity, IdentitySession } from "../identity";

export function AuthBar({
  identity,
  config,
}: {
  identity: Identity;
  config: AppConfig;
}) {
  const [session, setSession] = useState<IdentitySession | null>(() =>
    identity.getSession(),
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => identity.onChange(setSession), [identity]);

  function onDiscord(): void {
    setNotice(null);
    void identity.signInWithDiscord().catch((err: unknown) => {
      setNotice(`Discord sign-in failed: ${String(err)}`);
    });
  }

  function onGuest(): void {
    setNotice(null);
    void identity.signInGuest().then((result) => {
      if (!result.ok) setNotice(`Guest sign-in unavailable: ${result.message}`);
    });
  }

  function onSignOut(): void {
    setNotice(null);
    void identity.signOut();
  }

  return (
    <div className="authbar">
      {session === null ? (
        <>
          <button type="button" className="authbar__btn" onClick={onDiscord}>
            Sign in with Discord
          </button>
          {config.guestsEnabled && (
            <button type="button" className="authbar__btn" onClick={onGuest}>
              Continue as guest
            </button>
          )}
        </>
      ) : (
        <>
          <span className="authbar__who">
            Signed in as {session.displayName}
            {session.isAnonymous ? " (guest)" : ""}
          </span>
          <button type="button" className="authbar__btn" onClick={onSignOut}>
            Sign out
          </button>
        </>
      )}
      {notice !== null && <span className="authbar__notice">{notice}</span>}
    </div>
  );
}
