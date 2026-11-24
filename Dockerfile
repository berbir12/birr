# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN npm i -g pnpm@12.23.0
WORKDIR /app

FROM base AS deps
# Build tools only matter if better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/miniapp/package.json apps/miniapp/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/parser/package.json packages/parser/
RUN pnpm install --frozen-lockfile

FROM deps AS build-web
COPY . .
RUN pnpm --filter @birr/miniapp build

# ---- API + bot ----
FROM deps AS server
COPY . .
ENV NODE_ENV=production
# The named volume is created from this directory, so it inherits node's ownership.
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/apps/server
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run tsx directly (not via pnpm) so SIGTERM reaches the app for a clean SQLite shutdown.
CMD ["./node_modules/.bin/tsx", "src/index.ts"]

# ---- Caddy serving the Mini App and reverse-proxying the API ----
FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build-web /app/apps/miniapp/dist /srv/miniapp
