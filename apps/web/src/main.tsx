import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./config/config";
import { bridgeIdentityToAnalytics, createAnalytics } from "./analytics";
import { createIdentity } from "./identity";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

// Boot: resolve the runtime config (config.json in the deployed image, VITE_ env or the mock
// in dev), build the identity and analytics ports from it, then finish any pending OAuth
// redirect before the first render so a returning user lands signed in. The bridge is wired
// before identity.load(), so the session that lands during load (an OAuth return, a restore)
// reaches analytics too; what each change cause captures is the bridge's call
// (identityBridge.ts, ANALYTICS.md).
async function boot(): Promise<void> {
  const config = await loadConfig();
  const identity = createIdentity(config);
  const analytics = createAnalytics(config);
  bridgeIdentityToAnalytics(identity, analytics);
  analytics.capture("app_opened");
  await identity.load();
  createRoot(rootEl as HTMLElement).render(
    <StrictMode>
      <App config={config} identity={identity} />
    </StrictMode>,
  );
}

void boot();
