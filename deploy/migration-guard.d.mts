// Types for migration-guard.mjs (plain node, no build step). Kept in sync by hand so
// packages/db's vitest suite can import the guard across the package boundary and still
// typecheck under `tsc --noEmit`. The runtime lives in migration-guard.mjs.

export interface DenyRule {
  name: string;
  pattern: RegExp;
}

export interface Violation {
  file: string;
  rules: string[];
}

export declare const DEFAULT_MIGRATIONS_DIR: string;
export declare const DENY_RULES: readonly DenyRule[];
export declare const ALLOWLIST: Map<string, string>;

export declare function stripNoise(sql: string): string;
export declare function scanSql(sql: string): string[];
export declare function scanMigrations(dir?: string): Violation[];
