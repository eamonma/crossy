/**
 * Boundary rules per DESIGN.md §4: dependencies point inward only. This file is the
 * entire layering ceremony; a violation fails `pnpm lint` and therefore CI.
 */
module.exports = {
  forbidden: [
    {
      name: "engine-is-pure",
      comment:
        "INV-9: packages/engine imports nothing outside itself — no workspace packages, " +
        "no npm deps, no node builtins. Timestamps and identity arrive as data " +
        "(DESIGN.md §4, §12). Test files may import vitest.",
      severity: "error",
      from: { path: "^packages/engine/src", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^packages/engine/src" },
    },
    {
      name: "protocol-is-standalone",
      comment:
        "packages/protocol may use npm deps (schema tooling) but never workspace code: " +
        "it is the contract everything else depends on.",
      severity: "error",
      from: { path: "^packages/protocol/src" },
      to: { path: "^(packages/(?!protocol/)|apps/)" },
    },
    {
      name: "no-package-imports-app",
      comment: "Inner rings never import outward (DESIGN.md §4).",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-app-cross-imports",
      comment:
        "Apps are independent deployables; they share code via packages/* only.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "supabase-js-only-in-identity-adapter",
      comment:
        "Only the web identity adapter (apps/web/src/identity) may import supabase-js; the " +
        "rest of the app consumes the Identity port, so the vendor stays swappable " +
        "(DESIGN.md §8).",
      severity: "error",
      from: { path: "^apps/web/src", pathNot: "^apps/web/src/identity/" },
      to: { path: "node_modules/@supabase/supabase-js" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
