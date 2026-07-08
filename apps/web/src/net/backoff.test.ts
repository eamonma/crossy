// PROTOCOL.md section 7: reconnect delays of 0, 1, 2, 4, 8, 16, then 30 seconds,
// capped at 30, each with full jitter; the schedule resets after a connection
// survives 30 seconds.
import { describe, expect, it } from "vitest";
import {
  BACKOFF_BASE_SECONDS,
  BACKOFF_RESET_AFTER_MS,
  BackoffSchedule,
} from "./backoff";

describe("reconnect backoff (PROTOCOL.md section 7)", () => {
  it("walks the section 7 base schedule 0, 1, 2, 4, 8, 16, 30 and caps at 30", () => {
    expect(BACKOFF_BASE_SECONDS).toEqual([0, 1, 2, 4, 8, 16, 30]);
    const schedule = new BackoffSchedule(() => 1); // jitter at its upper bound
    const delays = Array.from({ length: 9 }, () => schedule.nextDelayMs());
    expect(delays).toEqual([
      0, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });

  it("applies full jitter: each delay is uniform in [0, base]", () => {
    const schedule = new BackoffSchedule(() => 0.5);
    expect(schedule.nextDelayMs()).toBe(0); // base 0
    expect(schedule.nextDelayMs()).toBe(500); // base 1 s
    expect(schedule.nextDelayMs()).toBe(1000); // base 2 s
    expect(schedule.nextDelayMs()).toBe(2000); // base 4 s
  });

  it("jitter at zero yields zero without advancing differently", () => {
    const schedule = new BackoffSchedule(() => 0);
    schedule.nextDelayMs(); // base 0
    schedule.nextDelayMs(); // base 1
    expect(schedule.nextDelayMs()).toBe(0); // base 2, jitter 0
  });

  it("resets the schedule after a connection survives 30 seconds", () => {
    const schedule = new BackoffSchedule(() => 1);
    schedule.nextDelayMs();
    schedule.nextDelayMs();
    schedule.nextDelayMs(); // attempt 3 next: base would be 4 s
    schedule.connectionSurvived(BACKOFF_RESET_AFTER_MS);
    expect(schedule.nextDelayMs()).toBe(0); // back to the schedule's start
    expect(schedule.nextDelayMs()).toBe(1000);
  });

  it("does not reset when the connection died before 30 seconds", () => {
    const schedule = new BackoffSchedule(() => 1);
    schedule.nextDelayMs(); // 0
    schedule.nextDelayMs(); // 1 s
    schedule.connectionSurvived(BACKOFF_RESET_AFTER_MS - 1);
    expect(schedule.nextDelayMs()).toBe(2000); // schedule continues
  });

  it("reset() alone returns the walk to the start", () => {
    const schedule = new BackoffSchedule(() => 1);
    schedule.nextDelayMs();
    schedule.nextDelayMs();
    schedule.reset();
    expect(schedule.nextDelayMs()).toBe(0);
  });
});
