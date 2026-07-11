// The wiring seam: the ActivityPushEmitter feeds the pure policy from the actor/server observation
// sites and enacts its decisions through the APNs adapter. It is FIRE-AND-FORGET by construction
// (the brief's hard rule): a slow or down APNs must never back-pressure the actor's hot path or
// delay a broadcast. Every observation enqueues onto one isolated in-process queue and returns
// immediately; the queue drains on its own microtask chain, and any failure logs and drops. The
// island degrades to today's frozen behavior, never a broken room.
//
// Inert path: with any of APNS_TEAM_ID / APNS_KEY_ID / APNS_PRIVATE_KEY absent the emitter is a
// no-op (createInertEmitter), so dev machines and CI behave identically to before. The disabled
// path is proven a no-op by emitter.test.ts.
//
// The content-state (PROTOCOL.md "Live Activity push") is built here from the observation's board
// facts (filled/total/status/completedAt, the connected set) plus the members read (display name,
// role, wire color). Pucks mirror the iOS cluster rule exactly (roster.ts). INV-6: only counts and
// presence/render facts ever reach the payload; no letters, no coordinates, in payload or log.

import type { Pool } from "pg";
import type { LiveActivityContentState } from "@crossy/protocol";
import { colorForUser } from "../color";
import { loadMembers } from "../repo";
import type { MemberRow } from "../repo";
import { ApnsAdapter, createHttp2Transport } from "./apns";
import type {
  ApnsCredentials,
  ApnsEnvironment,
  ApnsRequest,
  Http2Transport,
} from "./apns";
import { INITIAL_POLICY_STATE, flushPending, fold } from "./policy";
import type { Observation, PolicyState, PushDecision } from "./policy";
import { clusterPucks } from "./roster";
import type { RosterMember } from "./roster";
import { loadLiveTokens } from "./tokens";
import type { LiveActivityToken } from "./tokens";

/**
 * The board facts an observation carries, produced synchronously by the actor so nothing on the hot
 * path awaits IO. `connectedUserIds` is a snapshot of who holds a live socket; the pucks' members
 * are read from the DB inside the queue, off the hot path.
 */
export interface BoardFacts {
  readonly filled: number;
  readonly total: number;
  readonly status: "ongoing" | "completed" | "abandoned";
  readonly completedAt: string | null;
  readonly connectedUserIds: ReadonlySet<string>;
  /**
   * The room's display name (`games.name`, nullable), for the completion alert body (PROTOCOL.md
   * 12a). It rides the facts snapshot rather than a second read on the hot path: the actor already
   * holds it from hydration. Only the terminal-completed decision reads it; every other push ignores
   * it, and it never enters the content-state (INV-6 keeps that to counts and render facts).
   */
  readonly roomName: string | null;
}

/** The emitter's surface. The actor and server call these; a slow APNs never blocks them. */
export interface ActivityPushEmitter {
  /** A cluster member connected or disconnected: push immediately (priority 10). */
  onPresence(gameId: string, facts: BoardFacts): void;
  /** A fill changed the counts: debounced latest-state (priority 5). */
  onFill(gameId: string, facts: BoardFacts): void;
  /**
   * The game reached a terminal state. Completed announces itself: an alerting update, then an end
   * after ANNOUNCE_MS (policy.ts). Abandoned is a single quiet end. Both retire the island.
   */
  onTerminal(gameId: string, facts: BoardFacts): void;
  /** A member was kicked: end their own tokens, presence-update everyone else. */
  onKick(gameId: string, userId: string, facts: BoardFacts): void;
  /** Stop the debounce timers on drain, so nothing keeps the process alive after SIGTERM. */
  stop(): void;
}

/** A no-op emitter: every hook does nothing. The inert path when the env is incomplete. */
export function createInertEmitter(): ActivityPushEmitter {
  return {
    onPresence: () => {},
    onFill: () => {},
    onTerminal: () => {},
    onKick: () => {},
    stop: () => {},
  };
}

/**
 * Read the four env vars and the bundle constant into credentials, or null when any is absent. A
 * present-but-empty value counts as absent (the 12-factor unset convention main.ts uses). The
 * bundle id is a code constant, not env (the brief).
 */
export const BUNDLE_ID = "com.eamonma.Crossy";

export function readApnsCredentials(
  env: NodeJS.ProcessEnv,
): ApnsCredentials | null {
  const teamId = env["APNS_TEAM_ID"];
  const keyId = env["APNS_KEY_ID"];
  const privateKeyPem = env["APNS_PRIVATE_KEY"];
  if (
    teamId === undefined ||
    teamId === "" ||
    keyId === undefined ||
    keyId === "" ||
    privateKeyPem === undefined ||
    privateKeyPem === ""
  ) {
    return null;
  }
  return { teamId, keyId, privateKeyPem, bundleId: BUNDLE_ID };
}

/** Everything the live emitter needs; the transport and clock are injectable for tests. */
export interface EmitterDeps {
  readonly pool: Pool;
  readonly adapter: ApnsAdapter;
  readonly now?: () => number;
  /** Arm a debounce timer; defaults to setTimeout. Injectable so tests drive the debounce. */
  readonly setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
}

