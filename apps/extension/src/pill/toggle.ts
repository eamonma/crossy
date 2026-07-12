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
