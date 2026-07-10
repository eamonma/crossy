// Screen wake lock for the party projector: a TV or laptop parked on the party view must never
// dim or sleep mid-solve. The Screen Wake Lock API is feature-detected (support is uneven, notably
// on older Safari) and re-requested on `visibilitychange`, because the browser releases the
// sentinel whenever the tab is hidden or the device locks; a released sentinel is nulled so the
// next return to visibility reacquires it. The request can reject (the page is not visible, or a
// permissions policy forbids it), so every call is guarded and a failure quietly leaves the
// screen on its default timeout rather than throwing into render. Read-only: no store, no writes.
import { useEffect } from "react";

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async (): Promise<void> => {
      // request() rejects if the document is not visible; only ask when it is.
      if (document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
        // The browser auto-releases on tab-hide or lock; drop our handle so a later
        // return to visibility knows to reacquire instead of assuming it still holds one.
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        // Not visible, or blocked by policy: leave the default screen timeout in place.
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState === "visible" && sentinel === null) {
        void request();
      }
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const held = sentinel;
      sentinel = null;
      if (held !== null) void held.release();
    };
  }, [active]);
}
