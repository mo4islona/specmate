## 1. Spend computation

- [x] 1.1 Implement spend over stage and conversation-response attempt records in `packages/core`: cost summed from reported telemetry with a completeness flag, agent-minutes summed from recorded start and finish times; owner-interrupted attempts remain included — REQ-1501, REQ-1505 (verify: `bun test packages/core` — fixtures for stage, conversation, completed, interrupted, all-reported, none-reported, and partly-reported attempts; an unfinished attempt does not poison the sum)
- [x] 1.2 Implement the exhaustion predicate over spend and a task's budgets, naming which budget was reached — REQ-1502, REQ-1503 (verify: test — each budget reached independently and both at once; a task under both is not exhausted)
- [x] 1.3 Confirm waiting contributes nothing: only recorded run durations count, never wall time between attempts — REQ-1501, AC-1501, AC-1502, AC-1503 (verify: test — attempts hours apart sum to their own durations; retried, interrupted, and conversation-response attempts each count once)

## 2. The check at dispatch

- [x] 2.1 Refuse the claim for an exhausted task, before the stage row is inserted, inside the existing task lock — REQ-1502, AC-1504 (verify: `bun test apps/orchestrator` — a tick over an exhausted task dispatches nothing and inserts no stage)
- [x] 2.2 Leave a running stage alone: a budget reached mid-run does not interrupt it and its outcome is recorded as usual — REQ-1502, AC-1505 (verify: test — a stage whose telemetry takes the task past the budget still completes, commits, and advances or parks per its verdict)
- [x] 2.3 Apply the same check wherever else an agent run is started for a task, including conversation responses, so no dispatch path bypasses it — REQ-1501, REQ-1502, AC-1503 (verify: test — both stage and conversation dispatch reach the check; adding a path without it fails the test that enumerates them)

## 3. Pausing

- [x] 3.1 Pause the task and raise the exhaustion decision in one transaction, so a paused task always has the decision explaining it — REQ-1503, AC-1506 (verify: `bun test apps/orchestrator` — the task is `paused` with an open decision; a failed decision insert rolls the pause back)
- [x] 3.2 The decision states which budget was reached, the spend against each, and what the task was about to do; its options are raise and cancel only — REQ-1503, AC-1508 (verify: test — the rendered prompt names the budget, both spends, and the pending node; the option set has no bare continue)
- [x] 3.3 Nothing is discarded on pause: artifacts, rounds, and stage history are untouched — REQ-1503, AC-1507 (verify: test — the store's rows before and after the pause are identical apart from the task's status and the decision)

## 4. Raising

- [x] 4.1 `Engine.raiseBudget(taskId, actor, budget, value)` under the task lock: record the new value on the task and resume where it stopped — REQ-1504, AC-1509, AC-1511 (verify: `bun test apps/orchestrator` — the task reports the raised budget and resumes into its `resume_status`)
- [x] 4.2 Refuse a raise at or below the task's current spend, naming the spend, leaving the task paused — REQ-1504, AC-1510 (verify: test — the refusal names the spend and the task's status is unchanged)
- [x] 4.3 Wire the raise to the exhaustion decision's answer, so answering it is what raises the budget — REQ-1503, REQ-1504 (verify: test — answering with a value resumes the task; answering with a too-small value is refused and the decision stays open)

## 5. Reading spend

- [x] 5.1 Expose spend against budget on the task detail, cost marked incomplete when telemetry was missing — REQ-1505, AC-1512, AC-1513 (verify: `bun test apps/api` — a task with no cost telemetry reports incomplete cost and complete agent-minutes, never zero cost)
- [x] 5.2 Show spend against budget on the task view, with incompleteness visible rather than implied — REQ-1505, AC-1512 (verify: `bun test apps/web` — a task with unreported cost renders the incompleteness; agent-minutes render normally)

## 6. The provider-independent cap

- [x] 6.1 A task whose runs report no cost still pauses on agent-minutes — REQ-1505, AC-1514 (verify: `bun test apps/orchestrator` — stub runs with no telemetry drive the task to its agent-minutes budget and pause it)

## 7. End to end

- [x] 7.1 A task runs until its cost budget is reached, pauses with its decision, is raised, resumes, and completes — AC-1504, AC-1506, AC-1509 (verify: `bun test apps/orchestrator` — one e2e case with the stub provider)
- [x] 7.2 The same walk with telemetry absent throughout, paused by agent-minutes instead — AC-1512, AC-1514 (verify: same e2e file, second case)

## 8. Validation

- [x] 8.1 `bun run ci` passes (verify: command exits zero)
- [x] 8.2 `openspec validate budget-enforcement --strict` passes and `bun run spec:lint` reports no duplicate or dangling IDs (verify: both commands exit zero)
