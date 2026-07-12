// Landing (/): the signed-out arrival, built as one object, the ticket. A card split into two
// stubs by a vertical dashed perforation with a round notch punched at top and bottom, so the
// halves read as one tearable ticket. The left stub is the pitch on the gold-cream feature face;
// the right stub, the tray, is the action on the plain panel face. There is exactly one sign-in
// on this page and it lives here, inline in the tray: the provider buttons (SignInButtons,
// AuthBar.tsx), the same control every gate uses, so a visitor never hunts for an account and
// the surface never contradicts itself. No "reveal" toggle, no second intent button: one sign-in
// serves a new host and a returning player alike, and routing sends each to the right place once
// the OAuth return lands. The header hides its sign-in link here (the page is the sign-in).
import type { AppConfig } from "../config/config";
import type { Identity } from "../identity";
import { TopBar } from "./TopBar";
import { CapsLabel } from "./primitives";
import { SignInButtons } from "./AuthBar";

export function Landing({
  identity,
  config,
}: {
  identity: Identity;
  config: AppConfig;
}) {
  return (
    <div className="min-h-dvh flex flex-col">
      {/* Signed out, the header carries no sign-in of its own: this page is the sign-in. */}
      <TopBar identity={identity} config={config} />
      <main className="flex-1 grid place-items-center p-4 py-8 sm:py-12">
        {/* The ticket. Two stubs held by a perforation; every arrival screen is a variant of
            this one object. It stacks to a single column below sm, where the perforation turns
            horizontal so the pitch still sits above the action. */}
        <div className="relative w-full max-w-[56rem] overflow-hidden rounded-6 border border-border-strong bg-panel shadow-xl grid grid-cols-1 sm:grid-cols-[1.15fr_0.85fr]">
          {/* The perforation: a dashed rule with a round notch punched at each end, so the two
              halves read as one tearable ticket. Horizontal while stacked, vertical from sm up.
              The notches are filled with the page background to read as holes cut through. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-[42%] border-t border-dashed border-border-dashed sm:left-[57.5%] sm:right-auto sm:top-0 sm:bottom-0 sm:border-t-0 sm:border-l"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong bg-background left-0 top-[42%] sm:left-[57.5%] sm:top-0"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong bg-background left-full top-[42%] sm:left-[57.5%] sm:top-full"
          />

          {/* The stub: the pitch, printed on the gold-cream feature face. */}
          <section className="flex flex-col justify-center bg-panel-feature p-7 sm:p-9">
            <CapsLabel className="font-mono text-text-accent">
              A collaborative crossword
            </CapsLabel>
            <h1 className="mt-3 font-display font-medium tracking-[-0.02em] text-gold-12 text-[clamp(2.4rem,4vw,3.4rem)] leading-[0.98]">
              One grid, everyone at once.
            </h1>
          </section>

          {/* The tray: the action, on the plain panel face. The one sign-in on the page, the same
              provider control every gate uses, inline with no toggle. No guest path on a cold
              landing (nothing to watch yet); the guest path stays on the invite gate. */}
          <section className="flex flex-col justify-center gap-4 p-7 sm:p-9">
            <div className="font-display text-6 text-text">Start a room</div>
            <SignInButtons
              identity={identity}
              config={config}
              verb="Sign in"
              allowGuest={false}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
