// The transient reaction model (ROADMAP Phase 7 Wave 7.3). It lives OUTSIDE the sequenced game
// store on purpose: a reaction is never sequenced, never persisted, and never in a snapshot
// (PROTOCOL.md §6, §9; DESIGN.md D24), so it must not touch reconciled store state, or a
// resync/reconnect would resurrect or clear-and-flash stickers. Sprites here decay on their own
// timers; the store fans an incoming notice in through subscribeReaction and sends a local one out
// through react(), but holds nothing about either. The class speaks plain data, so the tests drive
// it without React or a socket, the same shape as the game store.

/**
 * How long a sticker lives before it decays. Exported so the render layer and the model share one
 * number (Wave 7.3 exit criterion). The server records nothing, so this is purely a client clock.
 */
export const REACTION_DECAY_MS = 5000;

/**
 * Client-side send cap (PROTOCOL.md §9: at most 5/s per client). Capping here means the server
 * never has to drop a well-formed frame; a tap past the cap animates the affordance but sends
 * nothing, so the button never feels dead while the wire stays inside the contract.
 */
const REACTION_MAX_PER_SECOND = 5;

/**
 * One live sticker. `key` is stable for a sprite's whole life: it keys the React node and seeds the
 * sprite's rotation and pile scatter, so a re-render never reshuffles a sticker already on screen.
 * `at` is when it last landed or coalesced (drives decay); `pulse` counts coalesced re-taps so the
 * view can bump scale without stacking a second sprite. `userId` is the sender, kept only to
 * coalesce that sender's repeats (PROTOCOL.md §9), never to gate rendering (receive-any).
 */
export interface ReactionEntry {
  readonly key: string;
  readonly userId: string;
  readonly emoji: string;
  readonly cell: number;
  readonly at: number;
  readonly pulse: number;
}

export interface ReactionModelInit {
  /**
   * Send one reaction to the room. Wired to store.react in the app, a recorder in tests. The
   * store's react() is a pure fan-out (no stored state), keeping reactions off reconciled state.
   */
  send: (emoji: string, cell: number) => void;
  /** The local user id, for a sent sticker's echo (the server never echoes one back, §6). */
  selfUserId: () => string | null;
  /** Injected clock so decay and the rate cap are deterministic under fake timers. */
  now?: () => number;
}

export class ReactionModel {
  private readonly sendFrame: (emoji: string, cell: number) => void;
  private readonly getSelfUserId: () => string | null;
  private readonly now: () => number;

  private entriesValue: ReactionEntry[] = [];
  private version = 0;
  private nextKey = 0;
  // A sliding 1-second window of send timestamps, pruned on each send (the 5/s cap).
  private readonly sendTimes: number[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();

  constructor(init: ReactionModelInit) {
    this.sendFrame = init.send;
    this.getSelfUserId = init.selfUserId;
    this.now = init.now ?? (() => Date.now());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  get entries(): readonly ReactionEntry[] {
    return this.entriesValue;
  }

  /**
   * Send a reaction anchored at `cell` (PROTOCOL.md §5, §9). Rate-capped at 5/s: past the cap
   * nothing is sent and no sticker lands, so the server never has to drop the frame. Under the cap
   * the frame goes to the room and a local echo sticker appears at once, since the server never
   * echoes a reaction to its own sender (§6). Returns whether it fired, so a caller can still
   * animate the tapped affordance either way without ever feeling a dead button.
   */
  send(emoji: string, cell: number): boolean {
    const t = this.now();
    this.pruneWindow(t);
    if (this.sendTimes.length >= REACTION_MAX_PER_SECOND) return false;
    this.sendTimes.push(t);
    this.sendFrame(emoji, cell);
    this.land(this.getSelfUserId() ?? "self", emoji, cell, t);
    return true;
  }

  /**
   * An incoming reaction notice from another connection (PROTOCOL.md §6). Receive-any: whatever
   * well-formed emoji arrives renders, never filtered against the send set (§9). Inbound notices
   * never count against the local send cap; that cap only governs this client's own sends.
   */
  receive(notice: { userId: string; emoji: string; cell: number }): void {
    this.land(notice.userId, notice.emoji, notice.cell, this.now());
  }

  private land(userId: string, emoji: string, cell: number, at: number): void {
    // Coalesce a sender's repeat of the same emoji on the same cell while it is still alive:
    // refresh the life and bump the pulse instead of stacking a second sprite (PROTOCOL.md §9).
    const existing = this.entriesValue.find(
      (e) => e.userId === userId && e.emoji === emoji && e.cell === cell,
    );
    if (existing !== undefined) {
      const refreshed: ReactionEntry = {
        ...existing,
        at,
        pulse: existing.pulse + 1,
      };
      this.entriesValue = this.entriesValue.map((e) =>
        e.key === existing.key ? refreshed : e,
      );
      this.scheduleExpiry(existing.key, at);
      this.bump();
      return;
    }
    const key = `r${this.nextKey}`;
    this.nextKey += 1;
    this.entriesValue = [
      ...this.entriesValue,
      { key, userId, emoji, cell, at, pulse: 0 },
    ];
    this.scheduleExpiry(key, at);
    this.bump();
  }

  private scheduleExpiry(key: string, at: number): void {
    const prev = this.timers.get(key);
    if (prev !== undefined) clearTimeout(prev);
    const remaining = Math.max(0, at + REACTION_DECAY_MS - this.now());
    const timer = setTimeout(() => this.expire(key), remaining);
    this.timers.set(key, timer);
  }

  private expire(key: string): void {
    this.timers.delete(key);
    const next = this.entriesValue.filter((e) => e.key !== key);
    if (next.length === this.entriesValue.length) return;
    this.entriesValue = next;
    this.bump();
  }

  private pruneWindow(t: number): void {
    const cutoff = t - 1000;
    while (this.sendTimes.length > 0) {
      const first = this.sendTimes[0];
      if (first === undefined || first > cutoff) break;
      this.sendTimes.shift();
    }
  }

  /** Clear timers on teardown (component unmount, board switch). */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.entriesValue = [];
  }

  private bump(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
