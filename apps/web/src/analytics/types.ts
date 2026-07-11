// The Analytics port: the surface the rest of the web app consumes for product analytics.
// The app never imports posthog-js; it depends on this interface, so the vendor is swappable
// and testable (the Identity port pattern, DESIGN.md section 8). Two adapters implement it:
// the PostHog adapter (posthogAdapter.ts) and the no-op (noopAdapter.ts).
//
// INV-6 rides here two ways. Structurally: properties are flat scalars, so a board, a cell
// list, or any structured content is a compile error. By norm: a solution is a plain string
// and no type can bar it, so "never solutions" is ANALYTICS.md law, held by review and the
// INV-6 tests, not by the compiler.

/**
 * The events the web client emits: the client rows of the vocabulary in ANALYTICS.md.
 * Product vocabulary the port owns: a new event is a reviewed edit here and in
 * ANALYTICS.md, never an ad-hoc string at a call site.
 */
export type AnalyticsEvent = "app_opened" | "signed_in";

/**
 * Flat scalar properties only: counts, ids, flags. The type bars structured payloads (a
 * grid, a cell list); the "never letters, coordinates, or solutions" rule is ANALYTICS.md
 * law over the strings that remain (INV-6).
 */
export type AnalyticsProperties = Readonly<
  Record<string, string | number | boolean>
>;

export interface Analytics {
  /** Record a product event. Best-effort: a vendor fault never surfaces to the caller. */
  capture(event: AnalyticsEvent, properties?: AnalyticsProperties): void;

  /**
   * Bind subsequent events to a user. userId is always the provider-issued UUID, the same
   * id every foreign key points at (DESIGN.md section 8, ANALYTICS.md), so analytics joins
   * against the rest of the system without a mapping table.
   */
  identify(userId: string, traits?: AnalyticsProperties): void;

  /** Drop the bound identity on sign-out, so the next session starts unlinked. */
  reset(): void;
}
