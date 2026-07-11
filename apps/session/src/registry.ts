// The actor registry (DESIGN.md §6 "hydrate lazily"): one actor per game, built on the
// first connection and cached. Hydration is async (it reads Postgres), so the in-flight
// Promise is cached, not just the resolved actor: two sockets racing to open the same
// game share one hydration and therefore one actor, which is what makes the actor the
// single writer (INV-2, INV-7). A game that does not exist resolves to null and is not
// cached, so a game created after a failed lookup can still hydrate later.

import type { Pool } from "pg";
import { GameActor } from "./actor";
import type { ActorOptions } from "./actor";
import { hydrateGame } from "./hydrate";
import type { ActivityPushEmitter } from "./push/emitter";
import { loadGameRow, loadGameState } from "./repo";
import { createPgPersistence } from "./writer";
import type { GamePersistence } from "./writer";

export class ActorRegistry {
  private readonly actors = new Map<string, Promise<GameActor | null>>();
  private readonly persistence: GamePersistence;

  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date,
    private readonly actorOptions: ActorOptions = {},
    /**
     * The Live Activity push emitter (PROTOCOL.md "Live Activity push"), passed to every actor it
     * hydrates. Optional: omitted (or the inert emitter) in tests and when the APNs env is absent,
     * so the whole push channel is a no-op and the session behaves identically.
     */
    private readonly pushEmitter?: ActivityPushEmitter,
  ) {
    this.persistence = createPgPersistence(pool);
  }

  /** Get the actor for `gameId`, hydrating once on first use; `null` if the game is unknown. */
  getOrHydrate(gameId: string): Promise<GameActor | null> {
    const existing = this.actors.get(gameId);
    if (existing !== undefined) return existing;

    const created = this.hydrate(gameId);
    this.actors.set(gameId, created);
    // Do not cache a miss or a failure: drop it so a later create-then-connect works.
    created
      .then((actor) => {
        if (actor === null) this.actors.delete(gameId);
      })
      .catch(() => this.actors.delete(gameId));
    return created;
  }

  /**
   * The already-hydrated actor for `gameId`, or `null` if none is live. Never hydrates: a kick
   * or role change on a passivated game needs no actor, since there are no live sockets and the
   * denylist plus connect-time re-verify enforce it (DESIGN.md §6). Only the abandon path
   * hydrates on demand, through `getOrHydrate`.
   */
  async getIfLive(gameId: string): Promise<GameActor | null> {
    const existing = this.actors.get(gameId);
    if (existing === undefined) return null;
    return existing.catch(() => null);
  }

  /** Every already-hydrated actor, for the SIGTERM drain (DESIGN.md §6). */
  async liveActors(): Promise<GameActor[]> {
    const settled = await Promise.all(
      [...this.actors.values()].map((p) => p.catch(() => null)),
    );
    return settled.filter((a): a is GameActor => a !== null);
  }

  private async hydrate(gameId: string): Promise<GameActor | null> {
    const gameRow = await loadGameRow(this.pool, gameId);
    if (gameRow === null) return null;
    const state = await loadGameState(this.pool, gameId);
    return new GameActor(
      gameId,
      hydrateGame(gameRow.snapshot, state, gameRow.roomName),
      this.persistence,
      this.now,
      this.actorOptions,
      this.pushEmitter,
    );
  }
}
