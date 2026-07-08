// Minimal Playwright config for the M1 smoke: chromium only, headless, one worker (the
// tests are serial and share one Testcontainers Postgres and one pair of real services
// stood up in the spec's beforeAll). Not wired into `pnpm test`; run with `pnpm smoke`,
// which builds the web client first.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  reporter: [["list"]],
  // The whole flow (container boot, two services, two browsers, a service restart) is
  // slow; give each test room. beforeAll gets its own generous hook timeout in the spec.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
