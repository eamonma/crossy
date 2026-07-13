// Auth surface (Track B). OAuth providers are the live account paths; anonymous guests exist
// behind config.guestsEnabled (gated by Turnstile) and light up with the flag without ever
// blocking on it. Email gets no surface today (product decision). The supabase vendor stays
// behind the Identity port; this file only consumes it.
//
// Two exports: SignInButtons (the prominent gate control, its provider buttons rendered from
// one data-driven list so the landing and the invite gates can never diverge) and AuthBar (the
// slim top-bar affordance: the signed-in name plus a sign-out menu, or a single "Sign in" link
// that routes to the landing, where the provider choice is presented in full).
import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { ExitIcon, PersonIcon } from "@radix-ui/react-icons";
import type { AppConfig } from "../config/config";
import type { Identity, IdentitySession, SignInProvider } from "../identity";
import { Divider } from "./primitives";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { ContinueAnotherWay } from "./ContinueAnotherWay";

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

/** The Apple glyph, self-hosted (no icon CDN); tinted to the current text color. */
function AppleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M17.05 12.536c-.03-2.943 2.404-4.353 2.514-4.42-1.371-2.005-3.504-2.279-4.26-2.309-1.813-.183-3.54 1.068-4.458 1.068-.918 0-2.336-1.041-3.842-1.013-1.977.029-3.8 1.15-4.816 2.921-2.053 3.562-.525 8.83 1.474 11.72.977 1.414 2.141 3.001 3.667 2.944 1.472-.058 2.028-.953 3.807-.953 1.779 0 2.28.953 3.837.925 1.583-.029 2.585-1.442 3.552-2.861 1.119-1.643 1.579-3.234 1.606-3.317-.035-.016-3.083-1.184-3.114-4.695zM14.13 3.995c.812-.983 1.359-2.351 1.21-3.712-1.169.047-2.586.779-3.425 1.761-.752.871-1.411 2.263-1.234 3.598 1.303.101 2.636-.663 3.449-1.647z" />
    </svg>
  );
}

/**
 * The account providers, one ordered source of truth. Both the landing tray and every invite
 * gate render their buttons from this list, so they can never drift apart, and adding a provider
 * later (Google, a magic link, a passkey) is one entry here plus the matching `SignInProvider`
 * union member and adapter mapping, with no layout rewrite. `id` is the typed provider the port
 * signs in with (`identity.signInWithProvider(id)`); `order` is ascending, Apple first so its
 * button stays at least as prominent as any other, per Apple's own guidelines. `label` reads
 * "Sign in with X"; a caller may still override the verb per surface.
 */
interface ProviderSpec {
  readonly id: SignInProvider;
  readonly name: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly order: number;
}

const PROVIDERS: readonly ProviderSpec[] = [
  { id: "apple", name: "Apple", icon: AppleMark, order: 1 },
  { id: "discord", name: "Discord", icon: DiscordMark, order: 2 },
];

/** The providers in presentation order (ascending `order`); Apple leads. */
const orderedProviders: readonly ProviderSpec[] = [...PROVIDERS].sort(
  (a, b) => a.order - b.order,
);

/**
 * The prominent sign-in control, for the landing tray and the invite gates. The provider buttons
 * come from the one `PROVIDERS` list (Apple leads); the guest path (Turnstile-gated) appears
 * only when the flag and site key are both set, and a refusal renders as one calm sentence,
 * never a thrown error or an error code.
 *
 * `allowGuest` lets a caller suppress the guest path even when it is otherwise ready. The
 * invite gate uses it when no code is present: a guest without an invite would sign in
 * anonymously only to hit a 403 dead end, so we offer the account providers alone there
 * (DESIGN.md §8). The landing suppresses it too: a cold arrival has no room to watch yet.
 *
 * `verb` sets the button wording ("Sign in with X" on the landing and gates, "Continue with X"
 * where a surface prefers it), applied uniformly to every provider so the list stays the sole
 * shape.
 */
export function SignInButtons({
  identity,
  config,
  verb = "Continue",
  allowGuest = true,
}: {
  identity: Identity;
  config: AppConfig;
  verb?: string;
  allowGuest?: boolean;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  function onProvider(provider: ProviderSpec): void {
    setNotice(null);
    void identity.signInWithProvider(provider.id).catch(() => {
      setNotice(
        `${provider.name} sign-in didn't go through. Give it another try.`,
      );
    });
  }

  const { turnstileSiteKey } = config;
  const guestReady =
    allowGuest && config.guestsEnabled && turnstileSiteKey !== undefined;

  return (
    <div className="flex flex-col gap-2.5">
      {orderedProviders.map((provider) => {
        const Icon = provider.icon;
        return (
          <Button
            key={provider.id}
            variant="inverse"
            size="lg"
            onClick={() => onProvider(provider)}
            className="w-full"
          >
            <Icon />
            {verb} with {provider.name}
          </Button>
        );
      })}
      {guestReady && turnstileSiteKey !== undefined && (
        <>
          {/* The system's dashed rule carries the fork in the road; "or" sits in it. */}
          <div className="flex items-center gap-3" aria-hidden>
            <Divider className="m-0 flex-1" />
            <span className="text-1 text-text-subtle">or</span>
            <Divider className="m-0 flex-1" />
          </div>
          <GuestSignIn
            identity={identity}
            siteKey={turnstileSiteKey}
            onNotice={setNotice}
          />
        </>
      )}
      {notice !== null && (
        <p className="m-0 text-2 text-danger-text" role="status">
          {notice}
        </p>
      )}
      {/* The quiet tertiary path: Hisbaan or an email one-time code, in a self-contained modal so it
          drops into every gate this control renders without shifting the layout. Subordinate to the
          provider buttons by design, sitting a step below the guest "or" treatment. The site key
          threads through so the email send carries a captcha token when the project's captcha is on;
          it is undefined in dev/local, where the send goes through without one. */}
      <ContinueAnotherWay
        identity={identity}
        turnstileSiteKey={turnstileSiteKey}
      />
    </div>
  );
}

/**
 * The slim top-bar auth affordance. Signed in it is the avatar chip and its sign-out menu.
 * Signed out it renders nothing: every signed-out surface (the landing, the create and invite
 * gates) already carries its own inline sign-in, so a header link would only be a redundant
 * second one, and on an invite it would route away and drop the room. `config` is accepted for
 * a stable call signature across every caller, unused here today.
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

  useEffect(() => identity.onChange(setSession), [identity]);

  if (session === null) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="pl-1.5">
          {/* Reserved-box avatar: the fixed 20px Root holds the space, and the picture (when
              present) lays over the initial via the #93 overlay, so the chip never reflows when
              the image resolves after hydration. A null URL or a load error keeps the initial. */}
          <Avatar className="size-5">
            {session.avatarUrl !== null && (
              <AvatarImage src={session.avatarUrl} alt="" />
            )}
            <AvatarFallback className="bg-gold-4 text-gold-11 text-1 font-medium">
              {session.displayName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
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
