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
      name: "supabase-sdk-only-in-web-identity-adapter",
      comment:
        "The Supabase vendor SDK lives in exactly one place: the web Identity adapter " +
        "(apps/web/src/identity). Everything else consumes the Identity port so the vendor " +
        "stays swappable, and the server side verifies tokens with jose and must never grow " +
        "an SDK dependency (DESIGN.md §8). Fail-closed on two axes the old rule left open: " +
        "the whole @supabase/* namespace (not just supabase-js, so a stray @supabase/ssr or " +
        "@supabase/auth-js is caught too), and the whole repo (apps/* and packages/*, so an " +
        "import in apps/api, apps/session, or any package fails lint, not merely by " +
        "convention). Matching the bare `@supabase/` specifier also catches an import added " +
        "before the dependency is installed.",
      severity: "error",
      from: { path: "^(apps|packages)/", pathNot: "^apps/web/src/identity/" },
      to: { path: "@supabase/" },
    },
    {
      name: "posthog-sdk-only-in-analytics-adapters",
      comment:
        "The PostHog vendor SDK lives only in the Analytics adapter directories: " +
        "apps/web/src/analytics today, plus the session and API analytics dirs being " +
        "built on a parallel branch and forward-declared here on purpose. Everything " +
        "else consumes the Analytics port so the vendor stays swappable (ANALYTICS.md, " +
        "the identity port pattern, DESIGN.md §8). Fail-closed like the supabase rule " +
        "above: the browser SDK, the node SDK, and the whole @posthog/* namespace are " +
        "all barred repo-wide (apps/* and packages/*), so a stray import anywhere " +
        "outside an adapter dir fails lint, not merely by convention. The to-pattern " +
        "matches the package as a path segment, so it catches both the resolved " +
        "node_modules path of an installed dependency and the bare specifier of an " +
        "import added before the dependency is installed.",
      severity: "error",
      from: {
        path: "^(apps|packages)/",
        pathNot:
          "^apps/web/src/analytics/|^apps/session/src/analytics/|^apps/api/src/analytics/",
      },
      to: { path: "(^|/)(posthog-js|posthog-node|@posthog)(/|$)" },
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
