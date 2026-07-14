// The React seam for the personal reaction set (Wave 8.4; PROTOCOL.md §12): resolve the session's
// `reactionSet` into the ordered options + key lookups the tray, the HUD, and the key handler
// consume, and stay live. The identity adapter is the single holder of the value (it adopts the
// /me set on loadProfile and after a PATCH, firing onChange("refreshed")), so this hook only
// subscribes and resolves; it fetches nothing. A signed-out surface (the `?token=` dogfood
// override, the demo) reads null and gets the defaults, the same rule the wire contract sets.
import { useEffect, useMemo, useState } from "react";
import type { Identity } from "../identity";
import { resolveReactionSet } from "./reactionSet";
import type { ResolvedReactionSet } from "./reactionSet";

export function usePersonalReactionSet(
  identity: Identity,
): ResolvedReactionSet {
  const [personal, setPersonal] = useState<readonly string[] | null>(
    () => identity.getSession()?.reactionSet ?? null,
  );
  useEffect(
    () =>
      identity.onChange((session) => {
        // The adapter re-emits the same array reference until the set actually changes, so this
        // setState is a no-op re-render-wise on token refreshes and same-user re-emissions.
        setPersonal(session?.reactionSet ?? null);
      }),
    [identity],
  );
  return useMemo(() => resolveReactionSet(personal), [personal]);
}
