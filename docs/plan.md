# SpecMate — OpenSpec-Driven Agent Orchestration Service
## Full Implementation Plan

> Name: **SpecMate**. A 24/7 self-hosted service that takes a feature/bugfix task, runs a graph of AI agents (researcher → spec writer → implementer → reviewer) through OpenSpec-shaped artifacts, surfaces every human decision in a chat UI, and publishes the approved spec to a shared wiki.

---

## 1. Goals & Non-Goals

### Goals
1. **One-click task launch** — feature, bugfix, or (in a later phase) a production incident, described in natural language, optionally pointing at a repo/branch. Task types are a growing catalog, not a closed pair.
2. **Research agent** produces an OpenSpec change (`proposal.md`, `specs/`, `design.md`, `tasks.md`) describing *how* to do the fix.
3. **Reviewer agent** critiques the research/implementation at the end of each cycle.
4. **Bounded research↔review loop** — iterate until the reviewer approves or the iteration budget is exhausted; **every decision the agents cannot make alone is escalated to the human and highlighted in the UI**.
5. **Final summary artifact** — a concise "what was done and how" document with diagrams (D2, Mermaid where GitHub renders natively), plus the ability to send the task back for rework **without context bloat**: agent context is reconstructed from task-scoped OpenSpec artifacts, not from a growing chat transcript.
6. **Human approval gate** — after final approval, the spec is archived in its repo (`openspec/changes/archive/…`) and published on the shared wiki site, rendered straight from that archive.
7. **Chat-style UI** — sidebar with all running tasks; opening a task shows the planned agent graph (DAG) and which stage is active.
8. **24/7 remote operation** on a server, single-user: everything runs on the owner's own subscriptions/accounts.
9. **Provider-agnostic agents** — Claude Code, Codex, Copilot CLI (and future CLIs) are interchangeable executors behind fixed *roles*. Input and output of every role is always SDD (OpenSpec) artifacts.
10. **Postgres** as the durable source of truth for tasks, runs, decisions, and artifacts index.
11. **Dogfooding** — SpecMate itself is developed through OpenSpec from day one.
12. **Self-learning is a must-have** — the process must improve while it runs. Every human comment (rework notes, decision answers, redirects) is captured as structured feedback and periodically distilled into improvements of role prompts and orchestrator policies — themselves shipped as OpenSpec changes through the pipeline. Corollary: **the UI ships as early as possible**, because the human's comments are the training signal and they arrive through the UI.

### Non-Goals (v1)
- Not a general CI/CD system — it orchestrates *spec + code production*, CI stays where it is.
- **No multi-user** — the service is personal by design: one owner, one set of provider credentials, simple auth (single password / Tailscale). This removes accounts, RBAC, per-user credential routing, and OAuth login from scope entirely.
- No auto-merge to protected branches — output is a branch/PR + spec, humans merge.

---

## 2. Core Concepts & Domain Model

| Concept | Description |
|---|---|
| **Task** | The unit of work: "add dark mode", "fix reorg bug in ingester", "API p99 is 30s, find out why". Has a lifecycle, a target repo, and a type (feature/bugfix; incident in a later phase). The type selects the pipeline. |
| **Change** | The OpenSpec change folder for the task (`openspec/changes/<task-slug>/`). This is the *stateful context* — the single place agents read from and write to. |
| **Pipeline definition** | A versioned, declarative graph for one task type: stages, loop edges with caps, human gates, terminal outcome. Pipelines are data interpreted by one generic engine; the Planner parameterizes them but cannot invent nodes. |
| **Run graph** | The task's pinned copy of its pipeline: the DAG of agent stages actually run, instantiated from the pipeline definition at creation. Rendered in the UI. |
| **Stage** | One node in the graph: role + provider + input artifacts + output artifacts. |
| **Agent role** | Abstract responsibility (Researcher, Spec Writer, Implementer, Reviewer, Summarizer). |
| **Provider** | Concrete executor: `claude-code`, `codex`, `copilot`. A role binds to a provider per stage. |
| **Decision** | A question agents cannot resolve (ambiguous requirement, destructive action, trade-off). Blocks the stage, surfaces in UI, answer is written back into the change folder. |
| **Summary artifact** | Human-facing report: what/how/why, D2 diagrams (SVG), links to diffs and spec. |
| **Workspace** | An isolated checkout (git worktree or container volume) where a stage runs. |
| **Context sources** | Versioned knowledge injected into stages, revision recorded: the spec standard (how to write specs), the system map (`wiki/system/` — how the application works across repos: services, contracts, mutual expectations), the ops map (`wiki/ops/` — how it is run: environments, dashboards, access pointers, incident policy; secret material stays on the host). The maps live in the single `wiki` repo (arrives in Phase 4); published specs are not copied there — the wiki site renders them straight from each product repo's archive (Phase 6). |

### Why "context lives with the task" works
Every stage starts with a **fresh agent context**. The prompt is assembled from:
1. The role's system prompt (small, static).
2. The current state of the OpenSpec change folder (proposal/specs/design/tasks + reviewer notes).
3. A short structured **task ledger** (decisions made, iterations count, open questions) stored in Postgres and rendered as markdown.

Nothing else is carried over. Rework = edit the artifacts + append a rework note to the ledger, then re-run the affected stages with fresh context. Context size is bounded by artifact size, not by history length. This mirrors OpenSpec's own guidance that it benefits from a clean context window between phases.

---

## 3. High-Level Architecture

