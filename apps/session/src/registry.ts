// The actor registry (DESIGN.md §6 "hydrate lazily"): one actor per game, built on the
// first connection and cached. Hydration is async (it reads Postgres), so the in-flight
// Promise is cached, not just the resolved actor: two sockets racing to open the same
// game share one hydration and therefore one actor, which is what makes the actor the
// single writer (INV-2, INV-7). A game that does not exist resolves to null and is not
// cached, so a game created after a failed lookup can still hydrate later.

import type { Pool } from "pg";
import { GameActor } from "./actor";
import { hydrateGame } from "./hydrate";
import { loadGameState, loadPuzzleSnapshot } from "./repo";

export class ActorRegistry {
  private readonly actors = new Map<string, Promise<GameActor | null>>();

  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date,
  ) {}

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

  private async hydrate(gameId: string): Promise<GameActor | null> {
    const snapshot = await loadPuzzleSnapshot(this.pool, gameId);
    if (snapshot === null) return null;
    const state = await loadGameState(this.pool, gameId);
    return new GameActor(hydrateGame(snapshot, state), this.now);
  }
}
