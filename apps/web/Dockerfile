# Built from the repo root: docker build -f apps/web/Dockerfile .
FROM oven/bun:1.3.9-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/github/package.json packages/github/
COPY packages/runner/package.json packages/runner/
COPY packages/workspace/package.json packages/workspace/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web
RUN bun run --cwd apps/web build

FROM nginx:stable-alpine AS runtime
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
