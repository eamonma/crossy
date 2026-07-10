// Small data hooks shared by the shell and the home surfaces: a load-once resource with
// retry, and the access-token resolution (the `?token=` dogfood override wins, otherwise the
// identity port). Extracted from Home so the sidebar's recent-games list and the panels read
// through one mechanism instead of two hand-rolled copies.
import { useEffect, useState } from "react";
import type { Identity } from "../identity";

export type Resource<T> =
  { phase: "loading" } | { phase: "error" } | { phase: "ready"; data: T };

/** Load a resource when its loader is non-null, re-running on the listed deps or a reload(). */
export function useResource<T>(
  loader: (() => Promise<T>) | null,
  deps: React.DependencyList,
): [Resource<T>, () => void] {
  const [state, setState] = useState<Resource<T>>({ phase: "loading" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (loader === null) return;
    let live = true;
    setState({ phase: "loading" });
    loader()
      .then((data) => {
        if (live) setState({ phase: "ready", data });
      })
      .catch(() => {
        if (live) setState({ phase: "error" });
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
