# Core API image (apps/api). Multi-stage, pnpm workspace-aware, prod-only final stage,
# non-root. Build context is the repo ROOT (this needs the lockfile and every workspace
# manifest to resolve deps): build with `docker build -f apps/api/Dockerfile .` from root.
#
# The services have no compile/emit step: workspace packages export TypeScript source
# directly (e.g. @crossy/db -> ./src/index.ts) and the app source uses extensionless,
# bundler-style imports, so plain `node` cannot run them. `tsx` is the settled TS runtime
# (it is what the harness and dev:stack already spawn). The final stage therefore ships a
# pinned tsx plus a prod-only dependency tree produced by `pnpm deploy --prod`.

# --- deps + prune -----------------------------------------------------------------------
# Node 24 honors .node-version (repo pins "24"). bookworm-slim (glibc) keeps native deps
# (esbuild under tsx) reproducible; the few extra MB over alpine do not matter at this scale.
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Copy the whole workspace. The .dockerignore already strips node_modules, dist, tests,
# and dev-only trees, so this is the manifests plus package source, nothing heavy.
COPY . .

# One deterministic install for the whole workspace (frozen lockfile is the launch gate).
RUN pnpm install --frozen-lockfile

# Prune to a self-contained, prod-only tree: app source, its workspace deps' source
# (@crossy/*), and only production external deps (hono, @hono/node-server, pg, drizzle-orm).
# --legacy copies from the content-addressable store, which the frozen install populated.
RUN pnpm --filter @crossy/api deploy --prod --legacy /prod/api

# --- runtime ----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# The core API listens on PORT (code default 8080). Railway overrides PORT at deploy time.
ENV PORT=8080

# Pin the TS runtime to the lockfile version so the image matches local + CI exactly.
# Installed as root before dropping privileges; its bin lands on PATH at /usr/local/bin.
RUN npm install -g tsx@4.23.0 && npm cache clean --force

WORKDIR /app
# Copy the pruned tree owned by the unprivileged `node` user baked into the base image.
COPY --from=build --chown=node:node /prod/api ./

USER node
EXPOSE 8080
# Entry is the runtime composition root (apps/api/src/server.ts -> src/server.ts here).
CMD ["tsx", "src/server.ts"]
