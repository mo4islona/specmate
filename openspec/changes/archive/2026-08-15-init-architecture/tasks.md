## 1. Repo foundations

- [x] 1.1 Initialise the git repository on `main` and run `openspec init` (verify: `openspec list` runs)
- [x] 1.2 Create the Bun workspace root — `package.json` with `apps/*` and `packages/*` (verify: `bun install` resolves all workspaces)
- [x] 1.3 Add `biome.json` and `tsconfig.base.json` (verify: `bun run check` and `bun run typecheck` exit 0)
- [x] 1.4 Add `.gitignore`, `.dockerignore`, and `.env.example` (verify: `git status` shows no `node_modules` or `.env`)
- [x] 1.5 Move the long-form plan to `docs/plan.md` and reference it from `openspec/config.yaml`

## 2. Control plane

- [x] 2.1 Validate configuration at startup, treating empty strings as unset (verify: `apps/api/src/config.ts`; starting without `DATABASE_URL` exits non-zero)
- [x] 2.2 Implement constant-time bearer-token auth over `/api/*` (verify: `apps/api/test/app.test.ts` 401 cases)
- [x] 2.3 Serve `/healthz` and `/readyz` unauthenticated, with `/readyz` pinging the database (verify: `curl` both against a live stack)
- [x] 2.4 Add the smoke surface — create/list tasks and read a task's events (verify: `bun test`)
- [x] 2.5 Handle `SIGINT`/`SIGTERM` by draining and exiting `0` (verify: `kill -TERM` leaves exit status 0)

## 3. Orchestrator

- [x] 3.1 Boot with a validated environment and hold a database connection (verify: `apps/orchestrator/src/index.ts`)
- [x] 3.2 Run a tick loop that refreshes database reachability (verify: `/readyz` reports a rising tick count)
- [x] 3.3 Expose `/healthz` and `/readyz` and shut down cleanly on signals (verify: `kill -TERM` logs and exits 0)

## 4. Web client

- [x] 4.1 Scaffold the Vite + React + Tailwind SPA (verify: `bun run --cwd apps/web build` succeeds)
- [x] 4.2 Report API readiness on the single screen and state that the pipeline arrives in Phase 1 (verify: open the built page against a live API)
- [x] 4.3 Proxy `/api` and `/readyz` to the API in dev (Vite) and in production (Caddy) so the SPA is same-origin

## 5. Deployment skeleton

- [x] 5.1 Write per-app Dockerfiles that build from the repo root and run as a non-root user (verify: `docker build -f apps/<svc>/Dockerfile .`)
- [x] 5.2 Write `docker-compose.yml` with Postgres 18, mounting the volume at `/var/lib/postgresql` (verify: `docker compose config`)
- [x] 5.3 Add the one-shot `migrate` service and gate `api`/`orchestrator` on it completing successfully (verify: `docker compose up` ordering)
- [x] 5.4 Bind every published port to `127.0.0.1` (verify: `docker compose config` shows loopback bindings)
- [x] 5.5 Add container healthchecks to each service (verify: `docker compose ps` reports healthy)

## 6. CI

- [x] 6.1 Run Biome, TypeScript, and `openspec validate --all --strict` on every push and PR
- [x] 6.2 Apply migrations against a real Postgres 18 service container and run `bun test`
- [x] 6.3 Fail the build when regenerating migrations produces a diff (verify: the guard step in `.github/workflows/ci.yml`)
- [x] 6.4 Build all three images with layer caching (verify: the `docker images` matrix job)

## 7. Acceptance

- [x] 7.1 `bun run check`, `bun run typecheck`, and `bun test` all pass locally
- [x] 7.2 Migrations apply to an empty Postgres 18 and create every table in the data model
- [x] 7.3 API and orchestrator both answer `/healthz` and `/readyz` against that database
- [x] 7.4 `docker compose up -d --build` brings the whole stack to healthy, with the SPA reaching the API same-origin
