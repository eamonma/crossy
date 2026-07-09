import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./config/config";
import { createIdentity } from "./identity";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

// Boot: resolve the runtime config (config.json in the deployed image, VITE_ env or the mock
// in dev), build the identity port from it, then finish any pending OAuth redirect before the
// first render so a returning user lands signed in.
async function boot(): Promise<void> {
  const config = await loadConfig();
  const identity = createIdentity(config);
  await identity.load();
  createRoot(rootEl as HTMLElement).render(
    <StrictMode>
      <App config={config} identity={identity} />
    </StrictMode>,
  );
}

void boot();
