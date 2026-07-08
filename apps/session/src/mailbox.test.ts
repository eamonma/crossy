// The mailbox is the mechanism behind INV-2: one game's state changes run
// single-threaded, so interleaved commands from many sockets get one total order. These
// unit tests prove it is a real serial queue, not a mutex-shaped hope: tasks run one at
// a time, in enqueue order, with no interleaving across `await` boundaries.

import { describe, expect, it } from "vitest";
import { Mailbox } from "./mailbox";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("Mailbox (INV-2: single-writer serialization)", () => {
  it("runs tasks in strict enqueue order (INV-2)", async () => {
    const mailbox = new Mailbox();
    const completed: number[] = [];
    const posted = [0, 1, 2, 3, 4].map((n) =>
      mailbox.post(async () => {
        // Later-posted tasks ask for a longer delay: without a queue they would finish
        // out of order. A real queue holds them to enqueue order regardless.
        await delay((5 - n) * 5);
        completed.push(n);
      }),
    );
    await Promise.all(posted);
    expect(completed).toEqual([0, 1, 2, 3, 4]);
  });

  it("never lets two tasks overlap across an await (INV-2)", async () => {
    const mailbox = new Mailbox();
    let running = false;
    let counter = 0;
    let maxConcurrent = 0;
    const tasks = Array.from({ length: 20 }, () =>
      mailbox.post(async () => {
        maxConcurrent = Math.max(maxConcurrent, running ? 2 : 1);
        expect(running).toBe(false);
        running = true;
        // A read-modify-write straddling an await: interleaving would lose updates.
        const seen = counter;
        await delay(1);
        counter = seen + 1;
        running = false;
      }),
    );
    await Promise.all(tasks);
    expect(counter).toBe(20);
    expect(maxConcurrent).toBe(1);
  });

  it("returns each task's resolved value to its poster", async () => {
    const mailbox = new Mailbox();
    const a = await mailbox.post(() => 41 + 1);
    const b = await mailbox.post(async () => {
      await delay(1);
      return "second";
    });
    expect(a).toBe(42);
    expect(b).toBe("second");
  });

  it("isolates a throwing task and keeps draining the queue (INV-2)", async () => {
    const mailbox = new Mailbox();
    const order: string[] = [];
    const first = mailbox.post(() => {
      order.push("first");
    });
    const boom = mailbox.post(() => {
      order.push("boom");
      throw new Error("task failed");
    });
    const third = mailbox.post(() => {
      order.push("third");
    });
    await expect(boom).rejects.toThrow("task failed");
    await Promise.all([first, third]);
    expect(order).toEqual(["first", "boom", "third"]);
  });
});
