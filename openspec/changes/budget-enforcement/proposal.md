## Why

REQ-608 says a task carries a wall-clock and a cost budget, that exceeding either pauses it and
raises it to the human, and that work already done is not discarded. Nothing implements any of
it. `DEFAULT_BUDGETS` is defined, `tasks.budgets` is resolved at creation and stored — and the
only code that ever touches it is the parse that writes it. `paused` is a task state the engine
can enter and leave, and nothing has ever put a task there. A task today runs until its loop
caps or its attempt caps stop it, spending whatever it spends.

Two things make this worth doing beyond closing a stated requirement. `task-qa` records what
conversation responses and interrupted stages cost and says outright that caps act on them only
when this change lands — so that spend is otherwise unbounded by construction. And the cost
budget alone cannot be trusted: telemetry may
be absent, and REQ-305 is explicit that absent is not zero. Under a subscription session, the
preferred billing mode, a provider may report no cost for any run at all, which makes
`max_cost_usd` a cap that silently never fires. A cap that looks like protection and is not is
worse than no cap.

So the wall-clock budget stops being a deadline and becomes the provider-independent one:
**agent-minutes**, the time agents actually spent working for this task, measured on our side of
the boundary and therefore always available.

## What Changes

- **Both budgets measure the same thing in different units** — resource this task consumed —
  and both are computed the same way, from the recorded attempts: cost from the telemetry the
  provider reported, agent-minutes from the durations the orchestrator itself timed. Neither
  counts time the task spent waiting: a task parked at a gate overnight has spent no
  agent-minutes, because no agent was running.
- **The wall-clock budget is redefined as agent-minutes**, and REQ-608 is amended to say so.
  The name in the stored budgets stays, so nothing migrates; what changes is what it counts and
  why it exists — it is the cap that still works when the provider reports no cost.
- **Spend is checked before a stage is dispatched, never mid-run.** A stage that would start
  with a budget already spent is not started; a stage already running is allowed to finish and
  commit. That is what "MUST NOT discard work already done" means in practice, and it is why
  the check sits at dispatch rather than on a timer.
- **Exhaustion pauses and asks.** The task moves to `paused` with a decision offering the
  options that make sense: raise the budget by a stated amount and continue, or cancel.
  Resuming without raising anything is not offered — it would re-pause on the next dispatch,
  which reads as a broken system rather than a refused request.
- **Absent telemetry is absent, not free.** A run whose cost the provider did not report
  contributes nothing to the cost total and its agent-minutes still count, so the
  provider-independent cap keeps working. When a task's cost is unknowable, the system says so
  where the spend is read rather than presenting an underestimate as fact.
- **Everything an agent does for a task counts**, including conversation responses and work the
  owner interrupts — `task-qa`'s deferred enforcement lands here, with no separate chat or
  interruption budget.
- **The task knows what it has spent**, and so does the owner: spend against budget is readable
  per task, and a task nearing exhaustion is visible before it stops.

## Capabilities

### New Capabilities

- `budgets` (REQ-1501–REQ-1505): what a task's spend is and how it is computed, when it is
  checked, what exhaustion does, what raising a budget means, and how spend is read when part of
  it is unknowable.

### Modified Capabilities

- `task-lifecycle`: REQ-608 — the wall-clock budget becomes agent-minutes, exhaustion pauses at
  dispatch rather than interrupting a run, and a paused task leaves that state only by having
  its budget raised or by being cancelled.

## Impact

- `packages/core`: spend computation over attempt records and the exhaustion predicate — pure
  functions over rows, testable without a database; `Budgets` gains no fields.
- `apps/orchestrator`: the check in the dispatch path before `claim`, the pause with its
  decision, and raising a budget as an engine operation under the task lock.
- `apps/api` / `apps/web`: spend against budget on the task detail, and the budget-raise answer
  arriving through the existing decision path.
- `packages/db`: no migration. `budgets` is jsonb and gains nothing; `stages.cost` already
  records what is needed and `stages.startedAt`/`finishedAt` already bound each attempt.
- Ordering: after `decision-records` (and therefore after `task-qa`) — exhaustion raises a
  discussable decision with options, and REQ-1503 is written against that text. Its
  `task-lifecycle` delta modifies REQ-608, which
  `harness-probe` does not touch (it ADDs REQ-615), so the two are independent.

## Non-goals

- **No global credit accounting.** The monthly subscription pool is a resource shared across
  every task, not a property of one; pausing tasks as it nears exhaustion is Phase 7, and it
  needs a source of truth this change does not have.
- **No automatic budget interruption.** A budget exhausted mid-stage stops the *next* dispatch.
  The owner's separate `Stop current run` control from REQ-1607 still works; budget enforcement
  never activates it on the owner's behalf.
- **No estimation and no forecasting.** The check compares what was spent against the cap; it
  does not predict what the next stage will cost or refuse a stage for being expensive.
- **No per-stage or per-role budgets.** One budget per task, as REQ-608 defines it.
- **No cost model of our own.** Cost is whatever the provider reported. Deriving cost from token
  counts and a price table is a different feature with a maintenance burden this does not take
  on — which is exactly why the agent-minutes cap exists.
- **No automatic budget raises.** Every raise is the owner's answer to a decision, with an
  explicit amount.
- **No provider/model routing.** Which provider, model, or reasoning effort runs a role is a
  separate, orthogonal concern (a future `providerBindings` per-task config, mirroring `budgets`
  and `caps` — Phase 5 in the roadmap). Spend here is summed from `cost.costUsd` and duration on
  the attempt rows regardless of what produced them, so this change assumes no single provider
  and needs no change when routing becomes configurable.