```
┌────────────────────────────── Remote Server (24/7) ─────────────────────────────┐
│                                                                                  │
│  ┌───────────┐   REST/WS    ┌──────────────────┐        ┌────────────────────┐   │
│  │  Web UI   │◄────────────►│   API Gateway    │◄──────►│     PostgreSQL     │   │
│  │ (Next.js) │              │  (control plane) │        │ tasks/runs/events  │   │
│  └───────────┘              └───────┬──────────┘        └────────────────────┘   │
│                                     │ job queue (pg-based: Graphile Worker/River)│
│                             ┌───────▼──────────┐                                 │
│                             │   Orchestrator   │  plans DAG, enforces loop caps, │
│                             │  (state machine) │  emits decisions, retries       │
│                             └───────┬──────────┘                                 │
│              ┌──────────────────────┼───────────────────────┐                    │
│      ┌───────▼───────┐      ┌───────▼───────┐       ┌───────▼───────┐            │
│      │ Agent Runner  │      │ Agent Runner  │  ...  │ Agent Runner  │            │
│      │ container:    │      │ container:    │       │ container:    │            │
│      │ claude-code   │      │ codex CLI     │       │ copilot CLI   │            │
│      └───────┬───────┘      └───────┬───────┘       └───────┬───────┘            │
│              └─────────── git worktrees / task workspaces ──┘                    │
│                                     │                                            │
│                          ┌──────────▼─────────┐     ┌──────────────────┐         │
│                          │  Git host (GitHub) │     │  Wiki repo       │         │
│                          │  branches + PRs    │     │ system/ + ops/   │         │
│                          └────────────────────┘     └──────────────────┘         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Components
1. **Control plane (API)** — TypeScript (NestJS/Fastify) or Go. CRUD for tasks, WS event stream for the UI, decision endpoints, webhook receivers.
2. **Orchestrator** — a durable state machine per task. Recommended: **plain Postgres-backed job queue + explicit state machine** (Graphile Worker / River / pgboss) rather than Temporal in v1 — one fewer moving part, Postgres is already required. (Temporal is a valid Phase-2 upgrade if graphs get complex.)
3. **Agent runners** — one Docker image per provider, each containing the CLI (`claude`, `codex`, `copilot`) + OpenSpec CLI. Runner receives a job: `{task, stage, role, workspace, artifacts_in}` → executes the CLI headless (e.g. `claude -p`, `codex exec`) → commits artifact changes → reports structured result.
4. **Workspace manager** — clones target repo, creates `task/<slug>` branch, mounts it into runner containers; one worktree per task, wiped on archive.
5. **Postgres** — durability: tasks survive restarts, crashed stages are retried, event log is replayable.
6. **UI** — Next.js chat-style app (details in §7).
7. **Wiki publisher** — v1 triggers the archive in the product repo and rebuilds the wiki site (MkDocs/Docusaurus), which renders every repo's archived specs together with the `wiki` repo's `system/` and `ops/` maps (§14 Phase 4); no spec copies leave their repos. Later: Notion/Confluence adapters behind a sink interface.

---

## 4. Agent Roles (fixed) × Providers (variable)

**Contract: every role consumes and produces OpenSpec artifacts. Providers are interchangeable.**

| Role | Input | Output | Default provider | Alt |
|---|---|---|---|---|
| **Planner** | Task description, repo map | Run graph (JSON DAG) + **kickoff brief** (early `proposal.md`: what/how/key points/open questions) | Claude | Codex |
| **Researcher** | Task + codebase | `proposal.md`, `design.md`, `specs/` (requirements & scenarios), open questions → decisions | Claude | Codex |
| **Spec Writer** | Researcher output + human answers | Finalized `specs/` + `tasks.md` checklist | Claude | Codex |
| **Implementer** | `tasks.md` + `design.md` | Code on task branch, tasks checked off | Codex / Claude | Copilot |
| **Verifier** | Diff + repo test harness + `specs/` scenarios | Harness runs (state-emulating tests) mapped to spec scenarios; `verification.md` with pass/fail evidence | Codex / Claude | any |
| **Reviewer** | Diff + full change folder | `review.md`: verdict `approve / revise / escalate` + itemized findings | *Different provider than the writer* (cross-model review) | any |
| **Summarizer** | Everything above | `summary.md` + **D2 diagrams** (Mermaid fallback for GitHub-rendered surfaces) + PR description | Claude | — |

Rules:
- **Cross-provider review by default** — if Claude wrote, Codex reviews (and vice versa). Cheap way to reduce shared blind spots.
- Role prompts live in versioned files (`roles/researcher.md`, …) in the SpecMate repo — themselves managed via OpenSpec.
- Roles carry capability bits enforced mechanically by the runner, not by prompt: "may modify product code" (implementer and verifier only) and — only if incident *mitigation* ever lands (Phase 8+) — "may act on production" (**Operator**, a deferred role, the only one that would ever hold production credentials; every action gated and audited). Incident *investigation* (Phase 4) needs no production credentials: its diagnosis tools are read-only.
- Provider adapters implement one interface:
  ```ts
  interface AgentProvider {
    run(job: StageJob): Promise<StageResult>; // headless CLI invocation in workspace
    healthcheck(): Promise<ProviderStatus>;   // auth/session validity
  }
  ```
- Structured output is enforced: each role must end its run by writing a `RESULT.json` (`{status, artifacts_changed, decisions_needed[], notes}`) that the runner parses. If missing/invalid → one retry, then stage fails → escalation.

---

## 5. The Loop (research ↔ review) — bounded, decision-aware

The orchestrator is a generic engine that walks a **pipeline definition** — pipelines are data,
not code. The engine owns the type-independent invariants: loops are capped, gates block, cap
exhaustion escalates instead of looping, budgets pause instead of failing, and an interrupted
task resumes where it stopped. What follows is the **feature/bugfix pipeline**, the first
definition in the catalog (the incident-investigation pipeline is Phase 4):

```
 DRAFT ──► PLANNING ──► KICKOFF_BRIEF ──► HUMAN_KICKOFF_GATE ──► RESEARCH ──► SPEC_REVIEW ─┬─► approve ──► HUMAN_SPEC_GATE ──► IMPLEMENT ──► VERIFY ──► CODE_REVIEW ─┬─► approve ──► SUMMARIZE ──► HUMAN_FINAL_GATE ──► PUBLISH ──► ARCHIVED
                              ▲                    │ edit/redirect        ▲                 └─► revise (i < N)                     ▲                       └─► revise (j < M)                   │
                              └────────────────────┘                      └─────────────────────┘                                  └───────────────────────────┘             rework ◄───────────┘
