# apps/web (placeholder)

The Vite React SPA. Lands in two steps (see ROADMAP.md):

- **Wave 1.1h**: Vite scaffold with the UX playground, a grid interaction prototype on
  fake data. Rendering rules from DESIGN.md §10, input model from the navigation
  vectors. No server, no networking.
- **Wave 2.1d**: WS codec, store (client reducer + optimistic overlay + connection
  state machine per PROTOCOL.md §§7–8, driven by the client-store vectors), wired into
  the playground grid. Gated on the desktop interaction spec.
