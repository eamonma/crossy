// Auth surface (Track B). Discord OAuth is the live path tonight; anonymous guests exist
// behind config.guestsEnabled (gated by Turnstile) and light up with the flag without ever
// blocking on it. Email gets no surface, ever (product decision). The supabase vendor stays
// behind the Identity port; this file only consumes it.
//
// Two exports: SignInButtons (the prominent gate control) and AuthBar (the slim top-bar chip
// that shows the signed-in name plus a sign-out menu, or a compact sign-in button).
import { useEffect, useState } from "react";
import { ExitIcon, PersonIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity, IdentitySession } from "../identity";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GuestSignIn } from "./GuestSignIn";

/** The Discord glyph, self-hosted (no icon CDN); tinted to the current text color. */
function DiscordMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3c-.21.375-.455.88-.624 1.28a18.27 18.27 0 0 0-5.617 0A12.6 12.6 0 0 0 8.56 3a19.7 19.7 0 0 0-4.886 1.372C.533 9.045-.32 13.6.099 18.087a19.9 19.9 0 0 0 6.063 3.058c.492-.669.93-1.38 1.307-2.127a12.9 12.9 0 0 1-2.06-.99c.173-.127.342-.26.505-.395a14.2 14.2 0 0 0 12.174 0c.165.14.334.272.505.395-.657.388-1.35.72-2.063.991.377.746.815 1.457 1.307 2.126a19.8 19.8 0 0 0 6.067-3.058c.492-5.2-.838-9.71-3.594-13.718ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.955 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.947 2.419-2.157 2.419Z" />
    </svg>
  );
}

/**
 * The prominent sign-in control, for the landing gate and invite gates. Discord is always
 * shown; the guest path (Turnstile-gated) appears only when the flag and site key are both
 * set, and a refusal renders as one calm sentence, never a thrown error or an error code.
 */
export function SignInButtons({
  identity,
  config,
  discordLabel = "Continue with Discord",
}: {
  identity: Identity;
  config: AppConfig;
  discordLabel?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  function onDiscord(): void {
    setNotice(null);
    void identity.signInWithDiscord().catch(() => {
      setNotice("Discord sign-in didn't go through. Give it another try.");
    });
  }

  const { turnstileSiteKey } = config;
  const guestReady = config.guestsEnabled && turnstileSiteKey !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="default"
        size="lg"
        onClick={onDiscord}
        className="w-full"
      >
        <DiscordMark />
        {discordLabel}
      </Button>
      {guestReady && turnstileSiteKey !== undefined && (
        <GuestSignIn
          identity={identity}
          siteKey={turnstileSiteKey}
          onNotice={setNotice}
        />
      )}
      {notice !== null && (
        <p className="text-2 text-danger-text" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

/**
 * The slim top-bar auth chip. Discord-only: the guest path needs room for the Turnstile
 * widget, so it lives on the prominent gate (SignInButtons) and not in this compact chip.
 * config is accepted for a stable call signature across every caller, unused here today.
 */
export function AuthBar({
  identity,
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
    void identity.signInWithDiscord().catch(() => {
      setNotice("Sign-in didn't go through.");
    });
  }

  if (session === null) {
    return (
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onDiscord}>
          <DiscordMark />
          Sign in
        </Button>
        {notice !== null && (
          <span className="text-1 text-danger-text">{notice}</span>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="pl-1.5">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gold-4 text-gold-11 text-1 font-medium">
            {session.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className="max-w-[10ch] truncate">{session.displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-text-muted">
          <PersonIcon className="text-text-subtle" />
          <span className="truncate">
            {session.displayName}
            {session.isAnonymous ? " (guest)" : ""}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void identity.signOut()}>
          <ExitIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
