// Spectate treatment (audit gap 8): not a parallel UI, just one deliberate signal over the exact
// board and toolbar a solver sees. The multiplayer cursor is the product, so a spectator still
// watches the same lively grid; input stays suppressed until they hold a solver seat.
//
// Two states share one dashed-underlined bar. A full account is one tap from solving, so it reads
// as an invitation to upgrade. A guest can never hold solver or host (DESIGN.md section 8, server
// FULL_ACCOUNT_REQUIRED), so the bar states the honest deal instead: watching is free, solving
// needs a Discord account, and the tap starts that sign-in. Copy never surfaces an error code.
export function SpectateBanner({
  guest,
  onUpgrade,
  onSignIn,
  upgrading,
  signingIn,
}: {
  /** True for a guest (or a stale client the server refused): show the sign-in deal, not upgrade. */
  guest: boolean;
  onUpgrade: () => void;
  onSignIn: () => void;
  upgrading: boolean;
  signingIn: boolean;
}) {
  if (guest) {
    return (
      <button
        type="button"
        onClick={onSignIn}
        disabled={signingIn}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gold-3 border-b border-dashed border-border-dashed text-2 disabled:opacity-70"
      >
        <span className="text-text-muted">
          {signingIn ? "Taking you to Discord..." : "Watching is free."}
        </span>
        {!signingIn && (
          <span className="font-medium text-text underline decoration-dashed underline-offset-4">
            Sign in with Discord to solve
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onUpgrade}
      disabled={upgrading}
      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gold-3 border-b border-dashed border-border-dashed text-2 disabled:opacity-70"
    >
      <span className="text-text-muted">
        {upgrading ? "Joining as a solver..." : "You're watching."}
      </span>
      {!upgrading && (
        <span className="font-medium text-text underline decoration-dashed underline-offset-4">
          Tap to join as a solver
        </span>
      )}
    </button>
  );
}
