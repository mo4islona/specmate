## 1. The plan shape in the core contract

- [x] 1.1 Add `packages/core/src/plan.ts`: `PLAN_SIZES` (`small`/`medium`/`large`), `PlanSize`, `PlanPrerequisite` (`key` kebab-case ≤64, `title` ≤120, `why_md` non-empty), `PlanShape` (`size`, `prerequisites` defaulting to `[]`), exported from `packages/core/src/index.ts`.
- [x] 1.2 Add `plan: PlanShape.optional()` to `StageResult` and a `checkPlanPresent` guard in `parseStageResult` mirroring `checkHarnessCoveragePresent` — required only from a role whose contract declares a plan, and only on `status === 'ok'`.
- [x] 1.3 Add `declaresPlan: boolean` to `RoleContract`, `true` for `planner` and `false` everywhere else; assert in a unit test that exactly the planner declares one (kickoff-brief AC-1317).
- [x] 1.4 Reject duplicate prerequisite keys within one plan at parse time — a plan with two entries under one key is a defect, not two tasks.
- [x] 1.5 Add `max_plan_depth` (default 1) and `max_prerequisite_tasks` (default 2) to `DEFAULT_CAPS` and `Caps` in `packages/core/src/state.ts`.

## 2. Pipeline profiles

- [x] 2.1 Add `PIPELINE_PROFILES` (`full`, `compact`) and `PipelineProfile` to `packages/core/src/pipeline.ts`, plus `PROFILE_FOR_SIZE: Record<PlanSize, PipelineProfile>` — `small` → `compact`, `medium`/`large` → `full`.
- [x] 2.2 Add `FEATURE_BUGFIX_COMPACT`: `FEATURE_BUGFIX_PIPELINE` without `kickoff_brief` and without `spec_review`, with its own definition id.
- [x] 2.3 Add `validateReduction(base, reduction)` returning the same defect-string shape `validateDefinition` uses: the reduction's nodes must be a subsequence of the base's (by key, in order, with identical node objects), the terminal must match, and no surviving node may reference a dropped key via `approve`, `redirect.target`, `rework`, or `loopEdge.target` (pipeline-definitions AC-414, AC-415).
- [x] 2.4 Add `definitionFor(type, profile)` and a `PIPELINE_REDUCTIONS` map; make the catalog loader run `validateDefinition` on every profile and `validateReduction` on every reduction, so a broken profile fails startup (AC-416).
- [x] 2.5 Compare profiles by definition id (`definitionForSize(type, size).id !== graph.dag.pipeline`) rather than adding a `profileOf` accessor — the pinned graph already names its definition, so a second mapping would be a second source of truth.
- [x] 2.6 Unit tests in `packages/core/test/pipeline.test.ts`: the compact definition loads; a reduction with a dangling gate target is rejected naming the profile; a reordered reduction is rejected; the compact profile keeps all three human gates, `verify`, `code_review`, `summarize` and `publish` (task-lifecycle AC-639).

## 3. Persistence

- [x] 3.1 Add `originTaskId` (uuid, nullable, references `tasks.id` on delete set null), `planDepth` (integer, not null, default 0) and `planSize` (nullable enum) to `tasks` in `packages/db/src/schema.ts`; add the `plan_size` pg enum from `PLAN_SIZES`.
- [x] 3.2 Generate the migration with `bun run db:generate`; hand-add the caps backfill statement `UPDATE "tasks" SET "caps" = "caps" || '{"max_plan_depth":1,"max_prerequisite_tasks":2}'::jsonb;` so rows written before this change are bounded like new ones (persistence AC-339).
- [x] 3.3 Verify against a live database that the migration applies cleanly and an existing task row reads back with depth 0, no origin, no size, and the two new caps present.

## 4. Recording the plan and swapping the profile

- [x] 4.1 Fold the plan into the existing coverage write: `recordHarnessCoverage` becomes `recordPlanOutcome(tx, task, stageId, assessment, plan)` in `apps/orchestrator/src/store.ts`, writing `harness_status` and `plan_size` together and emitting a `task.plan_recorded` event carrying the size and the proposed prerequisite keys. One write, because one stage result carries both.
- [x] 4.2 Lift `appendRunGraph(tx, taskId, definition)` out of `replanTask` so both the replan path and the profile swap append a version through one function; keep `replanTask`'s advisory lock behaviour unchanged.
- [x] 4.3 In the stage-completion path of `apps/orchestrator/src/engine.ts`, before `advance()` is called: when the completing node's role declares a plan and the result is `ok`, record the plan, and when `PROFILE_FOR_SIZE[plan.size]` differs from the running graph's profile, append the new version and use that graph for both `advance()` and `applyTransition()` (pipeline-definitions AC-417, AC-418).
- [x] 4.4 Confirm the swap is skipped when the profile is unchanged, and that a task already past planning never swaps (AC-418, AC-419).