/** Per-game queue and policy memory. One chain per game keeps a slow game off another's path. */
interface GameChannel {
  policy: PolicyState;
  /** The tail of this game's microtask chain; every observation appends to it. */
  tail: Promise<void>;
  timer: { cancel: () => void } | null;
}

/**
 * The live emitter. Each observation appends a task to the game's own promise chain and returns at
 * once (fire-and-forget). The task builds the content-state, folds the policy, and dispatches the
 * decisions to the adapter. A task that throws is caught and logged; the chain continues, so one
 * failure never wedges a game (INV-6-safe log: gameId and counts only, never board content).
 */
export class LiveActivityPushEmitter implements ActivityPushEmitter {
  private readonly channels = new Map<string, GameChannel>();
  private readonly now: () => number;
  private readonly setTimer: (
    fn: () => void,
    ms: number,
  ) => { cancel: () => void };

  constructor(private readonly deps: EmitterDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        t.unref?.();
        return { cancel: () => clearTimeout(t) };
      });
  }

  onPresence(gameId: string, facts: BoardFacts): void {
    this.enqueue(gameId, { kind: "presence" }, facts);
  }
  onFill(gameId: string, facts: BoardFacts): void {
    this.enqueue(gameId, { kind: "fill" }, facts);
  }
  onTerminal(gameId: string, facts: BoardFacts): void {
    // The room name rides the facts snapshot to the policy, so the completion alert body can name
    // the room without a hot-path read. Only the completed branch uses it (policy.ts).
    this.enqueue(gameId, { kind: "terminal", roomName: facts.roomName }, facts);
  }
  onKick(gameId: string, userId: string, facts: BoardFacts): void {
    this.enqueue(gameId, { kind: "kick", userId }, facts);
  }

  stop(): void {
    for (const channel of this.channels.values()) {
      channel.timer?.cancel();
      channel.timer = null;
    }
  }

  private channel(gameId: string): GameChannel {
    let channel = this.channels.get(gameId);
    if (channel === undefined) {
      channel = {
        policy: INITIAL_POLICY_STATE,
        tail: Promise.resolve(),
        timer: null,
      };
      this.channels.set(gameId, channel);
    }
    return channel;
  }

  /**
   * Append one observation task to the game's chain. Returns immediately: the caller (the actor's
   * mailbox, or the server's close/kick path) never awaits this, so APNs latency cannot leak onto
   * the broadcast path. The task itself is wrapped so a rejection never breaks the chain.
   */
  private enqueue(
    gameId: string,
    observation: Observation,
    facts: BoardFacts,
  ): void {
    const channel = this.channel(gameId);
    channel.tail = channel.tail.then(() =>
      this.run(gameId, channel, observation, facts).catch((error: unknown) => {
        // Log and drop (fire-and-forget): the island freezes at its last frame, the room is fine.
        console.error(
          `live-activity push fault for game ${gameId} (${observation.kind}):`,
          error instanceof Error ? error.message : error,
        );
      }),
    );
  }

  private async run(
    gameId: string,
    channel: GameChannel,
    observation: Observation,
    facts: BoardFacts,
  ): Promise<void> {
    const members = await loadMembers(this.deps.pool, gameId);
    const contentState = buildContentState(members, facts);
    const nowMs = this.now();
    const result = fold(channel.policy, observation, contentState, nowMs);
    channel.policy = result.state;
    if (result.decisions.length > 0) {
      await this.dispatch(gameId, members, result.decisions, nowMs);
    }
    this.arm(gameId, channel, result.wakeAtMs);
  }

  /** Arm (or re-arm) the debounce timer to flush a held fill when the window opens. */
  private arm(
    gameId: string,
    channel: GameChannel,
    wakeAtMs: number | null,
  ): void {
    channel.timer?.cancel();
    channel.timer = null;
    if (wakeAtMs === null) return;
    const delay = Math.max(0, wakeAtMs - this.now());
    channel.timer = this.setTimer(() => {
      channel.tail = channel.tail.then(() =>
        this.flush(gameId, channel).catch((error: unknown) => {
          console.error(
            `live-activity push flush fault for game ${gameId}:`,
            error instanceof Error ? error.message : error,
          );
        }),
      );
    }, delay);
  }

  /** Flush a debounced fill: re-run the policy's pending flush and dispatch what it yields. */
  private async flush(gameId: string, channel: GameChannel): Promise<void> {
    const nowMs = this.now();
    const result = flushPending(channel.policy, nowMs);
    channel.policy = result.state;
    if (result.decisions.length > 0) {
      const members = await loadMembers(this.deps.pool, gameId);
      await this.dispatch(gameId, members, result.decisions, nowMs);
    }
    this.arm(gameId, channel, result.wakeAtMs);
  }

  /**
   * Enact decisions: read the game's live tokens (TTL-windowed), select the audience per decision,
   * build the envelope, and send through the adapter. Sends run concurrently; each is independent
   * and its failure logs-and-drops inside the adapter (never throws). A dead token is skipped.
   */
  private async dispatch(
    gameId: string,
    members: readonly MemberRow[],
    decisions: readonly PushDecision[],
    nowMs: number,
  ): Promise<void> {
    const tokens = await loadLiveTokens(this.deps.pool, gameId, nowMs);
    if (tokens.length === 0) return;
    const sends: Promise<unknown>[] = [];
    for (const decision of decisions) {
      const targets = audienceTokens(tokens, decision.audience);
      const body = buildEnvelope(decision, nowMs);
      for (const token of targets) {
        if (this.deps.adapter.isDead(token.token)) continue;
        sends.push(this.sendOne(gameId, token, decision, body));
      }
    }
    await Promise.all(sends);
  }

  private async sendOne(
    gameId: string,
    token: LiveActivityToken,
    decision: PushDecision,
    body: string,
  ): Promise<void> {
    const req: ApnsRequest = {
      token: token.token,
      environment: token.environment,
      priority: decision.priority,
      body,
    };
    const result = await this.deps.adapter.send(req);
    if (!result.ok && result.status !== 410) {
      // 410 dead tokens are expected churn; louder statuses (auth, payload) are worth a line.
      // Counts-only context, never board content (INV-6).
      console.warn(
        `live-activity push to a token for game ${gameId} returned ${result.status}` +
          ("error" in result ? ` (${result.error})` : ""),
      );
    }
  }
}