```

### Kickoff Brief — the first artifact the human sees
Right after the Planner assesses the task (before any deep research), it produces a **one-page kickoff brief** and posts it into the chat as an approval card. This is deliberately shallow — no implementation details:

- **What** we're going to do (2–4 sentences) and **why** (the problem).
- **How, at a high level** — approach in 3–5 bullets, proposed agent graph attached.
- **Key points highlighted** — risks, blast radius, anything irreversible, notable trade-offs (a dedicated `⚠ Key points` block, visually accented in the card).
- **Open questions** — zero or more; each becomes a Decision the human can answer inline. If there are none, the card says so explicitly.
- Rough size estimate (S/M/L) and expected iteration budget.

Implementation-wise this is just OpenSpec's `proposal.md` in its earliest draft form (Why / What Changes / Impact) plus open questions — no new artifact type needed, so v1 can literally start from stock OpenSpec. The human's verdict on the card: **Approve → RESEARCH**, **Redirect** (comment → Planner regenerates the brief, capped at 2 regenerations), or **Cancel**. Answers and edits are written into `proposal.md` / `decisions.md`, so research starts from an already-aligned base — this is the cheapest correction point in the whole pipeline.

Anti-infinite-loop mechanics (all enforced by the orchestrator, not by agents):
1. **Hard iteration caps**: `max_spec_iterations` (default 3) and `max_impl_iterations` (default 3), per task, configurable.
2. **Progress check**: reviewer must return *strictly fewer or different* blocking findings each round; if the same finding IDs repeat twice → auto-escalate to human instead of looping.
3. **Budget caps**: wall-clock and token/cost budget per task; exceeding → pause + escalation.
4. **Escalation is a first-class outcome**: `escalate` verdict creates a **Decision** record → task enters `WAITING_HUMAN`, the UI highlights it (badge on task in sidebar, banner in task view, optional Slack/Telegram ping). The human's answer is appended to the change folder (`decisions.md`) and the loop resumes.
5. **Three mandatory human gates**: kickoff brief (before research — align on intent while it costs nothing), spec approval (before code is written), and final summary (before publish). Everything else can auto-flow.

Rework after the final summary:
- Human writes rework comments in the UI → stored as a Decision + appended to `decisions.md` → orchestrator re-plans *only the affected stages* (e.g. back to IMPLEMENT, not RESEARCH) → agents start with fresh context assembled from updated artifacts. Iteration counters for the new round reset with their own cap.

---

## 6. Verification Policy — real harnesses, not just unit tests

**Rule: no PR leaves the pipeline verified by "init tests" alone.** Every implemented change must be exercised by a **test harness** that emulates and validates *system states* — spinning up the service (or a faithful simulation of it), driving it through the scenarios written in `specs/`, and asserting on observable state, not just function outputs. Unit tests remain, but they are the floor, not the bar.

### Harness probe (during PLANNING)
The Planner runs a **harness probe** against the target repo before the kickoff brief:
- Detects what exists: e2e suites, integration tests with real dependencies (testcontainers, docker-compose test env), simulators/state-machine tests, fixtures that reproduce production-like states.
- Classifies the repo: `harness: adequate | partial | missing` for the area the task touches (not repo-wide — a repo can have a great API harness and nothing for its ingestion path).

### Consequences, surfaced in the Kickoff Brief
- **adequate** → normal flow; Verifier extends the harness with scenarios derived 1:1 from `specs/` (OpenSpec scenarios double as the test plan).
- **partial / missing** → the brief's `⚠ Key points` block gets a mandatory warning: *"No state-level harness covers X — results can't be properly validated."* The human chooses on the card:
  1. **Split the task in two** (default recommendation): Task A = build the harness for this area (its own OpenSpec change, reviewed and merged first), Task B = the original fix, blocked on A. The orchestrator creates the dependency automatically (`tasks.blocked_by`).
  2. **Proceed with best-effort verification** — explicitly acknowledged risk, recorded as a Decision; the final summary and PR description carry a visible "verified without state harness" badge.
  3. Cancel/redefine.

### Verifier stage mechanics
- Runs after IMPLEMENT, before CODE_REVIEW (reviewer sees the harness evidence, not just the diff): `IMPLEMENT → VERIFY → CODE_REVIEW`.
- Every `specs/` scenario must map to at least one harness assertion; unmapped scenarios fail the stage (traceability check is mechanical, done by the runner, not trusted to the agent).
- Output `verification.md`: scenario → test → result matrix, logs/artifacts of the runs, plus a diff of harness code added. Harness code goes into the same PR (or the split-off Task A PR).
- Flaky-run policy: a failed harness run retries once; two distinct failures → back to IMPLEMENT (counts against `max_impl_iterations`); repeated identical failure across rounds → escalate.
- Runner containers get docker-in-docker (or a sidecar compose profile) so testcontainers-style harnesses work headless on the server.


---

## 7. Data Model (Postgres)

```sql
-- providers (single owner, so no accounts table)
provider_credentials(id, provider /* claude|codex|copilot */,
                     auth_state /* ok|expired */, meta jsonb, updated_at)

-- tasks
tasks(id, slug, title, type /* feature|bugfix */, repo_url, base_branch,
      status, blocked_by uuid[] /* task splits: harness-first */,
      harness_status /* adequate|partial|missing|waived */,
      budgets jsonb, caps jsonb,
      created_at, updated_at)

-- planned graph & execution
run_graphs(id, task_id, version, dag jsonb /* nodes, edges, role, provider */, created_at)
stages(id, task_id, graph_id, node_key, role, provider,
       status /* pending|running|succeeded|failed|skipped|waiting_human */,
       attempt, started_at, finished_at, cost jsonb, result jsonb)

-- loop control
iterations(id, task_id, loop /* spec|impl */, round, reviewer_verdict,
           findings jsonb, created_at)

-- human-in-the-loop
decisions(id, task_id, stage_id, kind /* question|escalation|rework|approval */,
          prompt_md, options jsonb, answer_md, answered_by, status /* open|answered */,
          created_at, answered_at)

-- artifacts index (content lives in git; DB stores pointers + snapshots for UI)
artifacts(id, task_id, path, kind /* proposal|spec|design|tasks|review|summary|decision_log */,
          git_sha, snapshot_md, updated_at)

-- spec-standard skill sync
skill_sources(id, repo_url, ref, path, current_sha, synced_at, enabled)
-- PR tracking for the attention inbox
pull_requests(id, task_id, url, state /* open|merged|closed */, checks_state, updated_at)

-- self-learning signal
feedback(id, task_id, stage_id, role, provider,
         kind /* redirect|decision_answer|spec_edit|rework|overrule */,
         text_md, prompt_versions jsonb, created_at)

