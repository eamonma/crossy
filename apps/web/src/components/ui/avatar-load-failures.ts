// Session-lifetime negative cache for avatar image srcs. Server-resolved avatars can
// point at Gravatar with d=404, and PROTOCOL.md section 4 treats a load error as
// absence: the fallback initial renders. Radix's Avatar.Image re-attempts the load on
// every mount, and roster rows, toolbar presence, and check-vote chips remount
// constantly, so without a shared memory one missing avatar 404s forever for every
// viewer. Dependency-free and node-testable; the subscribe/getSnapshot surface is
// shaped for React.useSyncExternalStore.

export function createAvatarLoadFailureStore() {
  const failed = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    hasFailed(src: string): boolean {
      return failed.has(src);
    },
    recordFailure(src: string): void {
      if (failed.has(src)) return;
      failed.add(src);
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const store = createAvatarLoadFailureStore();

export const hasAvatarLoadFailed = store.hasFailed;
export const recordAvatarLoadFailure = store.recordFailure;
export const subscribeAvatarLoadFailures = store.subscribe;