## 5. The gate decision and the tasks it creates

- [x] 5.1 Replace `renderHarnessGapPrompt` with a prompt renderer taking the coverage assessment (nullable), the plan's prerequisites, the depth cap state, and any prerequisites dropped past `max_prerequisite_tasks` — the prompt names each proposed task, and names the cap when the split option is absent or the list was cut (task-lifecycle AC-636, AC-637).
- [x] 5.2 Add `planChoiceFor(task, assessment, plan)` in the store and `planChoiceOptions(choice)` over it: `split` is offered only when `task.planDepth < caps.max_plan_depth` and `splitCreatesWork(choice)` — the option list is computed from the choice, never filtered after the fact (harness-coverage AC-1419).
- [x] 5.3 Raise the decision from `recordPlanOutcome` when coverage is short of adequate **or** the plan proposes prerequisites, and dismiss it only when neither applies (AC-1410, AC-1418).
- [x] 5.4 Read the proposed prerequisites back from the planning stage's own result (`latestPlanShape`, mirroring `latestHarnessCoverage`) rather than copying them onto the decision — the prompt and the tasks it creates then come from one source.
- [x] 5.5 Rename `splitHarnessTask` to `createPlannedPrerequisites`: creates one task per proposal (capped), each with `originTaskId`, `planDepth = task.planDepth + 1`, the proposal's title and `why_md` as its description; falls back to today's evidence-derived harness task when the plan proposed none and coverage is short (AC-1420, AC-1421).
- [x] 5.6 Set `blockedBy` to every created task, keeping `assertNotSelfDependency` on each (AC-1411, AC-1413).
- [x] 5.7 Extend `CreateTaskInput` in `store.ts` with `originTaskId` and `planDepth`, defaulting to no origin and depth 0 (task-lifecycle AC-638).

## 6. What the planner is told

- [x] 6.1 Add the lineage lines to `packages/runner/src/ledger.ts`'s snapshot and render: declared size (or "not yet declared"), depth, the depth cap, and the origin task's title when there is one (kickoff-brief AC-1319).
- [x] 6.2 Update `roles/planner.md`: the `plan` block in `RESULT.json` with the size vocabulary, what a prerequisite is for and what it is not for, the rule that a task at the depth cap declares none, and what the size selects (fewer stages, not a smaller ambition).
- [x] 6.3 Update the `RESULT.json` examples in `roles/planner.md` so every planning/kickoff example carries `plan`.
- [x] 6.4 Check `packages/runner/test/ledger.test.ts` still passes and extend it for the new lines.

## 7. Operator UI

- [x] 7.1 Show the declared size beside the harness badge on the task screen (`apps/web/src/screens/task-screen.tsx`).
- [x] 7.2 When a task has an origin, show what it is a prerequisite of; when it is blocked, show what it waits on — both as links to those tasks (task-lifecycle AC-635).
- [x] 7.3 Scope `GET /tasks/:id`'s stage list to the task rather than to its newest run graph, so the stages a swapped-profile task ran under its previous version stay visible (AC-419).

## 8. Tests

- [x] 8.1 `packages/core/test/result.test.ts`: a planner `ok` result without `plan` is rejected; with `plan` it parses; duplicate prerequisite keys are rejected; a non-planner role without `plan` parses fine.
- [x] 8.2 `apps/orchestrator/test/harness-coverage.test.ts`: adequate coverage + prerequisites raises the decision (AC-1418); at the depth cap the options exclude split and the prompt says why (AC-1419); split with proposals creates them with lineage and blocks the original (AC-1411, AC-1421); split with no proposals creates the evidence-derived harness task (AC-1420); a plan proposing more than the cap creates the cap and names the rest (AC-637).
- [x] 8.3 A recursion test: a task at `max_plan_depth` whose planning declares prerequisites creates none, and its gate decision offers no split (harness-coverage AC-1419, task-lifecycle AC-636) — the regression this change exists to prevent.
- [x] 8.4 `apps/orchestrator/test/engine.test.ts` (or a new profile test): planning declaring `small` appends v2 and moves the task to `human_kickoff_gate`, skipping `kickoff_brief`; declaring `medium` appends nothing (AC-417, AC-418); the v1 stages stay readable (AC-419).
- [x] 8.5 `bun run ci` green: `check`, `typecheck`, `test`, `spec:validate`, `spec:lint`.
