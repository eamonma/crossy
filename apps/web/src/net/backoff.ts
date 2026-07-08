// The PROTOCOL.md section 7 reconnect backoff: delays of 0, 1, 2, 4, 8, 16, then 30
// seconds, capped at 30, each with full jitter; reset after a connection survives
// 30 seconds. Pure and clock-free: the transport owns timers, this owns the numbers.

export const BACKOFF_BASE_SECONDS: readonly number[] = [0, 1, 2, 4, 8, 16, 30];

/** A connection that survives this long resets the schedule (PROTOCOL.md section 7). */
export const BACKOFF_RESET_AFTER_MS = 30_000;

export class BackoffSchedule {
  private attempt = 0;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** The next reconnect delay in milliseconds, consuming one attempt. Full jitter:
   * uniform in [0, base]. */
  nextDelayMs(): number {
    const index = Math.min(this.attempt, BACKOFF_BASE_SECONDS.length - 1);
    const base = BACKOFF_BASE_SECONDS[index] ?? 0;
    this.attempt += 1;
    return Math.round(this.random() * base * 1000);
  }

  reset(): void {
    this.attempt = 0;
  }

  /** Report how long the last connection lived; a long-enough life resets the walk. */
  connectionSurvived(ms: number): void {
    if (ms >= BACKOFF_RESET_AFTER_MS) this.reset();
  }
}
