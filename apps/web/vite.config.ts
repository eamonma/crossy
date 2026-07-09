import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Vitest config is folded into the Vite config so the client has one source of truth.
// Tailwind v4 runs as a Vite plugin (no PostCSS config, no content globs: it scans the
// source itself). The navigation and store suites are pure and run under node, so no
// jsdom/happy-dom dependency is pulled in. The `@` alias mirrors tsconfig's paths entry;
// shadcn/ui's generated components import through it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
