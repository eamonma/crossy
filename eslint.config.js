import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-firefox/**",
      "**/coverage/**",
      ".claude/**",
      ".agents/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommended],
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
      },
    },
  },
  // The REST fetch fence (INV-11). Raw fetch() belongs only in the authenticated seam
  // (apps/web/src/net/authedFetch.ts), where a server 401 gets one refresh-and-retry so a stale
  // access token never surfaces the sign-in gate. Everywhere else in the web app a REST call must
  // ride that seam. This is the structural twin of INV-6's "structural, not runtime discipline":
  // the rule, not a reviewer, keeps the game loader (and future code) on the seam. Tests stub the
  // global directly and the seam itself owns the raw call, so both are excluded below.
  {
    files: ["apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"],
    ignores: [
      "apps/web/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
      "apps/web/src/net/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            "Route REST through the authedFetch seam (src/net/authedFetch.ts) so a 401 gets one refresh-and-retry (INV-11). Raw fetch() belongs only in src/net/. The unauthenticated config load uses globalThis.fetch by design.",
        },
      ],
    },
  },
);