-- audit / replay / UI stream
events(id, task_id, stage_id, type, payload jsonb, created_at)  -- append-only
```

Notes:
- **Git is the artifact store; Postgres indexes it.** Artifact `snapshot_md` is cached for instant UI rendering; git SHA is the truth.
- `events` powers the WS live view, debugging, and cost accounting.
- Everything the orchestrator does is idempotent on `stages.attempt` — server restart resumes cleanly (the "don't lose the task" requirement).

---

## 8. UI (chat-style)

Layout:
- **Attention Inbox — the home screen.** One screen aggregating *everything that needs the human right now*, across all tasks: open Decisions & escalations, kickoff briefs awaiting approval, specs at HUMAN_SPEC_GATE, summaries at HUMAN_FINAL_GATE, **unmerged PRs** (task done but PR still open — tracked via GitHub webhook/poll), stalled tasks (no progress > X hours), expired provider auth, budget/credit warnings, pending skill-update PRs. Each item is one tap away from its action (approve/answer/open PR). Empty inbox = nothing needs you; this is the screen the iPhone push deep-links into.
- **Sidebar** — all tasks grouped by status (`Needs your input` pinned on top with a highlight color, then Running, Waiting, Done). Each item: title, stage chip, spinner/badge.
- **Main pane — per task**:
  1. **Graph header**: the planned DAG rendered (React Flow), nodes colored by status (pending/running/done/failed/**waiting-human pulsing**). Click a node → its logs, cost, artifacts.
  2. **Chat timeline**: system events, agent summaries per stage (short, human-written by Summarizer-lite), and **Decision cards** — visually distinct (accent border, "Your decision needed") with options/buttons + free-text answer, exactly the "решения должны подсвечиваться" requirement. The **Kickoff Brief card** is the first thing in every task's chat: rendered brief with the `⚠ Key points` block accented, inline answers for open questions, and Approve / Redirect / Cancel buttons.
  3. **Artifacts tab**: rendered proposal/specs/design/tasks/review/summary with diff-since-last-approval view; **D2 rendered inline** (d2 WASM/JS runtime or a Kroki sidecar), Mermaid supported as fallback.
  4. **Actions**: Approve spec / Approve & publish / Send back for rework (with comment) / Pause / Cancel / Adjust caps.
- **New task**: chat input at the bottom of a "New task" thread — type the ask, pick repo, type (feature/bugfix), optional provider preset ("Claude writes, Codex reviews"), budget. Planner replies in-thread with the proposed graph for confirmation.
- **Notifications**: browser push + Slack/Telegram webhook on any open Decision (since the service runs while you sleep).

Stack: Next.js + React Flow (DAG) + D2 renderer (WASM or Kroki sidecar) + shadcn/ui; WS (or SSE) from the events table.

This section is the shape the UI was planned as, and it is where the task screen grew from. What
it is being rebuilt into — one-row header, a nav column of tabs, a feed of what people said, and a
rail carrying the machine — is §16.1; the argument for the change is
[`docs/design/task-screen-pass-3.md`](./design/task-screen-pass-3.md).

---

## 9. Runtime & 24/7 Operation (single user)

1. **Deployment**: single VM (Hetzner/EC2) + Docker Compose in v1: `api`, `orchestrator`, `postgres`, `web` (nginx serves the SPA, proxies `/api`, and terminates TLS), `runner-claude`, `runner-codex`, `runner-copilot`. k8s only if/when concurrency demands it.
2. **Provider auth (the tricky part)**:
   - Claude Code: authenticate once interactively inside the runner container; persist the session/config dir as a Docker volume. Prefer subscription session where allowed; API key fallback.
   - Codex / Copilot: same pattern — persisted auth volume per provider.
   - **Auth watchdog**: hourly `healthcheck()` per credential; on expiry → global banner in UI + notification ("re-login needed on runner-claude"), tasks depending on it pause instead of failing.
   - Note (Aug 2026 policy): subscription auth is only legitimate through official tools — Claude Code CLI / Claude Agent SDK on your own account (headless usage draws from the separate monthly Agent SDK credit); third-party harnesses bridging subscription OAuth are banned and blocked. Our runner design (official CLIs/SDK only) is the compliant shape.
   - Check each provider's ToS for headless/server use of consumer subscriptions; be ready to fall back to API billing.
3. **Access**: single user — protect the UI with one strong password or, better, don't expose it publicly at all: put the server on Tailscale/WireGuard and reach the UI over the tailnet from laptop and iPhone. No accounts, no OAuth, no credential routing.
4. **Isolation & safety**: runners have no credentials except the git deploy key + their provider session; network egress allowlist; workspaces are throwaway worktrees; agents never touch `main` directly.
5. **Reliability**: healthchecks + `restart: always`; orchestrator resumes in-flight stages from Postgres on boot; nightly `pg_dump` + auth-volume backup.

---

## 10. Wiki Publishing (post-approval)

No copies: archived specs stay canonical in their product repos, and the wiki **site** renders
them from there. The `wiki` repo (created in Phase 4) holds only the system and ops maps; the
service catalog in `wiki/system/` names the repos the site build pulls archives from.
- On final approval: run `openspec archive` semantics in the product repo (change folder → `openspec/changes/archive/…`, `specs/` updated), then trigger the site rebuild (MkDocs Material or Docusaurus via CI) — it renders each repo's archived changes (`summary.md` + spec deltas) together with the wiki maps into one browsable site. D2 sources live in the archived change; the site build **pre-renders SVGs** (d2 CLI); PR descriptions get Mermaid, since that's what GitHub renders natively in markdown.
- Later: adapters for Notion/Confluence behind a `WikiSink` interface, exporting the same rendered material.

---

## 11. Spec Standard & Skill Sync

SpecMate uses OpenSpec as the **process/transport** and a house **spec standard** (a conformance suite: `REQ-n` with acceptance criteria, `DEF/OP/DC/INV/LIV/FM/SLI/OB/IB/P-*` catalogs, traceability, append-only ADRs) as the **target document architecture**. Concretely:

- OpenSpec `spec.md` files adopt the house ID discipline (REQ-n/INV-n with traces) via a **custom OpenSpec schema** — OpenSpec supports this natively (customization/community schemas).
- The Verifier's scenario→assertion traceability is the automated form of the standard's conformance module.
- On archive, the publisher generates a one-page **ADR record** from `proposal.md` + `design.md` (a change is nearly isomorphic to an ADR) and commits it to the repo's append-only `openspec/decisions/`, continuing the numbering of any pre-existing hand-written ADRs. The canonical source stays the archived change; the ADR file is a frozen render, safe because it is never edited.

### The skill is part of the system — and must stay consistent
The house standard is described by two **skills** with different homes:
**`openspec-standard`** — the injectable everyday discipline for writing OpenSpec specs (IDs in
requirement titles, cross-reference by ID, RENAMED semantics, ADR-via-changes, lint rules) —
lives in this repo at `.claude/skills/openspec-standard/`; and **`product-tech-spec`** — the
deep suite methodology it builds on (an external skills repo), used by suite-scale tasks
(e.g. the Phase-4 mapping task) and never injected per stage. Rules:

1. **Single source of truth per skill.** `openspec-standard` is injected from the
   orchestrator's own checkout, and the recorded SHA is this repo's revision — no sync job
   involved. External skills come through `skill_sources`: SpecMate never forks their content —
   it holds a **pinned, auto-refreshed copy**; a sync job pulls on schedule and on webhook,
   records the SHA. Concrete config:
   ```yaml
   skill_sources:
     - name: product-tech-spec
       repo: github.com/<org>/<spec-standard-skill>
       ref: main
       path: product-tech-spec/
       inject_into: []   # opted into by suite-scale task types, not per stage
   ```
   A private skill repo needs its own read-only credential for the sync job, separate from the per-repo deploy keys used by workspaces.
2. **Injection**: every role that reads or writes specs (Researcher, Spec Writer, Reviewer, Summarizer) gets the current skill copy in its context assembly, alongside the OpenSpec artifacts. The skill SHA a stage ran with is recorded in `stages.result` — full reproducibility of "which standard was in force".
3. **Consistency check**: a mechanical lint in the Verifier/publisher path validates produced specs against the skill's format rules (IDs, required sections, RFC-2119 usage). Skill and spec format can't silently diverge — divergence fails the stage.
4. **The process updates the skill**: when feedback or a Retro run reveals the standard itself needs changing (a rule that keeps causing rework, a missing section type), the improvement is drafted as a **PR to the skill repo** — going through the same kickoff-brief → approval flow as any change. After merge, the sync job picks it up and every subsequent stage runs on the new standard. Nothing edits the skill copy locally.
5. **Configurable**: skill source, sync cadence, and which roles receive it are all config, not code — swapping to another repo/standard is a config change.

---

## 12. Self-Learning Flywheel

The system improves itself from the owner's comments — without any model fine-tuning, purely through artifact evolution:

1. **Capture** — every human interaction is already structured data in Postgres: kickoff redirects, decision answers, spec-gate edits, rework comments, findings the human overruled. Each gets tagged with the stage, role, and provider it corrects (`feedback(id, task_id, stage_id, role, provider, kind, text, created_at)`).
2. **Distill** — a scheduled **Retro agent** (weekly, or after every N completed tasks) reads the accumulated feedback plus loop statistics (iterations per task, escalation causes, which findings repeat across tasks) and produces a retro report: recurring failure patterns → concrete proposed edits to role prompts (`roles/*.md`), DAG templates, cap defaults, brief format.
3. **Apply through the pipeline itself** — each proposed improvement is an OpenSpec change in the SpecMate repo, running through the same kickoff-brief → approve flow. The owner approves process changes exactly like feature changes; nothing self-modifies silently.
4. **Measure** — prompts and policies are versioned; each task records which versions it ran with, so the dashboard can show "avg iterations per task" and "escalations per task" trending across prompt versions. If a change makes things worse, revert is a git revert.

This makes the human comments the training signal — which is why UI delivery is pulled to the very front of the roadmap: no UI, no signal.

---

## 13. Dogfooding: building SpecMate with OpenSpec

- `openspec init` in the SpecMate repo on day 0.
- Every phase below = one or more OpenSpec changes (`/opsx:propose …` → review → implement → archive). Until Phase 3 exists, you drive the loop manually with Claude Code/Codex; from Phase 3 onward, SpecMate starts running its own changes (self-hosting milestone).
- Role prompts, DAG templates, and orchestrator policies are all spec'd as changes too — this doubles as the test corpus.

---

## 14. Phased Roadmap

### Phase 0 — Foundations (week 1)
- Repo, `openspec init`, CI, Docker Compose skeleton, Postgres + migrations (schema from §6).
- OpenSpec changes: `init-architecture`, `data-model`, `role-contracts`.
- **Exit**: empty services boot on the server, DB migrated, first specs archived.

### Phase 1 — Walking skeleton WITH UI v0 (weeks 2–3)
**UI is not a later phase — it ships with the first pipeline, because human comments are the self-learning signal.**
- Workspace manager (clone, branch, worktree).
- Claude runner container + headless invocation + `RESULT.json` contract.
- Orchestrator loop: a generic engine walking a pinned pipeline definition (pipelines are data — §5); ships the feature/bugfix definition DRAFT→RESEARCH→SPEC_REVIEW→IMPLEMENT→VERIFY→CODE_REVIEW→SUMMARIZE with iteration caps, stage retries, resume after restart.
- Verifier stage v0: run the repo's existing harness/integration suite headless (docker-in-docker in runners), scenario→test traceability check, `verification.md` output.
- **UI v0 (deliberately ugly, 3–4 screens)**: **Attention Inbox** (even a crude list of open items), task list sidebar, chat timeline from the events table, "new task" input, rendered markdown artifacts. No DAG, no diffs, no polish — just enough to launch tasks and *comment on everything* from the browser/phone.
- Feedback capture from day one: every comment/answer lands in the `feedback` table even before the Retro agent exists.
- **Exit**: a real bugfix goes end-to-end launched and commented entirely from the UI; survives an orchestrator restart mid-run.

### Phase 2 — Decisions & human gates (week 4)
- Decision records, `WAITING_HUMAN` state, answer API, `decisions.md` writeback; Decision cards in the UI chat.
- **Kickoff brief stage**: Planner emits early `proposal.md` + open questions → HUMAN_KICKOFF_GATE (approve/redirect/cancel) as a chat card before research runs.
- **Harness probe** in planning: classify harness coverage for the touched area; `missing/partial` → mandatory warning in the brief + task-split option (harness task A blocking fix task B via `tasks.blocked_by`).
- Repeated-findings detector, budget caps, Slack/Telegram notifications.
- **Skill sync v0**: pull the spec-standard skill from its configured repo, inject into spec-touching roles, record SHA per stage; format lint in Verifier.
- **Exit**: every new task pauses on its kickoff brief; a deliberately ambiguous task escalates instead of looping; answering resumes it — all from the UI.

### Phase 3 — UI v1 + first Retro (weeks 5–6)
- UI polish: React Flow DAG with live stage status, artifact diff-since-last-approval view, D2 diagram rendering (Mermaid fallback), rework flow. **The DAG did not survive contact with a real task** — a rail that carries done and current nodes with their facts and folds the unstarted into one line says more in less space, and §16.1 is what replaced it.
- **Retro agent v1**: weekly distillation of accumulated feedback → proposed prompt/policy edits as OpenSpec changes with kickoff briefs for approval — including PRs to the skill repo when the standard itself needs changing.
- PR tracking (GitHub webhook/poll) feeding unmerged-PR items into the Attention Inbox.
- **Self-hosting milestone**: start running SpecMate's own OpenSpec changes through SpecMate — including the Retro agent's improvement changes.
- **Exit**: full task lifecycle in the browser incl. rework-after-summary; first Retro-proposed improvement approved and merged through the pipeline itself.

### Phase 4 — The wiki & incident investigation, read-only (week 7)
Knowledge about the target system moves up front because it pays off in *every* task type:
fixing one service means knowing what its neighbours expect of it. One knowledge home — the
**`wiki`** repo — holding two maps that must not be conflated (how the application *works* and
how it *is run*), plus the first pipeline that consumes them:

```
wiki (git repo; the Phase-6 MkDocs site renders this + every repo's archived specs)
├── system/    ← system map: services, contracts, mutual expectations
└── ops/       ← ops map: environments, dashboards, access pointers, runbooks, incident policy
```

- **`wiki/system/` — the system map** — how the multi-service application works across its
  repositories: the service catalog with responsibilities and owning repos, the contracts
  between services (APIs, events, queues, schemas), and the expectations each service has of
  its neighbours — ordering, idempotency, retries, invariants. Consumed by researcher, spec
  writer, implementer, and reviewer on *ordinary feature/bugfix tasks* — this, not incidents,
  is the main payoff: an agent fixing service A must know what service B expects of it.
  Bootstrapped by hand or by a dedicated mapping task per service — services that already
  carry a spec suite in the house standard seed the map from it (their dependencies module is
  nearly a map page). The partition against per-repo specs is strict, so there is nothing to
  desync: anything one service owns lives in that repo's spec; the map owns only the pair-wise
  expectations no single repo can own, and references per-repo requirements by their stable
  IDs — a lint catches dangling references. Research findings keep it current through the
  pipeline. A fix that spans two repos stays two tasks linked by `blocked_by`.
  **One spec per service, always** — and that spec is the repo's `openspec/specs/`, the home
  the pipeline's machinery (delta validation, archive folding, scenario→test traceability)
  already operates on. An existing house-standard suite migrates into it once: functional
  requirement bands become capabilities, cross-cutting modules (invariants, liveness, failure
  model, performance, observability) stay whole as capabilities of their own, every REQ-n /
  INV-n keeps its ID in the requirement title, and the old `spec/` directory disappears.
  Existing hand-written ADRs move once into the repo's append-only `openspec/decisions/`; new
  decisions are born as changes, and the publish job commits a generated one-page ADR into the
  same log, continuing the numbering (§11) — the canonical source is the archived change, the
  ADR file a frozen render, safe because it is immutable. The remaining lints are
  format-against-standard (§11.3) and the map's dangling-ID check — both check one source
  against a ruler, not two sources against each other.
- **`wiki/ops/` — the ops map** — how it is run: environments and what is deployed where,
  dashboards, runbooks, the incident policy, and access *pointers*. The wiki is a git repo, so
  secret material never enters it: an access entry names the endpoint and the local secret
  reference that unlocks it (an env name, a file under the server's secrets directory, a
  volume), and the orchestrator resolves the reference on the host when configuring tools —
  the same pattern as the provider auth volume. Consumed by triage and diagnosis, and by any
  stage that reasons about production. Postmortems update it through the pipeline (the
  self-learning flywheel applied to ops).
- **Delivery**: the maps are injected through the existing skill-source mechanism — path-scoped
  sources into one repo, next to the spec standard, revision recorded per stage. Agents receive
  curated map pages, not the repo root. Published specs are deliberately *not* copied here:
  they stay canonical in each product repo's archive, and the wiki site renders them from
  there (§10) — the wiki repo holds only knowledge that has no other home, so it stays bounded
  by construction. Both sections change only through pipeline tasks, so updates are reviewed
  like everything else. Nothing stops the owner from hand-writing the first maps the moment
  skill sync lands in Phase 2 — Phase 4 makes the wiki first-class and self-updating.
- **Read-only access** — per-deployment observability endpoints (Grafana, logs, metrics) as
  read-only tooling in the runner for diagnose-capable roles, configured by the orchestrator
  from the ops map's pointers and the host's secrets — the raw credential is not part of the
  prompt. Plus read-only checkouts of neighbour repos for research when the system map is not
  enough (the workspace manager already mirrors repos; a read-only worktree of a dependency is
  the same machinery). No write credential to any production system exists anywhere in
  SpecMate.
- **`incident-investigation`** — a new task type as a catalog entry (no engine change, per the
  orchestrator-loop change): INTAKE → TRIAGE → DIAGNOSE ⇄ REVIEW → REPORT. Output is a
  diagnosis report and a draft postmortem, plus optionally a spawned ordinary bugfix task for
  the fix. The human mitigates and closes the incident — SpecMate investigates, it does not
  touch prod. Artifact trail stays OpenSpec-shaped: `incident.md` (timeline), `diagnosis.md`,
  `postmortem.md`. Triage reuses Planner, diagnosis reuses Researcher with the observability
  toolset, postmortem reuses Summarizer.
- **Exit**: an ordinary feature task's research stage cites the system-map revision it ran
  with; a synthetic incident on a staging service is triaged and diagnosed end to end from the
  ops map and the read tools; the spawned fix task passes the Phase-1 e2e.

### Phase 5 — Multi-provider (week 8)
- Codex + Copilot runner images, `AgentProvider` adapters, cross-provider review policy.
- **Provider/model/reasoning-effort binding, not just provider.** `ROLE_CONTRACTS.defaultProvider`
  (currently the only knob, and dead in practice since `availableProviders` lists one entry) is
  replaced by an explicit per-role default — `provider` + optional `model` + optional
  `reasoningEffort` — that a task can override. Same shape and the same "resolved at creation,
  not merged at read time" rule already used for `caps`/`budgets` (§7): a `providerBindings`
  column on `tasks`, a zod schema with per-field defaults, `.parse(input.providerBindings ?? {})`
  at creation. `model`/`reasoningEffort` move from `RunnerConfig` (one value per runner process)
  to `StageJob` (one value per stage) so different roles on the same task can run different
  models.
- Per-provider cost accounting; provider/model defaults and per-task overrides exposed in the UI.
- **Non-goals for this phase**: no planner-authored routing proposal at kickoff — that is a later
  extension on top of `kickoff-brief`, once this exists to extend. No quota/weekly-limit-aware
  automatic routing — there is no source of truth for remaining provider quota yet, so routing
  stays a human-set default/override, not a computed one (Phase 7 revisits this once
  subscription-pool accounting has a source, and can feed it into these same bindings).
- Cross-provider review (REQ-106) stays a provider-level check in this phase — whether two
  different models from the *same* provider count as independent review is an open question,
  deliberately not decided here.
- **Exit**: "Claude writes / Codex reviews" and the inverse both pass the Phase-1 e2e task; a task
  created with an explicit provider/model override for one role runs that role under the
  override while the rest of the task uses defaults.

### Phase 6 — Publishing & summary polish (week 9)
- Summarizer role with D2 diagram generation (SVG pre-render in publish job; Mermaid variant for PR descriptions), PR description autogen.
- Wiki site: MkDocs render over the wiki maps and every product repo's archived specs (no copies — the system map's service catalog names the repos to pull) + `openspec archive` integration on final approval.
- **Exit**: approved task appears on the wiki within a minute, repo specs archived.

### Phase 7 — Hardening & mobile notifications (week 10)
- Auth watchdog, backups, egress allowlist, secret handling audit, load test with 5–10 concurrent tasks.
- iPhone push: ntfy/Pushover sink (or PWA web push) wired to open Decisions and budget-exhaustion events.
- Subscription-credit accounting in budget caps: pause tasks (with a push) when the monthly Agent SDK credit pool nears exhaustion, never fail silently. This is the source of truth Phase 5's provider/model bindings lacked — once it exists, routing can read remaining quota per provider instead of relying only on a human-set override.
- **Exit**: kill -9 anything and the system recovers; an open Decision buzzes the phone within seconds.

### Phase 8+ — Later
- **Incident mitigation & the Operator role** — acting on production, not just reading it:
  MITIGATE/VERIFY_RECOVERY/RESOLVE stages, gates on production-affecting actions (auto-approval
  classes per severity from the incident policy), and **Operator** — the only role ever holding
  production credentials, with an action allowlist and a full audit trail in `actions.md`.
  Deliberately deferred until the read-only investigation flow (Phase 4) proves itself and
  hardening (Phase 7) lands: it breaks the "runners get nothing but the worktree" security model
  and deserves its own risk review.
- Temporal migration if DAGs get complex; parallel stage fan-out (multiple researchers → judge); spec search across the wiki; metrics dashboard (cost/time per task, loop counts, approval rates); GitHub Issues/Linear intake ("label = auto-spec").

---

## 15. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Provider CLIs change flags / auth flows | Thin adapter layer per provider; pinned CLI versions in runner images; healthchecks |
| Consumer-subscription ToS for headless server use | Verify per provider; design adapters to swap to API-key billing without code changes |
| Reviewer/researcher loop oscillation | Finding-ID repetition detector + hard caps + escalation as a success path, not a failure |
| Context bloat on long-lived tasks | Artifacts-as-context discipline; ledger is summarized (compacted) when > N KB, by a dedicated compaction step |
| Losing work on crashes | Everything idempotent on Postgres state; artifacts committed to git after each stage |
| Agents doing destructive things | No creds beyond deploy key; worktree isolation; protected branches; human gates before publish |
| One provider outage stalls everything | Role→provider binding is per-stage; orchestrator can fail over to alt provider per role policy |
| Agents "green-washing" tests (weak asserts to pass) | Mechanical spec-scenario→assertion traceability; cross-provider reviewer explicitly audits harness diffs; harness code reviewed like product code |
| Operator role would hold production credentials (Phase 8+) | Deferred until after hardening, and only if mitigation is pursued at all; action allowlist; per-action human gates scaled by severity; read tools separated from write tools; full audit trail |

---

## 16. Execution plan — current

*Written 2026-08-23. Replaces the original first-steps list, all of which is done.*

The pipeline runs end to end and publishes its own PRs. Since `planner-decomposition` the planner
sizes its own work and the engine bounds what that plan may create. What is left in front of it is
the surface the owner works through, what a task costs, and the last places the pipeline stops for
a human it does not need.

Three workstreams. §16.1 and §16.2 are the priority and can run in parallel — one is the web app,
the other is a table of defaults in `packages/core/src/models.ts`. §16.3 is what those two leave
behind.

### 16.1 The task screen, pass 3

The argument is [`docs/design/task-screen-pass-3.md`](./design/task-screen-pass-3.md) with its
mockup beside it. Three rules carry it: the column is the conversation and the rail is the machine,
so stage lifecycle, tool calls, commits, durations and tokens leave the feed and live behind the
node they belong to; one input, at the bottom, labelled by whatever is being asked of you — never
two, never a mode set before typing; Files and Docs are tabs on the task, in a nav column down the
left, so the header stays one row when a fourth tab arrives.

Four decisions, taken before the work starts.

**The in-flight change is rewritten, not merged.** PR #19 draws the chaptered thread that pass 3
replaces, and its delta claims REQ-918 — which `decision-floors` took on main while the branch sat
open. Rather than merge a requirement the next change deletes wholesale, the branch rebases onto
`origin/main` and `openspec/changes/task-screen-redesign` is rewritten in place: one proposal, one
review, pass-3 shape, numbering from REQ-919 / AC-958 (`bun run spec:next-id`). The pass-2 code is a
foundation, not a mistake — `task-thread.ts`, `pipeline-rail.tsx` and `commit-ref.tsx` are reshaped,
not reverted.

**Files and Docs become tabs now; the diff is redrawn later.** The tab shell is what collapses the
header to one row and stops the rail carrying a second copy of the artifact list, and it costs
routing, not a diff engine. Today's `ListDetailPanel` rendering moves inside the tab untouched. One
useful consequence: REQ-916/AC-944 — *selecting a file renders its unified diff* — is contradicted
by stacking every file, not by the tab, so it survives this pass unamended and is the deferred
change's problem (§16.4).

**The console gets a writer, and the fix that makes it honest.** The feedback endpoint learns to
write `kind: 'intervention'` with `target.nodeKey`; the engine and the runner already claim and
render those. The claim is cleared whenever a stage ends any way but accepted, so guidance survives
the failed attempt it was typed for — which is precisely the case the feature exists for. The cost,
stated rather than discovered: an intervention stays re-readable until some run is accepted.

**The console never promises more than the runner delivers.** `executor.ts` loads the ledger once
per stage, before the provider starts, so text typed while `Implement` runs reaches `Implement` on
its *next* run. The wording says exactly that. A channel into a live agent is a different change and
is not in this one.

The work, in the order it can be reviewed:

1. **The shell** — one-row header: title, state as a sentence, `owner/repo · base` on Thread and
   Docs or `base…branch · N commits` on Files, and a trailing `STREAM` dot that reports the event
   stream and not the task. The nav column carries Thread / Files n / Docs n / Guide (drawn, greyed,
   `soon`); routes are `/tasks/:id`, `/tasks/:id/files`, `/tasks/:id/docs`, with
   `/tasks/:id/artifacts/:artifactId` still addressable. `task-rail.tsx` loses the artifact list and
   the `files changed →` link. **Done when** the header is one row on every tab and no fact on the
   screen is stated twice.
2. **The feed** — questions, answers, comments, the guide's replies, gate outcomes: five to fifteen
   lines over a whole task. No chapter headers, no `Stage started`, no `Reading foo.ts`. An answered
   question stops looking like a question — two clamped lines of dialogue and a link to the whole
   thing. **Done when** a ten-second-old task has one line in the feed and one in the rail, with no
   empty state written for it.
3. **The rail and the run log** — four node states, not three: done, running, waiting on you, and
   **stopped**, which keeps its facts and states the reason in the slot a duration would occupy.
   Unstarted nodes fold into one line. Clicking a node opens its run log over the column — start,
   tool calls, questions, commit, acceptance, with duration, cost, tokens and model in its header —
   and `Comment on this run` inside it is how a comment reaches an older stage. **Done when**
   everything the thread used to carry inline is one click away and nowhere else.
4. **The console** — one field, no toggle and no scope select, with one line under it naming the
   destination the task's own state picked: a message to the running stage, the answer to an open
   question, a gate comment beside the gate's own verbs, guidance carried into a restart, a message
   to the next node when nothing runs, or nothing at all when the budget is spent, said plainly.
   `Ask guide` leaves the console — it is a mode, and rule 2 forbids modes; until the Guide tab
   lands the guide is reachable through `Discuss` on an open question.
5. **The writer** — `apps/api/src/app.ts` writes the intervention (`restartInterruptedStage` is the
   shape to copy) and emits an event, so the text lands in the thread it was typed into;
   `apps/orchestrator/src/engine.ts` clears the claim when a stage ends unaccepted. About twenty
   lines and no migration. **Done when** text typed at a failing stage is read by its retry and
   appears in the feed either way.
6. **The phone** — the tab bar stays, because it is routing and it is how you leave the thread; the
   rail collapses into the state sentence plus one `Pipeline ⌄` disclosure; a run log opens as a
   full-height layer with its own back. REQ-911 is live spec, and the mockup's stacking contradicts
   it.

Throughout: the mockup's spans are shorthand. Tabs are routes, the console is a form with a
labelled textarea, the question pager is a real control, and the `aria-pressed`, `aria-label` and
`<fieldset><legend>` the current code carries survive the redraw.

Six live `operator-ui` requirements are reworded and one is contradicted outright, so all seven are
MODIFIED rather than added beside what they replace: REQ-901 (screens become tabs, addressability
restated), REQ-906/AC-912 (a comment is pinned by where it was typed, not by a dropdown), REQ-907
(documents render in a tab, not their own screen), REQ-911 (the phone keeps its tabs and collapses
the rail), REQ-912/AC-923 (a resolved card is two clamped lines), REQ-914 (the rail's fourth state
and the run log behind a node; the console loses `Ask guide`), and REQ-915/AC-940 (activity moves
out of the timeline and behind a rail node — the contradiction, and the most recently shipped of
them). Three are added: REQ-919 for the thread, REQ-920 for the tabbed shell, REQ-921 for the one
input and its stated destination.

The writer reaches past the web app, so two more capabilities move with it: `task-surface` REQ-1008,
where the feedback endpoint learns to store a comment as guidance targeted at the node the task's
state addresses, and `agent-contracts` REQ-102, where guidance stays pending until a run carrying it
is accepted. The second is the claim fix stated as a contract rather than as an implementation
detail — without it the endpoint would write text that a retry silently drops.

### 16.2 What a task costs

`DEFAULT_MODEL_BINDINGS` gives all nine roles `claude-opus-5` at `high` effort. `model-settings`
built every mechanism for changing that — per-role bindings resolved at creation, per-stage
dispatch, a Settings screen that edits them — and then bound every role to the same expensive
default. Nothing in the machinery is saving money: the rail states one binding for the whole task
because there is only ever one, and the node that summarises a diff runs the same model as the node
that writes the code.

So the change is the defaults, not the machinery: `resolveModelBindings` already reads them, the
settings row already overrides them, and REQ-917's screen already edits them per role. A starting
table, to be tuned from Settings once there are numbers:

| Role | Binding | Why |
|---|---|---|
| `planner` | opus · high | Reads the repository, sizes the work, and its output gates the task |
| `researcher` | opus · high | Writes the specs everything downstream is checked against |
| `implementer` | opus · high | Writes the code |
| `reviewer` | sonnet · high | Judgement over a diff, but the effort is where its value is — keep effort, drop the model |
| `verifier` | sonnet · medium | Runs the harness and reads its output; mostly mechanical |
| `summarizer` | haiku · low | Renders artifacts already written into a summary |
| `answerer` | haiku · medium | Answers from artifacts, on every `Discuss` |
| `spec_writer`, `retro` | unchanged | No node schedules either (§16.3) |

The guardrail is that a cheaper reviewer is a worse reviewer somewhere, and the place it shows is
rework: the rate at which a gate sends work back, and the loop counts already recorded per task.
**Done when** the same small task, run twice against the same repo, costs measurably less and does
not need an extra round to get there.

### 16.3 Where the pipeline still stops

`planner-decomposition` and `decision-floors` closed most of
[`docs/autonomy-gaps.md`](./autonomy-gaps.md): the split recursion is bounded by plan depth and
prerequisite count, an acceptance now outlives the task that gave it, questions have a per-stage
cap and an identity that stops multiplying one question by the nodes that ask it, and a declared
size selects a reduced pipeline profile. What is left is named there as non-goals, in the order it
is worth doing:

- **Sizing has to be watched, not trusted.** Whether a planner asked to size its own work sizes it
  honestly is a question about real runs, not about code. The two gates before code are what catch
  it; §16.2's cost line is where it shows.
- **A chain has no budget.** Every prerequisite task resolves its own from settings, so a plan with
  two prerequisites buys three budgets and nothing bounds the whole.
- **Caps and budgets do not scale with the declared size.** Size selects a profile and nothing else,
  so a small task keeps a large task's iteration caps.
- **A plan's prerequisites are unordered**, one flat level deep.
- **Two roles sit in the catalog with no node scheduling them** — `spec_writer` and `retro` — while
  the researcher does the first one's job. That is a question about what the roles are for, and it
  is the one item here that could remove a stage rather than bound one.

Beside those are the stops the screen surfaces but does not remove: a node at its attempt cap, a
stage the sweeper found orphaned, a task paused on an exhausted budget. Pass 3 gives all three one
shape (§16.1, item 3) and says why each happened; making them rarer is not a UI change.

The honest test of all of it is running §16.1's own change through SpecMate — the Phase-3
self-hosting milestone, still unclaimed.

### 16.4 Deferred, and why

- **The Files diff in GitHub shape** — every file stacked rather than selected, per-file `+N −N`
  with the block bar, `Viewed` and `n / N viewed`, hunk expanders, unified/split. Its own change
  after §16.1, and the one that amends REQ-916/AC-944. Two costs to carry into it: stacking means N
  diff requests against an API that serves one path at a time, so the first few expand and the rest
  lazy-load; and `Viewed` is keyed per file per `HEAD`, not `localStorage`, because a counter that
  survives the diff changing is worse than no counter.
- **The Guide tab.** A conversation with its own history needs room to be one. Drawn now as `soon`,
  because knowing where a thing will land is most of what stops it landing badly.
- **`dag-visualization`.** A rail that summarises done and current and folds the rest is not a
  diagram, and pass 3 does not need one; the untracked draft under `openspec/changes/` should go.
  Phase 3's React Flow DAG (§14) is superseded by the same argument.
- **A channel into a running agent.** The prompt is sealed at dispatch. Reaching a live agent means
  re-reading pending interventions between rounds or steering at the provider-session level —
  either way, not a UI change.
- **Housekeeping, before any of the above**: `openspec/changes/code-diff-view/` is an untracked copy
  of the archived change with every task box unchecked and reads as unstarted work to anyone who
  opens it — delete it. The loose `app-shell.tsx` / `icons.tsx` edit in the working tree is
  unrelated to pass 3; commit it on its own.

### 16.5 Order

| # | Work | Waits on | Done when |
|---|---|---|---|
| 0 | Rebase onto `origin/main`; renumber to REQ-919; delete the stale `code-diff-view` copy | — | The branch builds on current main and `bun run spec:next-id` agrees with the delta |
| 1 | Rewrite `task-screen-redesign` into pass-3 shape (proposal, design, delta, tasks) | 0 | `openspec validate` passes and the delta MODIFIES all six requirements in §16.1 |
| 2 | Per-role model defaults (§16.2) | — | Same task, same repo, measurably cheaper, no extra rework round |
| 3 | Shell, feed, rail and run log (§16.1, items 1–3) | 1 | Header one row; feed five to fifteen lines; every stage fact behind its node |
| 4 | Console and its writer (§16.1, items 4–5) | 3 | Typed text reaches the node the line named, survives a failed attempt, and shows in the feed |
| 5 | Phone (§16.1, item 6) | 3, 4 | REQ-911 holds below `62rem` with the tab bar intact |
| 6 | The Files diff, GitHub shape (§16.4) | 3 | Its own change, amending REQ-916/AC-944 |
