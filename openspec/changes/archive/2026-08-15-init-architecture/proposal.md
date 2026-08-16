## Why

SpecMate is a 24/7 single-owner service, and nothing else in the roadmap can be built or
tested until there is a running skeleton to build it in: a monorepo, a boot path, a database
to migrate against, and a way to bring the whole thing up on a server with one command.
This is Phase 0 of `docs/plan.md` — it deliberately ships no agent behaviour.

## What Changes

- Bun + TypeScript monorepo: `apps/{api,orchestrator,web}` and `packages/{core,db}`.
- Control plane (`api`) on Hono, exposing unauthenticated liveness/readiness probes and a
  password-guarded `/api/v1` surface with a smoke-level task and event read/write.
- Orchestrator process that holds a database connection, ticks, and shuts down cleanly.
  Its state machine lands in Phase 1; here it only proves the process boots and resumes.
- Web SPA (Vite + React + Tailwind) reduced to a single screen that reports API readiness.
- Docker Compose stack — `postgres`, one-shot `migrate`, `api`, `orchestrator`, `web` —
  where every long-running service waits on migrations completing successfully.
- Single-owner auth: one shared secret as a bearer token, mandatory when `NODE_ENV=production`.
- CI on GitHub Actions: Biome, TypeScript, OpenSpec validation, migrations against a real
  Postgres, unit tests, and a build of all three images.
- OpenSpec initialised in the repo so SpecMate is developed through SpecMate's own process.

## Capabilities

### New Capabilities
- `service-topology`: which processes exist, how they boot, how they report health, how the
  stack is started, and how the owner authenticates to it.

### Modified Capabilities
<!-- None: this is the first change in the repo. -->

## Impact

- New: the entire repo skeleton — `package.json` workspaces, `biome.json`, `tsconfig.base.json`,
  `docker-compose.yml`, per-app `Dockerfile`s, `.github/workflows/ci.yml`, `.env.example`.
- Postgres 18 becomes a hard runtime dependency of every service.
- Ports bound to loopback only; the service is expected to sit behind Tailscale/WireGuard.

## Non-goals

- No agent execution, no provider CLIs, no runner containers (Phase 1 and Phase 4).
- No workspace/worktree management, no git integration (Phase 1).
- No decisions, human gates, or Attention Inbox (Phase 2).
- No TLS termination or public exposure — nginx serves the SPA and proxies to the API only
  inside the compose network; production TLS is Phase 6.
