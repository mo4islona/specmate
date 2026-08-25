# Built from the repo root: docker build -f apps/api/Dockerfile .
FROM oven/bun:1.3.9-alpine AS deps
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
# Bun's isolated linker puts deps in per-workspace node_modules, so the whole
# tree is carried forward — copying only the root node_modules loses everything.
RUN bun install --frozen-lockfile \
  --filter '@specmate/api' --filter '@specmate/db' --filter '@specmate/core' \
  --filter '@specmate/workspace' --filter '@specmate/github'

FROM oven/bun:1.3.9-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY packages packages
COPY apps/api apps/api
COPY apps/orchestrator apps/orchestrator

RUN apk add --no-cache git \
  && addgroup -g 10001 -S app \
  && adduser -u 10001 -S app -G app \
  && mkdir -p /var/lib/specmate/workspaces \
  && chown -R app:app /app /var/lib/specmate
USER app

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1

CMD ["bun", "apps/api/src/index.ts"]
