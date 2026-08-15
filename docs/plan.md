# SpecMate — OpenSpec-Driven Agent Orchestration Service
## Full Implementation Plan

> Name: **SpecMate**. A 24/7 self-hosted service that takes a feature/bugfix task, runs a graph of AI agents (researcher → spec writer → implementer → reviewer) through OpenSpec-shaped artifacts, surfaces every human decision in a chat UI, and publishes the approved spec to a shared wiki.

---

## 1. Goals & Non-Goals

### Goals
1. **One-click task launch** — feature or bugfix, described in natural language, optionally pointing at a repo/branch.
2. **Research agent** produces an OpenSpec change (`proposal.md`, `specs/`, `design.md`, `tasks.md`) describing *how* to do the fix.
3. **Reviewer agent** critiques the research/implementation at the end of each cycle.
4. **Bounded research↔review loop** — iterate until the reviewer approves or the iteration budget is exhausted; **every decision the agents cannot make alone is escalated to the human and highlighted in the UI**.
5. **Final summary artifact** — a concise "what was done and how" document with diagrams (D2, Mermaid where GitHub renders natively), plus the ability to send the task back for rework **without context bloat**: agent context is reconstructed from task-scoped OpenSpec artifacts, not from a growing chat transcript.
6. **Human approval gate** — after final approval, the spec is exported to the shared spec wiki and archived (`openspec/changes/archive/…`).
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
| **Task** | The unit of work: "add dark mode", "fix reorg bug in ingester". Has a lifecycle, a target repo, and a type (feature/bugfix). |
| **Change** | The OpenSpec change folder for the task (`openspec/changes/<task-slug>/`). This is the *stateful context* — the single place agents read from and write to. |
| **Run graph** | The planned DAG of agent stages for this task (planner output). Rendered in the UI. |
| **Stage** | One node in the graph: role + provider + input artifacts + output artifacts. |
| **Agent role** | Abstract responsibility (Researcher, Spec Writer, Implementer, Reviewer, Summarizer). |
| **Provider** | Concrete executor: `claude-code`, `codex`, `copilot`. A role binds to a provider per stage. |
| **Decision** | A question agents cannot resolve (ambiguous requirement, destructive action, trade-off). Blocks the stage, surfaces in UI, answer is written back into the change folder. |
| **Summary artifact** | Human-facing report: what/how/why, D2 diagrams (SVG), links to diffs and spec. |
| **Workspace** | An isolated checkout (git worktree or container volume) where a stage runs. |

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
│                          │  Git host (GitHub) │     │  Spec Wiki       │         │
│                          │  branches + PRs    │     │ (repo/Notion/…)  │         │
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
7. **Wiki publisher** — pluggable sink: git repo of specs (recommended v1: a `specs-wiki` repo rendered by MkDocs/Docusaurus), later Notion/Confluence adapters.

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

State machine per task:

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

---

## 9. Runtime & 24/7 Operation (single user)

1. **Deployment**: single VM (Hetzner/EC2) + Docker Compose in v1: `api`, `orchestrator`, `postgres`, `ui`, `runner-claude`, `runner-codex`, `runner-copilot`, `caddy` (TLS). k8s only if/when concurrency demands it.
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

v1: a dedicated **`specs-wiki` git repo**:
- On final approval: Summarizer's `summary.md` + the archived spec deltas are committed to `specs-wiki/<project>/<date>-<slug>/`, index regenerated, site rebuilt (MkDocs Material or Docusaurus via CI). D2 sources are committed alongside **pre-rendered SVGs** (d2 CLI in the publish job); PR descriptions get Mermaid, since that's what GitHub renders natively in markdown.
- Simultaneously run `openspec archive` semantics in the product repo (change folder → `openspec/changes/archive/…`, `specs/` updated) so the repo's living specs stay canonical.
- Phase 2: adapters for Notion/Confluence behind a `WikiSink` interface.

---

## 11. Spec Standard & Skill Sync

