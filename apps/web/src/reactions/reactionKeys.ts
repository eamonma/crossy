// The reaction keyboard map as a pure transform (Wave 7.3), the sibling of input/actions.ts: key
// state plus a key event in, next state plus a fire and a consumed flag out. Keeping it pure means
// the leader/HUD/direct-key rules are vector-style unit tests, not a React harness; the hook
// (useReactions) only maps the result onto model.send and the idle timer. The rules the spec and
// the owner rulings pin: `/` opens the radial HUD instantly; a mapped key fires AND closes the HUD
// (owner ruling 2026-07-14), with the fired key captured until its keyup so held-key auto-repeat
// keeps firing reactions at the rate cap instead of leaking letters into the grid; an unmapped key
// closes the HUD AND passes through (an accidental `/` never swallows a keystroke); Esc closes;
// `?`/`!` fire with no HUD; held `/` repeats are swallowed so the ring neither flickers shut
// mid-hold nor reopens after a fire closed it.
import {
  LEADER_KEY,
  optionForDirectKey,
  optionForLeaderKey,
} from "./reactionSet";
import type { ResolvedReactionSet } from "./reactionSet";

export interface HudState {
  /** Whether the radial HUD is open. */
  readonly open: boolean;
  /** The cell the open HUD is anchored to, frozen at open time; null while closed. */
  readonly cell: number | null;
}

export const HUD_CLOSED: HudState = { open: false, cell: null };

/**
 * A mapped key still physically held after its fire closed the HUD. While it stands, that key's
 * auto-repeats keep firing this emoji at the anchor cell (rate-capped in the model) and never
 * reach the letter handler; its keyup releases the key back to normal typing.
 */
export interface CapturedKey {
  /** The captured leader key, lowercase ASCII (matched case-folded, INV-1). */
  readonly key: string;
  readonly emoji: string;
  /** The anchor the fire used: the HUD's cell, kept so a held burst stays on one cell. */
  readonly cell: number;
}

export interface ReactionKeyState {
  readonly hud: HudState;
  readonly captured: CapturedKey | null;
}

export const REACTION_KEYS_IDLE: ReactionKeyState = {
  hud: HUD_CLOSED,
  captured: null,
};

export interface ReactionKeyResult {
  /** The state after this key. Referentially unchanged when nothing changed. */
  readonly state: ReactionKeyState;
  /** An emoji to fire and the cell to anchor it to, or null when this key fires nothing. */
  readonly fire: { readonly emoji: string; readonly cell: number } | null;
  /** True when the caller should preventDefault and NOT pass the key to the letter handler. A
   * false here on a HUD-closing key is the passthrough case: the HUD closes yet the key still
   * types (the accidental-`/` rule). */
  readonly consumed: boolean;
}

/**
 * Map one keydown against the current state and the sender's resolved reaction set. `set` carries
 * the five emoji the leader and direct keys fire (the personal set, §9, §12); the geometry and the
 * key bindings are fixed, only which emoji each slot holds rides in. `cell` is the sender's current
 * cursor cell (the anchor for a direct-key fire and for opening the HUD); `repeat` is the event's
 * key-repeat flag.
 */
export function reactionKeyDown(
  set: ResolvedReactionSet,
  state: ReactionKeyState,
  key: string,
  cell: number,
  repeat: boolean,
): ReactionKeyResult {
  // A captured key's auto-repeats keep the burst going: fire at the captured anchor, consumed,
  // and nothing leaks to the grid. A NON-repeat keydown of the same key means its keyup was
  // missed (window blur, focus steal): release the capture and treat the press as a fresh key.
  if (state.captured !== null) {
    const held = optionForLeaderKey(set, key);
    if (held !== undefined && held.leaderKey === state.captured.key) {
      if (repeat) {
        return {
          state,
          fire: { emoji: state.captured.emoji, cell: state.captured.cell },
          consumed: true,
        };
      }
      state = { hud: state.hud, captured: null };
    }
  }

  // Direct keys fire with no HUD and dismiss an open one, whatever the state.
  const direct = optionForDirectKey(set, key);
  if (direct !== undefined) {
    return {
      state: state.hud.open
        ? { hud: HUD_CLOSED, captured: state.captured }
        : state,
      fire: { emoji: direct.emoji, cell },
      consumed: true,
    };
  }

  if (key === LEADER_KEY) {
    // A held `/` repeats on the OS; swallow the repeats so the HUD neither flickers open/shut
    // mid-hold (hold-`/`-then-key depends on this) nor reopens after a mapped fire closed it.
    if (repeat) {
      return { state, fire: null, consumed: true };
    }
    if (!state.hud.open) {
      return {
        state: { hud: { open: true, cell }, captured: state.captured },
        fire: null,
        consumed: true,
      };
    }
    // A deliberate second press (not a repeat) closes.
    return {
      state: { hud: HUD_CLOSED, captured: state.captured },
      fire: null,
      consumed: true,
    };
  }

  if (state.hud.open) {
    if (key === "Escape") {
      return {
        state: { hud: HUD_CLOSED, captured: state.captured },
        fire: null,
        consumed: true,
      };
    }
    const opt = optionForLeaderKey(set, key);
    if (opt !== undefined) {
      // Fire and dismiss (owner ruling 2026-07-14): the ring's job is done the moment a slot
      // fires. The key is captured until its keyup so the mid-keydown auto-repeat neither types
      // letters nor needs the ring back on screen; the burst stays on the ring's anchor cell.
      const anchor = state.hud.cell ?? cell;
      return {
        state: {
          hud: HUD_CLOSED,
          captured: { key: opt.leaderKey, emoji: opt.emoji, cell: anchor },
        },
        fire: { emoji: opt.emoji, cell: anchor },
        consumed: true,
      };
    }
    // An unmapped key closes the HUD AND passes through as a normal letter: an accidental `/`
    // followed by a real keystroke must never swallow that keystroke (Wave 7.3).
    return {
      state: { hud: HUD_CLOSED, captured: state.captured },
      fire: null,
      consumed: false,
    };
  }

  return { state, fire: null, consumed: false };
}

/** Map one keyup: releasing the captured key returns it to normal typing. Takes the resolved set so
 *  the released key is matched by the same case-folded slot lookup the keydown used. */
export function reactionKeyUp(
  set: ResolvedReactionSet,
  state: ReactionKeyState,
  key: string,
): ReactionKeyState {
  if (state.captured === null) return state;
  const released = optionForLeaderKey(set, key);
  if (released === undefined || released.leaderKey !== state.captured.key) {
    return state;
  }
  return { hud: state.hud, captured: null };
}
