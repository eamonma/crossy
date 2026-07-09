// Run knobs (README "Bounded by default, deep on demand"). The default run count is
// small so `pnpm test` stays fast and deterministic on a fresh clone; SIM_RUNS deepens a
// loop and SIM_SEED pins it. When no seed is pinned, fast-check draws one and prints it on
// failure, which is the M2 exit criterion: a failure reproduces from a seed number.

import type { Parameters as FcParameters } from "fast-check";

function intFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be an integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * fast-check parameters for a property. `defaultRuns` is the bounded fresh-clone count;
 * SIM_RUNS overrides it, SIM_SEED pins the seed for a deterministic replay. Every property
 * ends on the first failure and shrinks (fast-check defaults), so the counterexample is
 * minimal and the seed reproduces it.
 */
export function simParams<T>(defaultRuns: number): FcParameters<T> {
  const numRuns = intFromEnv("SIM_RUNS") ?? defaultRuns;
  const seed = intFromEnv("SIM_SEED");
  return {
    numRuns,
    ...(seed !== undefined ? { seed } : {}),
    verbose: process.env.SIM_VERBOSE === "1" ? 2 : 0,
  };
}

/** Default run counts, kept in one place so the README can cite them. */
export const RUNS = {
  /** In-process property loops: fast, so a broad default. */
  inProcess: 60,
  /** Postgres-backed property (Testcontainers): bounded, since each run flushes for real. */
  postgres: 12,
} as const;
