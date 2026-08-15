# SpecMate

A single-owner, self-hosted service that runs a graph of AI agents over OpenSpec artifacts:
planner → researcher → spec writer → implementer → verifier → reviewer → summarizer. Every
decision the agents cannot make alone is surfaced to the human in a chat UI; every approved
spec is published to a shared wiki.

The long-form plan is [`docs/plan.md`](docs/plan.md). SpecMate is developed through OpenSpec
from day 0 — each roadmap phase ships as one or more changes under `openspec/changes/`.

**Status: Phase 1, in progress.** Workspaces are provisioned per task and committed per stage;
a stage can now be executed against a real repository. The state machine that decides which
stage runs is the next change.

## Layout

```
apps/
  api/           control plane — Hono on Bun; probes, auth, task surface
  orchestrator/  the state machine's process (Phase 1); today a tick loop
  web/           Vite + React SPA; served by Caddy, proxied to the API
packages/
  core/          role catalog, RESULT.json contract, provider interface, state machine
  db/            Drizzle schema, generated migrations, connection factory
  workspace/     one git worktree per task, a commit per stage, artifact index
  runner/        prompt assembly, provider invocation, result capture, isolation
roles/           the role prompts, read by the orchestrator when it assembles a prompt
runner/          the runner image: a provider CLI and nothing of SpecMate
openspec/        the changes this repo is built from
docs/plan.md     the full architecture and roadmap
```

## Requirements

Bun ≥ 1.3, Docker with Compose, Postgres 18 (via Compose or your own).

## Running the stack

```bash
cp .env.example .env          # set POSTGRES_PASSWORD, and SPECMATE_PASSWORD for production
docker compose up -d --build  # postgres → migrate → api, orchestrator, web
```

The web client is on `http://127.0.0.1:5173`, the API on `http://127.0.0.1:4000`. Every port
binds to loopback: the service is meant to be reached over a tailnet, not the open internet.

## Local development

```bash
bun install
docker compose up -d postgres
bun run db:migrate
bun run --cwd apps/api dev            # :4000
bun run --cwd apps/orchestrator dev   # :4100
bun run --cwd apps/web dev            # :5173, proxies /api to the API
```

## Checks

```bash
bun run check       # Biome lint + format
bun run typecheck   # TypeScript, per workspace
bun test            # unit tests; API tests need DATABASE_URL and skip without it
bun run ci          # everything CI runs, including openspec validate
```

Schema changes need a regenerated migration — `bun run db:generate` — and CI fails if the
checked-in migrations drift from `packages/db/src/schema.ts`.

## Working on a change

```bash
bunx openspec list                        # active changes
bunx openspec show <change>               # read one
bunx openspec validate --all --strict     # what CI enforces
bunx openspec archive <change>            # after it ships
```

In Claude Code, `/opsx:propose`, `/opsx:apply`, and `/opsx:archive` drive the same flow.

## The agent runner

A stage runs in its own container, started for that stage and discarded when it ends. The
container gets the task's worktree and the provider's stored session — not the database
credential, not the repository key, not another task's files. It is an image, never a
long-lived service: `docker compose up` starts no runner.

Two settings decide how a stage runs:

- `RUNNER_BACKEND=docker` isolates it. This is the production setting, and it needs the
  container runtime socket mounted into the orchestrator — which is effectively root on the
  host. That is accepted for a single-owner deployment on a private network; it is what keeps
  an agent that runs a foreign repository's code away from this process.
- `RUNNER_BACKEND=local` runs the provider as a child of the orchestrator, for development on a
  laptop. It provides no isolation, so the orchestrator refuses to start with it when
  `NODE_ENV=production`.

`WORKSPACE_ROOT` must be one absolute path that means the same thing on the host and inside the
orchestrator — see the note in `.env.example`. Startup probes it and refuses to run if the two
disagree, because the alternative is an agent silently seeing an empty repository.

### One-time provider login

```bash
docker compose build runner                  # needs CLAUDE_CODE_VERSION set in .env
docker compose run --rm runner claude        # log in; the session persists in a named volume
```

### Running a single stage by hand

```bash
bun apps/orchestrator/src/run-stage.ts --task <task-uuid> --role researcher
```

Assembles the prompt, runs the provider, checks what it wrote against the role's contract, and
commits on success. This is how a prompt or image change is verified before the loop exists to
schedule it.

## Authentication

One owner, one secret. `SPECMATE_PASSWORD` is sent as `Authorization: Bearer <secret>` and
guards everything under `/api/`. `/healthz` and `/readyz` stay open so container healthchecks
work. The API refuses to start in production without a secret configured.
