# apps/web

The Vite + React SPA. Right now it is the **Wave 1.1h UX playground**: the crossword
grid and the input model on trial against fake, local data. No server, no networking, no
imports from other workspace packages (the engine does not exist yet). Rendering follows
DESIGN.md §10 and the v2 constants recovered in
`reports/spikes/sp6-v2-v3-recovery.md`; the input model is driven by the navigation
vectors.

## Run it

```
pnpm install
pnpm --filter @crossy/web dev
```

Open the printed URL. Click any cell to focus the grid, then use the keyboard.

Other scripts: `pnpm --filter @crossy/web test` (the navigation suite),
`pnpm --filter @crossy/web build`, `pnpm --filter @crossy/web typecheck`.

## Scripted taste tour

1. **Type a word.** On the `5x4 vector fixture`, click cell 1 (top row) and type. The
   focus advances one cell at a time, skipping filled cells.
2. **Feel the wrap.** Fill a word to its last cell. Typing at the end jumps back to the
   word's first empty cell if the word is incomplete, or holds on the last cell if it is
   complete. Switch to the `15x15 daily-style` board, where several words are
   pre-filled, to feel the filled-skip.
3. **Tab around.** `Tab` jumps to the next clue on the current axis and lands on its
   first empty cell. `Space` (or clicking the focused cell) toggles across/down. Arrow
   keys move along the axis with block-skip and toggle direction across it.
4. **Toggle the two open decisions** (settings strip, both default to v2 behavior):
   - **Shift+Tab lands on**: "Word start or end (v2)" vs "First empty cell". Fill the
     start of a clue, then Shift+Tab into it and watch where it lands. The v2 rule never
     stops on a mid-word empty; the symmetric rule does.
   - **Backspace on an empty cell**: "Crosses the block (v2)" vs "Stays in this word".
     Put the cursor on a word's first cell (already empty) and press Backspace. v2 steps
     across the block into the previous word and clears it; clamp holds at the word
     start.
5. **Switch themes.** The Theme toggle flips light/dark instantly; both honor the SP6
   color roles. The page also respects your OS preference on first load.

Presence is faked: the `15x15` board shows two teammate cursors (arrow plus avatar
initial) and one cell shared by two teammates, which collapses to a count badge.

## Where taste notes go

This playground is the base the owner smoke-tests before the Wave 2.1d desktop
interaction spec is written (ROADMAP.md, UX track). File findings as taste notes against
that spec: durable rules land in DESIGN.md §10, interaction detail in the 2.1d spec, and
anything that can become a vector (navigation, store) becomes one. The two toggles above
are the decisions this pass is meant to settle (SP6 divergences 2 and 3).

## What is throwaway

`src/domain/navigation.ts` is the client-side input model, marked
**throwaway-until-engine**. Its `getNextCell` primitive matches the 12 seed cases in
`vectors/v1/navigation/single-cell-advance.json` (see `navigation.test.ts`).
`packages/engine` implements the real, vector-conformant navigation in Wave 2.1a, and
this client adopts it in 2.1d, deleting the local module.

## What lands later

- **Wave 2.1d**: WS codec, store (client reducer + optimistic overlay + connection state
  machine per PROTOCOL.md §§7–8, driven by the client-store vectors), wired into the
  playground grid. Gated on the desktop interaction spec.
