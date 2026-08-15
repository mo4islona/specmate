## Context

See `proposal.md` — Why. The constraints that shape this design: a single owner, a single VM,
Bun as the only runtime, and a hard requirement that a server restart never loses a task. The
long-form architecture is `docs/plan.md` §3 and §9; this document records only what was decided
differently or more precisely than the plan states.

## Goals / Non-Goals

**Goals:**
- A stack the owner can start with one command and reach from a laptop or phone over a tailnet.
- A boot path where "the database is migrated" is a precondition, not a race.
- Enough of an API to prove the schema round-trips, without pretending the pipeline exists.

**Non-Goals:**
- Horizontal scale. One VM, one process per role; concurrency is bounded by the owner.
- Zero-downtime deploys. `docker compose up -d --build` with a few seconds of downtime is fine.
- Hiding the fact that Phase 0 does nothing useful yet — the UI says so out loud.

## Decisions

**Bun over Node.** One runtime, one package manager, native TypeScript execution, built-in test
runner and Postgres driver. Removes ts-node/tsx, a bundler for the backend, and a separate test
framework. Cost: a smaller ecosystem of battle-tested server libraries, accepted because the
service is single-user and self-hosted.

**Hono over NestJS/Fastify.** The plan left this open. Hono is runtime-agnostic, tiny, and its
`app.request()` makes handler tests possible without binding a port — the API test suite runs
against the app object directly. NestJS was rejected as more framework than a single-owner
control plane needs.

**Drizzle over hand-written SQL.** The schema is the domain model and will churn through
Phases 1–3; generated migrations with a checked-in journal keep the SQL reviewable while the
TypeScript types stay the single definition. The trade-off — a generation step that can drift —
is closed mechanically in CI: regenerating must produce no diff.

**Vite SPA over Next.js.** The plan said Next.js. A single-owner internal tool has no SEO, no
public traffic, and no need for SSR; a static bundle removes a Node server from the deployment.
Caddy serves the bundle and reverse-proxies `/api` so the SPA is same-origin and needs no CORS.
This diverges from `docs/plan.md` §8 deliberately.

**Migrations as a one-shot Compose service.** Running migrations from the API's entrypoint
would race when more than one process starts at once, and putting them in a manual step invites
the "why is the API 500ing" morning. A `migrate` service that must exit `0` before `api` and
`orchestrator` start makes the ordering explicit and visible in `docker compose ps`.

**Caps and budgets resolved at task creation.** Stored as complete objects on the task rather
than as sparse overrides merged at read time, so a task permanently records the limits it
actually ran under. Changing a default later cannot retroactively rewrite history.

**Bearer token over a login form.** No sessions, no cookies, no CSRF surface. The real
perimeter is the tailnet; this is the second lock.

**Images copy the whole install tree, not just the root `node_modules`.** Bun's isolated linker
places dependencies in per-workspace `node_modules` directories, so the conventional
"copy `/app/node_modules`" layer produces an image that boots and then fails on the first
import. Each image installs only the workspaces it needs (`--filter`) and carries the resulting
tree forward whole.

## Risks / Trade-offs

- **Bun-specific APIs (`Bun.serve`, `Bun.SQL`) lock the services to Bun** → the lock-in is
  confined to process entrypoints and `packages/db`; handlers are plain `Request`/`Response`.
- **Drizzle-generated SQL can diverge from the TypeScript schema** → CI regenerates and fails on
  any diff, so drift cannot reach `main`.
- **A bearer token is weak if the UI is ever exposed publicly** → default port bindings are
  loopback-only and the deployment story is Tailscale; public exposure is a deliberate act.
- **Postgres 18 changes the image's data directory layout** → the Compose volume mounts
  `/var/lib/postgresql` rather than `/var/lib/postgresql/data`; mounting the old path against an
  18 image silently produces an empty database.
- **Phase 0's smoke endpoints could be mistaken for the real task API** → they are documented as
  smoke-level and will be replaced, not extended, by the Phase 1 orchestrator API.

## Migration Plan

First change in the repo; there is nothing to migrate from. Rollback is `docker compose down`
and deleting the volume.

## Open Questions

- Whether the orchestrator keeps its own HTTP port past Phase 1, or reports health through the
  database instead. Deferring costs nothing: the probe contract is identical either way.
