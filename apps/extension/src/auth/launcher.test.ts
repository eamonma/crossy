import { describe, expect, it } from "vitest";

import { PendingCaptures } from "./callback";
import type { IdentityLike } from "./launcher";
import { identityLauncher, tabRedirectLauncher } from "./launcher";

const CALLBACK = "https://crossy.party/auth/ext/callback";

/** Let capture()'s `await createTab` settle and its register()/startTimer run. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("identityLauncher (Chrome, Firefox)", () => {
  it("uses identity.getRedirectURL and passes the interactive flag straight through", async () => {
    const calls: Array<{ url: string; interactive: boolean }> = [];
    const identity: IdentityLike = {
      getRedirectURL: () => "https://abc.chromiumapp.org/",
      launchWebAuthFlow: async ({ url, interactive }) => {
        calls.push({ url, interactive });
        return `${url}#code=x`;
      },
    };
    const launcher = identityLauncher(identity);
    expect(launcher.redirectUri).toBe("https://abc.chromiumapp.org/");
    await expect(
      launcher.capture("https://api/authorize", false),
    ).resolves.toBe("https://api/authorize#code=x");
    expect(calls).toEqual([
      { url: "https://api/authorize", interactive: false },
    ]);
  });
});

describe("tabRedirectLauncher (Safari)", () => {
  function harness(
    overrides: { createTab?: () => Promise<number | undefined> } = {},
  ) {
    const pending = new PendingCaptures();
    const created: string[] = [];
    const removed: number[] = [];
    let fire: () => void = () => undefined;
    let timerCancelled = false;
    const launcher = tabRedirectLauncher({
      redirectUri: CALLBACK,
      pending,
      createTab:
        overrides.createTab ??
        (async (url) => {
          created.push(url);
          return 42;
        }),
      removeTab: async (id) => {
        removed.push(id);
      },
      timeoutMs: 1000,
      startTimer: (_ms, onFire) => {
        fire = onFire;
        return () => {
          timerCancelled = true;
        };
      },
    });
    return {
      launcher,
      pending,
      created,
      removed,
      triggerTimeout: () => fire(),
      wasTimerCancelled: () => timerCancelled,
    };
  }

  it("opens no tab and resolves undefined for a silent (interactive:false) attempt", async () => {
    const h = harness();
    await expect(
      h.launcher.capture("https://api/authorize", false),
    ).resolves.toBeUndefined();
    expect(h.created).toEqual([]);
    expect(h.removed).toEqual([]);
  });

  it("opens the auth tab, resolves the delivered redirect, then closes the tab", async () => {
    const h = harness();
    const capture = h.launcher.capture("https://api/authorize", true);
    await flush();
    expect(h.created).toEqual(["https://api/authorize"]);
    expect(h.pending.deliver(42, `${CALLBACK}?code=abc`)).toBe(true);
    await expect(capture).resolves.toBe(`${CALLBACK}?code=abc`);
    expect(h.removed).toEqual([42]);
    expect(h.wasTimerCancelled()).toBe(true);
  });

  it("resolves undefined and closes the tab when the timeout fires first", async () => {
    const h = harness();
    const capture = h.launcher.capture("https://api/authorize", true);
    await flush();
    h.triggerTimeout();
    await expect(capture).resolves.toBeUndefined();
    expect(h.removed).toEqual([42]);
  });

  it("resolves undefined and opens nothing further when no tab id comes back", async () => {
    const h = harness({ createTab: async () => undefined });
    await expect(
      h.launcher.capture("https://api/authorize", true),
    ).resolves.toBeUndefined();
    expect(h.removed).toEqual([]);
  });
});
