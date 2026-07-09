// Spectate treatment (audit gap 8): not a parallel UI, just one deliberate signal over the exact
// board and toolbar a solver sees. A dashed-underlined banner invites the one-tap self-upgrade to
// solver; input stays suppressed until then. The multiplayer cursor is the product, so a spectator
// still watches the same lively grid.
export function SpectateBanner({
  onUpgrade,
  upgrading,
}: {
  onUpgrade: () => void;
  upgrading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onUpgrade}
      disabled={upgrading}
      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gold-3 border-b border-dashed border-border-dashed text-3 text-text disabled:opacity-70"
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
