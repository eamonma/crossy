// The handshake (PROTOCOL.md §2): the first frame MUST be `hello`. The server verifies
// the token through the AuthPort (never importing jose), negotiates the protocol
// version, confirms the game exists, then checks the denylist and membership against
// Postgres, and either admits the connection or returns a fatal §11 error the caller
// sends before closing 1008.
//
// Check order and one deliberate ruling PROTOCOL.md §2 leaves open: the denylist is
// checked before membership. A kick removes the membership row and writes the denylist
// (PROTOCOL.md §12), so a kicked user has no membership; checking membership first would
// report NOT_PARTICIPANT and DENIED would never surface. Denylist-first makes a kicked
// user see DENIED, which is the informative and intended answer.

import type { AuthPort } from "@crossy/auth";
import type {
  ClientMessage,
  Decoded,
  ErrorMessage,
  Role,
} from "@crossy/protocol";
import type { Pool } from "pg";
import type { GameActor } from "./actor";
import { errorFrame } from "./frames";
import type { ActorRegistry } from "./registry";
import { findRole, isDenied } from "./repo";

/** PROTOCOL.md §2: at v1 the supported set is exactly {1} (N-1 = 0 is not a real version). */
const SUPPORTED_VERSIONS: ReadonlySet<number> = new Set([1]);

export interface HandshakeDeps {
  readonly authPort: AuthPort;
  readonly pool: Pool;
  readonly registry: ActorRegistry;
}

export interface HandshakeSuccess {
  readonly ok: true;
  readonly userId: string;
  readonly role: Role;
  readonly actor: GameActor;
}

export interface HandshakeFailure {
  readonly ok: false;
  readonly error: ErrorMessage;
}

export type HandshakeResult = HandshakeSuccess | HandshakeFailure;

/** Verify the first frame and resolve the connection to an identity, role, and actor. */
export async function performHandshake(
  deps: HandshakeDeps,
  gameId: string,
  firstFrame: Decoded<ClientMessage>,
): Promise<HandshakeResult> {
  // First frame MUST be hello; anything else (including a malformed frame) is UNAUTHORIZED.
  if (!firstFrame.ok || firstFrame.value.type !== "hello") {
    return fail("UNAUTHORIZED", "the first frame must be `hello`");
  }
  const hello = firstFrame.value;

  if (!SUPPORTED_VERSIONS.has(hello.protocolVersion)) {
    return fail(
      "PROTOCOL_VERSION_UNSUPPORTED",
      "unsupported protocol version; this server supports version 1",
    );
  }

  const verified = await deps.authPort.verify(hello.token);
  if (!verified.ok) {
    return fail("UNAUTHORIZED", `token rejected: ${verified.reason}`);
  }
  const userId = verified.identity.userId;

  const actor = await deps.registry.getOrHydrate(gameId);
  if (actor === null) {
    return fail("GAME_NOT_FOUND", "no game with that id");
  }

  if (await isDenied(deps.pool, gameId, userId)) {
    return fail("DENIED", "you are on this game's denylist");
  }

  const role = await findRole(deps.pool, gameId, userId);
  if (role === null) {
    return fail("NOT_PARTICIPANT", "you are not a member of this game");
  }

  return { ok: true, userId, role, actor };
}

function fail(
  code: Parameters<typeof errorFrame>[0],
  message: string,
): HandshakeFailure {
  return { ok: false, error: errorFrame(code, message) };
}
