# Built from the repo root: docker build -f apps/orchestrator/Dockerfile .
FROM oven/bun:1.3.9-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/runner/package.json packages/runner/
COPY packages/workspace/package.json packages/workspace/
# Bun's isolated linker puts deps in per-workspace node_modules, so the whole
# tree is carried forward — copying only the root node_modules loses everything.
RUN bun install --frozen-lockfile \
  --filter '@specmate/orchestrator' --filter '@specmate/db' --filter '@specmate/core' \
  --filter '@specmate/workspace' --filter '@specmate/runner'

FROM oven/bun:1.3.9-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/var/lib/specmate/workspaces
# Workspaces are real git worktrees driven by the git CLI over ssh. The docker
# client is how RUNNER_BACKEND=docker starts a stage: this process talks to the
# host daemon over the mounted socket, so the CLI has to be in the image.
RUN apk add --no-cache git openssh-client docker-cli
COPY --from=deps /app /app
COPY packages packages
COPY apps/orchestrator apps/orchestrator
# Prompt assembly happens here, not in the runner: the container receives
# finished text, so the role prompts ship with this image and not with that one.
COPY roles roles

# The workspace root must exist with the runtime user's ownership before the
# volume is mounted over it, or the first write fails as a non-root process.
# The uid is pinned and shared with the runner image: both this process and the
# agent write into the same worktree, so they have to be the same user or the
# second one finds the first one's files unwritable.
RUN addgroup -g 10001 -S app && adduser -u 10001 -S app -G app \
  && mkdir -p "$WORKSPACE_ROOT" \
  && chown -R app:app /app /var/lib/specmate
USER app

EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4100/healthz || exit 1

CMD ["bun", "apps/orchestrator/src/index.ts"]
