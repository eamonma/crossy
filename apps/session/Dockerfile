# Session service image (apps/session). Same shape as apps/api: multi-stage, pnpm
# workspace-aware, prod-only final stage, non-root, run under a pinned tsx. Build context
# is the repo ROOT: `docker build -f apps/session/Dockerfile .` from root.
#
# The session holds the WebSocket fleet (ws) and is the single writer for game_state /
# cell_events. It listens on PORT for WS + health (public), and optionally on INTERNAL_PORT
# for the bearer-authenticated /internal endpoint (private network only, no public domain).

# --- deps + prune -----------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# Prod-only tree: app source, @crossy/* workspace source, and the runtime externals
# (ws, pg, jose via @crossy/auth, drizzle-orm, @crossy/engine + protocol source).
RUN pnpm --filter @crossy/session deploy --prod --legacy /prod/session

# --- runtime ----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# WS + health port (code default 8081). Railway overrides PORT and maps the public domain
# to it. INTERNAL_PORT is intentionally unset here; the deploy sets it so /internal binds a
# second, domain-less port reachable only over the private network (see deploy/README.md).
ENV PORT=8081

RUN npm install -g tsx@4.23.0 && npm cache clean --force

WORKDIR /app
COPY --from=build --chown=node:node /prod/session ./

USER node
EXPOSE 8081
# Entry is the session composition root (apps/session/src/main.ts -> src/main.ts here).
CMD ["tsx", "src/main.ts"]
