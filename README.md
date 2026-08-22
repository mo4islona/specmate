# SpecMate

SpecMate is a self-hosted team of AI agents that runs your software development lifecycle
for you — and manages itself while doing it. You describe a task; a pipeline of agents
(planner, researcher, spec writer, implementer, verifier, reviewer, summarizer) researches
it, writes a spec, implements it, checks its own work, and asks you only when it hits a
decision it can't make alone.

## Problems it solves

- **One flow.** Every task — feature, bugfix, later an incident — goes through the same
  pipeline instead of whatever process a given agent session improvises that day.
- **One code style.** Agents work from the same specs and the same standards every time, so
  the codebase doesn't drift between sessions or providers.
- **Everything through specs.** Nothing gets built from a vague prompt. Every change is a
  written OpenSpec artifact — reviewable, versioned, and reusable as context for the next
  stage instead of a sprawling chat transcript.
- **Decisions get checked, not assumed.** Anything an agent can't safely decide alone —
  an ambiguous requirement, a destructive action, a real trade-off — is escalated to a durable,
  answerable decision record instead of being quietly guessed.
- **Runs in the background.** It's a 24/7 service, not a session you have to babysit. Close
  your laptop; the pipeline keeps going.
- **Reachable from your phone.** Progress, gates, and decisions live behind a chat-style UI
  you can check and act on from anywhere.

## What it isn't

Not a CI/CD system — CI stays where it already is. Not multi-user — one owner, one set of
provider credentials. Nothing merges to a protected branch on its own; a human always
approves before that happens.

And not a service you run for other people. SpecMate authenticates to Claude with your own
subscription seat, which is what makes a self-hosted agent team affordable in the first place.
That seat is personal: use it for your own orchestrator, not to run SpecMate on someone else's
behalf and not to resell access to Claude. If you want it for something commercial, bill per
token with an API key instead — [`docs/install.md`](docs/install.md) covers the switch.

## Status

Under active development. Phase 1 is in progress: task intake, the orchestrator loop, and
the operator UI work end to end; richer decision cards and later phases are still ahead.
See [`docs/plan.md`](docs/plan.md) for the full architecture and roadmap, and
[`openspec/changes/`](openspec/changes/) for what's currently being built — SpecMate is
developed through OpenSpec from day one.

## Running it

`./install.sh` sets up a fresh box and tells you what it needs as it goes. It's resumable:
run it again and it re-checks each step and continues from wherever it stopped. See
[`docs/install.md`](docs/install.md) for what the steps are and how to fix one that goes red.

## Layout

```
apps/
  api/           control plane — Hono on Bun; probes, auth, task surface
  orchestrator/  the loop: poll, dispatch, advance, recover; plus the admin entry point
  web/           Vite + React SPA; served by nginx, proxied to the API
packages/
  core/          role catalog, RESULT.json contract, provider interface, pipeline catalog
  db/            Drizzle schema, generated migrations, connection factory
  workspace/     one git worktree per task, a commit per stage, artifact index
  runner/        prompt assembly, provider invocation, result capture, isolation
roles/           the role prompts, read by the orchestrator when it assembles a prompt
runner/          the runner image: a provider CLI and nothing of SpecMate
openspec/        the changes this repo is built from
install.sh       first-run installer; every step is a check plus a fix
docs/install.md  what the installer sets up, and how to fix a step that goes red
docs/plan.md     the full architecture and roadmap
```

## Development

```bash
bun install
docker compose up -d postgres
bun run db:migrate
bun run --cwd apps/api dev            # :4000
bun run --cwd apps/orchestrator dev   # :4100
bun run --cwd apps/web dev            # :5173, proxies /api to the API
```

```bash
bun run check       # Biome lint + format
bun run typecheck   # TypeScript, per workspace
bun test            # unit tests; API tests need DATABASE_URL and skip without it
bun run ci          # everything CI runs, including openspec validate
```

Every change is proposed, implemented, and archived as an OpenSpec change under
`openspec/changes/` (`bunx openspec list|show|validate|archive`, or `/opsx:propose`,
`/opsx:apply`, `/opsx:archive` in Claude Code). Requirements: Bun ≥ 1.3, Docker with
Compose, Postgres 18. For agent-runner setup and orchestrator internals, see
[`docs/plan.md`](docs/plan.md).
