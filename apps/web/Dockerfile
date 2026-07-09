# Web client image (apps/web): build the static Vite bundle, serve it from a small,
# non-root nginx. Build context is the repo ROOT: `docker build -f apps/web/Dockerfile .`.
#
# The client takes NO build-time configuration. It resolves the API base, game id, and
# token from the URL query string at runtime (apps/web/src/App.tsx / LiveApp.tsx), and it
# reads the session WebSocket URL from the API's game-view response (games/routes.ts:
# session.ws, built from the API's SESSION_WS_BASE). So there are no VITE_* build args and
# no per-deploy rebuild: one image serves any environment. CORS lives on the API, not here
# (DESIGN.md section 7): the API's CORS_ORIGIN must list this service's public origin.

# --- build ------------------------------------------------------------------------------
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# Emits apps/web/dist (fingerprinted index-*.js / index-*.css + index.html).
RUN pnpm --filter @crossy/web build

# --- runtime ----------------------------------------------------------------------------
# nginx-unprivileged runs as uid 101 (non-root) and can bind the high PORT Railway assigns.
# It ships the official envsubst entrypoint, so ${PORT} in the template is filled at start.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# Railway overrides PORT; 8080 is the local-run default (a non-root process cannot bind <1024).
ENV PORT=8080
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
# The base image's entrypoint runs envsubst on the template, then launches nginx.
