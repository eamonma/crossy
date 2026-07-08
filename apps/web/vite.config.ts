import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest config is folded into the Vite config so the playground has one source of
// truth. The navigation suite is pure (grid in, position out) and runs under the
// default node environment, so no jsdom/happy-dom dependency is pulled in.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