SpecMate uses OpenSpec as the **process/transport** and a house **spec standard** (a conformance suite: `REQ-n` with acceptance criteria, `DEF/OP/DC/INV/LIV/FM/SLI/OB/IB/P-*` catalogs, traceability, append-only ADRs) as the **target document architecture**. Concretely:

- OpenSpec `spec.md` files adopt the house ID discipline (REQ-n/INV-n with traces) via a **custom OpenSpec schema** — OpenSpec supports this natively (customization/community schemas).
- The Verifier's scenario→assertion traceability is the automated form of the standard's conformance module.
- On archive, the wiki publisher generates an **ADR record** from `proposal.md` + `design.md` (a change is nearly isomorphic to an ADR).

### The skill is part of the system — and must stay consistent
The house standard is described by an existing **skill** (its own repo; URL is a config value). Rules:

1. **Single source of truth**: the skill repo. SpecMate never forks the content — it holds a **pinned, auto-refreshed copy**; a sync job pulls on schedule and on webhook, records the SHA. Concrete config:
   ```yaml
   skill_sources:
     - name: product-tech-spec
       repo: github.com/<org>/<spec-standard-skill>
       ref: main
       path: product-tech-spec/
       inject_into: [researcher, spec_writer, reviewer, summarizer]
   ```
   The repo is **private** → the sync job needs its own read-only credential (fine-grained PAT or deploy key, contents:read only), separate from the per-repo deploy keys used by workspaces.
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
- Orchestrator state machine: DRAFT→RESEARCH→SPEC_REVIEW→IMPLEMENT→VERIFY→CODE_REVIEW→SUMMARIZE, iteration caps, retries.
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
- UI polish: React Flow DAG with live stage status, artifact diff-since-last-approval view, D2 diagram rendering (Mermaid fallback), rework flow.
- **Retro agent v1**: weekly distillation of accumulated feedback → proposed prompt/policy edits as OpenSpec changes with kickoff briefs for approval — including PRs to the skill repo when the standard itself needs changing.
- PR tracking (GitHub webhook/poll) feeding unmerged-PR items into the Attention Inbox.
- **Self-hosting milestone**: start running SpecMate's own OpenSpec changes through SpecMate — including the Retro agent's improvement changes.
- **Exit**: full task lifecycle in the browser incl. rework-after-summary; first Retro-proposed improvement approved and merged through the pipeline itself.

### Phase 4 — Multi-provider (week 7)
- Codex + Copilot runner images, `AgentProvider` adapters, cross-provider review policy, provider presets in the New-task form, per-provider cost accounting.
- **Exit**: "Claude writes / Codex reviews" and the inverse both pass the Phase-1 e2e task.

### Phase 5 — Publishing & summary polish (week 8)
- Summarizer role with D2 diagram generation (SVG pre-render in publish job; Mermaid variant for PR descriptions), PR description autogen.
- `specs-wiki` repo + MkDocs pipeline + `openspec archive` integration on final approval.
- **Exit**: approved task appears on the wiki within a minute, repo specs archived.

### Phase 6 — Hardening & mobile notifications (week 9)
- Auth watchdog, backups, egress allowlist, secret handling audit, load test with 5–10 concurrent tasks.
- iPhone push: ntfy/Pushover sink (or PWA web push) wired to open Decisions and budget-exhaustion events.
- Subscription-credit accounting in budget caps: pause tasks (with a push) when the monthly Agent SDK credit pool nears exhaustion, never fail silently.
- **Exit**: kill -9 anything and the system recovers; an open Decision buzzes the phone within seconds.

### Phase 7+ — Later
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

---

## 16. Immediate Next Steps
1. Pick the name + create the repo, `openspec init`.
2. Write the first three OpenSpec changes (`init-architecture`, `data-model`, `role-contracts`) — reuse §3/§4/§6 of this document as the raw material for `design.md`.
3. Provision the server, Docker Compose with Postgres, do the one-time interactive Claude login into the runner volume.
4. Build Phase 1 against a small real repo (e.g. a toy service or Wick Charts) so the e2e test is a genuinely useful fix.
