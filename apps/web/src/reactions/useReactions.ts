// The React seam over the reaction model (Wave 7.3): it owns the ReactionModel instance, subscribes
// the view to it, wires the store's incoming-reaction relay into it, and holds the small bit of
// UI state the pure model does not, namely the radial HUD's open/anchor state, the captured-key
// state, and the HUD's idle-close timer. Everything sequenced lives in the model or the pure
// reactionKeys reducer; this file is only the glue between them and React, so both game surfaces
// (LiveGame and the demo) share one wiring.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { GameStore } from "../store/gameStore";
import { ReactionModel } from "./reactionModel";
import type { ReactionEntry } from "./reactionModel";
import {
  HUD_CLOSED,
  REACTION_KEYS_IDLE,
  reactionKeyDown,
  reactionKeyUp,
} from "./reactionKeys";
import type { HudState, ReactionKeyState } from "./reactionKeys";
import type { ResolvedReactionSet } from "./reactionSet";

/** How long the radial HUD waits with no input before it closes itself (owner ruling: ~3 s). */
const HUD_IDLE_MS = 3000;

export interface UseReactions {
  /** The live stickers to paint (raw entries; CrosswordGrid piles and positions them). */
  readonly entries: readonly ReactionEntry[];
  readonly hudOpen: boolean;
  /** The cell the open HUD is anchored to, for positioning the overlay. */
  readonly hudCell: number | null;
  /** Fire a reaction at an explicit cell (the tray, anchored to the caller's cursor cell). */
  readonly send: (emoji: string, cell: number) => void;
  /** Fire from an open HUD slot (click): anchors to the HUD's cell and dismisses the ring,
   * matching the fire-and-dismiss keyboard rule. */
  readonly sendFromHud: (emoji: string) => void;
  readonly closeHud: () => void;
  /**
   * Handle one keydown (leader, mapped, direct, Esc, captured repeats). Returns true when the
   * caller should preventDefault and skip the letter handler; false lets an unmapped key fall
   * through as a normal keystroke (the accidental-`/` rule).
   */
  readonly handleKeyDown: (
    key: string,
    cell: number,
    repeat: boolean,
  ) => boolean;
  /** Handle one keyup: releases a captured mapped key back to normal typing. */
  readonly handleKeyUp: (key: string) => void;
}

export function useReactions(
  store: GameStore,
  reactionSet: ResolvedReactionSet,
): UseReactions {
  const model = useMemo(
    () =>
      new ReactionModel({
        send: (emoji, cell) => store.react(emoji, cell),
        selfUserId: () => store.selfUserId,
      }),
    [store],
  );
  useEffect(() => () => model.dispose(), [model]);

  const version = useSyncExternalStore(model.subscribe, model.getVersion);
  const entries = useMemo(() => {
    void version;
    return model.entries;
  }, [model, version]);

  // Route the store's incoming reaction notices into the model (PROTOCOL.md §6). The store relays
  // but stores nothing, so this is the only place an inbound reaction becomes a sprite.
  useEffect(
    () => store.subscribeReaction((r) => model.receive(r)),
    [store, model],
  );

  // The reducer's full state lives in a ref (the captured key never affects render); only the HUD
  // slice mirrors into React state so the ring mounts and unmounts.
  const stateRef = useRef<ReactionKeyState>(REACTION_KEYS_IDLE);
  const [hud, setHud] = useState<HudState>(HUD_CLOSED);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdle = useCallback(() => {
    if (idleRef.current !== null) {
      clearTimeout(idleRef.current);
      idleRef.current = null;
    }
  }, []);
  const applyState = useCallback((next: ReactionKeyState) => {
    if (next === stateRef.current) return;
    const hudChanged = next.hud !== stateRef.current.hud;
    stateRef.current = next;
    if (hudChanged) setHud(next.hud);
  }, []);
  const armIdle = useCallback(() => {
    clearIdle();
    idleRef.current = setTimeout(() => {
      idleRef.current = null;
      applyState({ hud: HUD_CLOSED, captured: stateRef.current.captured });
    }, HUD_IDLE_MS);
  }, [clearIdle, applyState]);
  useEffect(() => () => clearIdle(), [clearIdle]);

  const closeHud = useCallback(() => {
    clearIdle();
    applyState({ hud: HUD_CLOSED, captured: stateRef.current.captured });
  }, [clearIdle, applyState]);

  const send = useCallback(
    (emoji: string, cell: number) => {
      model.send(emoji, cell);
    },
    [model],
  );

  const sendFromHud = useCallback(
    (emoji: string) => {
      const cell = stateRef.current.hud.cell;
      if (cell === null) return;
      model.send(emoji, cell);
      // Fire-and-dismiss, matching the keyboard rule (owner ruling 2026-07-14). A pointer fire
      // has no held key, so there is nothing to capture.
      closeHud();
    },
    [model, closeHud],
  );

  const handleKeyDown = useCallback(
    (key: string, cell: number, repeat: boolean): boolean => {
      const result = reactionKeyDown(
        reactionSet,
        stateRef.current,
        key,
        cell,
        repeat,
      );
      if (result.fire !== null) model.send(result.fire.emoji, result.fire.cell);
      applyState(result.state);
      if (result.state.hud.open) armIdle();
      else clearIdle();
      return result.consumed;
    },
    [reactionSet, model, applyState, armIdle, clearIdle],
  );

  const handleKeyUp = useCallback(
    (key: string): void => {
      applyState(reactionKeyUp(reactionSet, stateRef.current, key));
    },
    [reactionSet, applyState],
  );

  return {
    entries,
    hudOpen: hud.open,
    hudCell: hud.cell,
    send,
    sendFromHud,
    closeHud,
    handleKeyDown,
    handleKeyUp,
  };
}