/** The tokens a decision targets, per its audience (whole game, one user, or all but one user). */
function audienceTokens(
  tokens: readonly LiveActivityToken[],
  audience: PushDecision["audience"],
): LiveActivityToken[] {
  switch (audience.kind) {
    case "game":
      return [...tokens];
    case "user":
      return tokens.filter((t) => t.userId === audience.userId);
    case "exceptUser":
      return tokens.filter((t) => t.userId !== audience.userId);
  }
}

/**
 * Build the ActivityKit envelope (PROTOCOL.md "Live Activity push"). An update carries
 * `aps.event: "update"`, a server `aps.timestamp` (seconds), the content-state, and a `stale-date`
 * so the widget renders its stale register when the channel goes quiet. A terminal ships
 * `aps.event: "end"` with the final content-state and a `dismissal-date` so the island retires.
 * The completion's alerting update also carries an `aps.alert` dictionary (title, body, sound), the
 * shape Apple's documented Live Activity payload uses to break through and auto-expand the island.
 * Times are seconds since the epoch, the ActivityKit convention.
 */
export function buildEnvelope(decision: PushDecision, nowMs: number): string {
  const nowSec = Math.floor(nowMs / 1000);
  const aps: Record<string, unknown> = {
    timestamp: nowSec,
    event: decision.event,
    "content-state": contentStateJson(decision.contentState),
  };
  if (decision.event === "update" && decision.staleAfterMs !== undefined) {
    aps["stale-date"] = Math.floor((nowMs + decision.staleAfterMs) / 1000);
  }
  if (decision.event === "end" && decision.dismissMs !== undefined) {
    aps["dismissal-date"] = Math.floor((nowMs + decision.dismissMs) / 1000);
  }
  if (decision.alert !== undefined) {
    // Apple's Live Activity payload: `alert` is a dict under `aps` with title, body, and sound as
    // siblings. The presence of `alert` makes ActivityKit deliver this update as an alerting one.
    aps["alert"] = {
      title: decision.alert.title,
      body: decision.alert.body,
      sound: decision.alert.sound,
    };
  }
  return JSON.stringify({ aps });
}

/** The content-state as the widget's Codable reads it (the vectors' shape, fixed key order). */
function contentStateJson(
  cs: LiveActivityContentState,
): Record<string, unknown> {
  return {
    pucks: cs.pucks.map((p) => ({
      initial: p.initial,
      red: p.red,
      green: p.green,
      blue: p.blue,
      connected: p.connected,
    })),
    filled: cs.filled,
    total: cs.total,
    status: cs.status,
    completedAt: cs.completedAt,
  };
}

/**
 * Build the content-state from the members read and the board facts. The pucks are the iOS cluster
 * (solvers and host, presence order, capped at 4; roster.ts). The wire color is the session's own
 * derivation (colorForUser), so a puck slots exactly as the client would from the §4 participant
 * `color`. `connected` comes from the live-socket set. INV-6: filled/total are the facts' counts,
 * nothing else.
 */
export function buildContentState(
  members: readonly MemberRow[],
  facts: BoardFacts,
): LiveActivityContentState {
  const rosterMembers: RosterMember[] = members.map((m) => ({
    userId: m.userId,
    displayName: m.displayName ?? "",
    wireColor: colorForUser(m.userId),
    isSpectator: m.role === "spectator",
    connected: facts.connectedUserIds.has(m.userId),
  }));
  return {
    pucks: clusterPucks(rosterMembers),
    filled: facts.filled,
    total: facts.total,
    status: facts.status,
    completedAt: facts.completedAt,
  };
}

/** Re-export so the composition root builds from one import. Kept here to avoid a barrel file. */
export { ApnsAdapter, createHttp2Transport };
export type { ApnsCredentials, ApnsEnvironment, Http2Transport };
