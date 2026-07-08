// The actor mailbox (DESIGN.md §3, §6): a real FIFO queue with a single drain loop, so
// one game's commands run strictly one at a time. This is what makes INV-2 hold. Two
// sockets sending interleaved commands post into one mailbox; the drain loop awaits each
// task before starting the next, so the seq assignment inside a task is a total order
// even when the work becomes asynchronous (the write-behind flush in Wave 2.2). It is a
// queue, not a lock: there is no shared mutable "locked" flag a caller can forget to
// take, and a task cannot start until the previous one has settled.

interface Envelope {
  run(): Promise<void>;
}

export class Mailbox {
  private readonly queue: Envelope[] = [];
  private draining = false;

  /**
   * Enqueue `task` and return a promise for its result. Tasks run in enqueue order, one
   * at a time; a task's rejection is delivered only to its own poster and does not stall
   * the queue.
   */
  post<T>(task: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run: async () => {
          try {
            resolve(await task());
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
      });
      void this.drain();
    });
  }

  /** How many tasks are waiting (excludes the one currently running). */
  get pending(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next === undefined) break;
        // Await settles the whole task before the next dequeues: serial by construction.
        await next.run();
      }
    } finally {
      this.draining = false;
    }
  }
}
