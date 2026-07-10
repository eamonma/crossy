// Small data hooks shared by the shell and the home surfaces: a stale-while-revalidate
// resource with retry, and the access-token resolution (the `?token=` dogfood override wins,
// otherwise the identity port). Extracted from Home so the sidebar's recent-games list and
// the panels read through one mechanism instead of two hand-rolled copies.
import { useEffect, useState } from "react";
import type { Identity } from "../identity";

export type Resource<T> =
  { phase: "loading" } | { phase: "error" } | { phase: "ready"; data: T };

/**
 * Load a resource when its loader is non-null, re-running on the listed deps or a reload().
 * Stale-while-revalidate: a re-run keeps the data it already has and refreshes it quietly,
 * so only the first load (or a load after an error) surfaces the loading state, and a
 * failed refresh keeps the stale rows instead of blanking them. The sidebar's recents
 * depend on this: the router re-reads on every surface change, and each read must not
 * flash skeletons over a list that is already on screen.
 */
export function useResource<T>(
  loader: (() => Promise<T>) | null,
  deps: React.DependencyList,
): [Resource<T>, () => void] {
  const [state, setState] = useState<Resource<T>>({ phase: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (loader === null) {
      // Losing the loader means signed out (or the token is gone): drop the data so a
      // later sign-in never shows another session's rows while its first read runs.
      setState({ phase: "loading" });
      return;
    }
    let live = true;
    setState((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    loader()
      .then((data) => {
        if (live) setState({ phase: "ready", data });
      })
      .catch(() => {
        if (live)
          setState((prev) =>
            prev.phase === "ready" ? prev : { phase: "error" },
          );
      });
    return () => {
      live = false;
    };
    // loader is recreated each render; the primitive deps below drive re-runs.
  }, [...deps, nonce]);
  return [state, () => setNonce((n) => n + 1)];
}

/**
 * The bearer token for REST reads: undefined while unresolved, then the `?token=` override
 * (dogfood and the dev stack) or the identity session's access token (null when signed out).
 */
export function useAccessToken(
  identity: Identity,
  urlToken: string | null,
): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(
    urlToken !== null ? urlToken : undefined,
  );
  useEffect(() => {
    if (urlToken !== null) {
      setToken(urlToken);
      return;
    }
    let live = true;
    void identity.getAccessToken().then((t) => {
      if (live) setToken(t);
    });
    return () => {
      live = false;
    };
  }, [identity, urlToken]);
  return token;
}
