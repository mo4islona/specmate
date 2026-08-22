## Why

`docs/autonomy-gaps.md` §2, §6 and §7 record the same defect from three angles: the engine
decides how work is broken up and how much process it gets, and the one role that reads the
repository before a plan exists is never asked.

Concretely, today:

- Choosing "Build the harness first" runs `Engine.splitHarnessTask`, which invents a task out of
  the probe's evidence. That task runs the same pipeline, classifies the same area, comes back
  short of adequate again — correctly, the harness does not exist yet — and is offered the same
  split. A live run produced a three-deep chain, each task blocked on the next. Nothing bounds
  it: loops, retries, redirects and budgets all have caps; task creation does not.
- Every task walks the same twelve nodes. A one-line bugfix pays for a kickoff-brief stage that
  rewrites what planning just wrote, and for a spec review of a two-paragraph spec.
- The brief ends with `## Size` — small, medium or large — and nothing reads it. `size` appears
  nowhere in the engine. The planner already judges the size of the work and the judgement is
  discarded.

This change moves both decisions to the planner: how much process this work needs, and what has
to land before it. The engine keeps what an engine should keep — the bounds.

This is Phase 6 hardening, not a roadmap phase of its own: it changes how existing stages are
shaped rather than adding a kind of work.

## What Changes

- **The planner returns a plan shape.** A probing stage's `RESULT.json` gains a required `plan`
  alongside `harness_coverage`: the declared `size`, and the `prerequisites` — tasks the planner
  judges must land before this one can be done properly. A prerequisite carries a stable key, a
  title, and why it is needed. An empty list is the normal answer.
- **The declared size selects the pipeline profile.** The catalog gains reduced profiles: a
  profile is a validated subsequence of a base definition, and `small` selects a compact profile
  that drops `kickoff_brief` (planning's own draft is already checked against every part the
  brief requires) and `spec_review`. When the declared size selects a different profile than the
  task is running, the engine appends a new run-graph version — the mechanism REQ-403 already
  sanctions for re-planning — and the task continues from where it stands.
- **The split creates what the planner proposed.** The coverage decision at the kickoff gate is
  generalized: it is raised when coverage is short of adequate *or* when the plan proposes
  prerequisites, and choosing to split creates the proposed tasks rather than one task the engine
  wrote itself. When coverage is short and the plan proposed nothing, the fallback is today's
  behaviour — one harness task carrying the probe's evidence.
- **Chains are bounded and traceable.** A task records where it came from (`origin_task_id`) and
  how deep in a chain it sits (`plan_depth`). Two new caps bound the shape: `max_plan_depth`
  (default 1) and `max_prerequisite_tasks` (default 2). A task at the depth cap is never offered
  a split — the recursion is closed by the engine, not by a prompt — and the decision prompt says
  so rather than silently dropping the option. Prerequisites past the count cap are named in the
  prompt as dropped, never silently truncated.
- **The planner is told where it stands.** The ledger carries the task's depth, the depth cap, and
  the task it is a prerequisite of, so a planner running inside a chain knows it must produce a
  plan with no prerequisites of its own.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `kickoff-brief`: planning gains a second required structured output beside the coverage
  classification — the plan shape — and the brief's size section stops being prose the system
  ignores.
- `pipeline-definitions`: the catalog gains reduced profiles and the validation that makes a
  reduction that breaks its graph impossible to load; the declared size is what selects one.
- `task-lifecycle`: the happy path is stated as a mandatory spine plus optional review stages, so
  a reduced profile is a legal shape rather than a contradiction; a task records its origin and
  depth, and chains are bounded.
- `harness-coverage`: the gate decision is raised for a proposed plan as well as for a coverage
  gap, splitting creates the plan's prerequisites, and the split option disappears at the depth
  cap.
- `persistence`: the task row carries its origin, its depth, and its declared size.

## Impact

- `packages/core/src/plan.ts` (new): `PlanShape`, `PlanPrerequisite`, `PLAN_SIZES`, and the
  size→profile mapping.
- `packages/core/src/result.ts`: `plan` on `StageResult`, required from a planning role's `ok`
  result the same way `harness_coverage` already is.
- `packages/core/src/roles.ts`: `declaresPlan` on the role contract.
- `packages/core/src/pipeline.ts`: `PipelineProfile`, the compact feature/bugfix definition,
  `validateReduction`, and `definitionFor(type, profile)`.
- `packages/core/src/state.ts`: `max_plan_depth` and `max_prerequisite_tasks` in `Caps`.
- `packages/db/src/schema.ts` + migration: `origin_task_id`, `plan_depth`, `plan_size` on `tasks`.
- `apps/orchestrator/src/store.ts`: `createTask` accepts lineage; `recordPlanShape`;
  `appendRunGraph` lifted out of `replanTask`; the coverage decision's options and prompt become a
  function of the plan and the depth cap.
- `apps/orchestrator/src/engine.ts`: the profile swap at the end of a planning stage;
  `splitHarnessTask` becomes `createPlannedPrerequisites`.
- `packages/runner/src/ledger.ts`: the lineage and depth lines.
- `roles/planner.md`: the `plan` block, what a prerequisite is for, and the depth rule.
- `apps/web`: the task screen names what a task is a prerequisite of, and what it waits on.

## Non-goals

- **No budget or cap scaling by size.** The declared size selects the profile and nothing else.
  Scaling iteration caps and cost budgets by size is a second mechanism with its own argument
  (a task's caps are resolved at creation and recorded as what it ran with, per REQ-303); it can
  follow once the profile mechanism has been watched in a real run.
- **No chain-wide budget.** Every task in a chain still resolves its own budget from settings, so
  a chain of three costs three budgets. `origin_task_id` makes the chain's total computable for
  the first time; spending it against one ceiling is a `budgets` change, not this one.
- **No dependencies between prerequisites.** The plan's prerequisites are a flat set: they all
  block the proposing task and nothing blocks each other. Ordering within a plan needs a reason
  from a real run first.
- **No cross-task memory of the owner's answers.** A repository the owner has already accepted as
  under-covered is asked about again on the next task. That is `docs/autonomy-gaps.md` §3 and a
  change of its own (`decision-floors`), which also carries §4's cap on how many questions one
  stage may raise.
- **No new profile beyond `compact`.** `medium` and `large` both run the full definition. A
  distinct large profile — extra review rounds, a spec-writer node — is speculative until the
  compact one has shipped.
- **No retirement of the unused roles.** `spec_writer` and `retro` sit in the role catalog with no
  node scheduling them (`docs/autonomy-gaps.md` §6). Whether the researcher's spec writing should
  split back out is a pipeline-shape question this change deliberately leaves alone.
