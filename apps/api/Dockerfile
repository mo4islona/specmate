# Built from the repo root: docker build -f apps/api/Dockerfile .
FROM oven/bun:1.3.9-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
# Bun's isolated linker puts deps in per-workspace node_modules, so the whole
# tree is carried forward — copying only the root node_modules loses everything.
RUN bun install --frozen-lockfile \
  --filter '@specmate/api' --filter '@specmate/db' --filter '@specmate/core'

FROM oven/bun:1.3.9-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app /app
COPY packages packages
COPY apps/api apps/api

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1

CMD ["bun", "apps/api/src/index.ts"]
