# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN npm i -g pnpm@12.23.0
WORKDIR /app

FROM base AS deps
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
USER node
EXPOSE 8787
CMD ["pnpm", "--filter", "@birr/server", "start"]

# ---- Caddy serving the Mini App and reverse-proxying the API ----
FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build-web /app/apps/miniapp/dist /srv/miniapp
