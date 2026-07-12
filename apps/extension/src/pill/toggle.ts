// The per-site pill toggle, default on (D22). Disabling is per publisher site, set
// from the pill's own dismiss affordance; re-enabling lives in the options page.
// chrome.storage.local, same area as every other extension setting.

export type PillSite = "guardian" | "nyt";

export const PILL_DISABLED_KEY = "pillDisabled";

const SITES: readonly PillSite[] = ["guardian", "nyt"];

/** Sites the solver hid the pill on; absence means the pill shows (default on). */
export type PillDisabled = Readonly<Partial<Record<PillSite, true>>>;

/** Validate the stored shape; anything unrecognized reads as nothing disabled. */
export function parsePillDisabled(raw: unknown): PillDisabled {
  if (typeof raw !== "object" || raw === null) return {};
  const disabled: Partial<Record<PillSite, true>> = {};
  for (const site of SITES) {
    if ((raw as Record<string, unknown>)[site] === true) disabled[site] = true;
  }
  return disabled;
}

export async function loadPillDisabled(): Promise<PillDisabled> {
  const stored = await chrome.storage.local.get(PILL_DISABLED_KEY);
  return parsePillDisabled(stored[PILL_DISABLED_KEY]);
}

export async function setPillDisabled(
  site: PillSite,
  disabled: boolean,
): Promise<void> {
  const current = await loadPillDisabled();
  const next: Partial<Record<PillSite, true>> = { ...current };
  if (disabled) next[site] = true;
  else delete next[site];
  await chrome.storage.local.set({ [PILL_DISABLED_KEY]: next });
}

/**
 * The PillSite a page URL carries a pill for, or null. Scoped to exactly where the
 * pill content scripts run (manifest matches): Guardian crossword pages on
 * theguardian.com, NYT game pages under www.nytimes.com/crosswords/game. AmuseLabs
 * runs inside the publisher iframe and grows no pill (D22), so it is never a site
 * here. Pure so the popup can decide the re-summon control off the active tab.
 */
export function pillSiteForUrl(url: string): PillSite | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  if (
    (host === "www.theguardian.com" || host === "theguardian.com") &&
    parsed.pathname.startsWith("/crosswords/")
  ) {
    return "guardian";
  }
  if (
    host === "www.nytimes.com" &&
    parsed.pathname.startsWith("/crosswords/game/")
  ) {
    return "nyt";
  }
  return null;
}

/**
 * The re-summon decision: the PillSite whose hidden on-page button the popup should
 * offer to show, or null. Only a pill site whose pill this solver has hidden earns
 * the control; a pill site still showing, or any non-pill page, earns nothing.
 */
export function pillReSummonSite(
  url: string,
  disabled: PillDisabled,
): PillSite | null {
  const site = pillSiteForUrl(url);
  if (site === null || disabled[site] !== true) return null;
  return site;
}
