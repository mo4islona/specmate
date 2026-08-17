## Context

See proposal.md — Why. What exists, and the seams this change has to fit:

- `DEFAULT_BUDGETS = { max_wall_clock_minutes: 180, max_cost_usd: 20 }`, a `Budgets` zod schema,
  and `tasks.budgets` resolved at creation. `Budgets.parse` in the store is the only code that
  has ever touched them.
- `paused` is a `TaskState`; `canTransition` lets any non-terminal state enter it and
  `Engine.resume` returns from it to `resume_status`. Nothing enters it.
- Each attempt already records `startedAt`, `finishedAt`, and a `StageUsage` of
  `{ model, tokens, costUsd, raw }` — with the persistence contract (REQ-305) that absent
  telemetry is stored as absent, distinguishable from zero.
- The engine's `tick()` selects runnable tasks, then `claim()` decides dispatch under the task's
  advisory lock, in the same transaction as the stage insert.
- Time is already bounded elsewhere and this change does not duplicate it: `stageTimeoutMs`
  (30 min) kills a hung run per REQ-204, attempt caps bound retries, loop caps bound rounds, and
  the attention inbox's stall threshold (4 h of no events) surfaces a task where nothing is
  happening. None of those bound *spend*.
- `decision-records` (in flight) supplies decisions with options and the atomic
  answer-and-resume plus discussion before confirmation. `task-qa` (in flight) records
  conversation-response telemetry and interrupted-stage outcomes and defers enforcement to this
  change.

## Goals / Non-Goals

**Goals:**

- Both budgets measure consumed resource, computed the same way from the same rows, so there is
  one notion of spend rather than two mechanisms that behave differently.
- The cap that fires does not depend on the provider being forthcoming.
- Nothing is thrown away to enforce a budget.

**Non-Goals:**

- Bounding elapsed time. That was the old reading of the wall-clock budget and it is not what
  this implements; a task that waits three days for its owner is a stall-detector concern, not a
  budget one.
- Precision about cost. What the provider says is what we count; the agent-minutes cap exists
  precisely so that being wrong about cost is not fatal.

## Decisions

### IDs stay within capability bands

Per the `openspec-standard` skill: the new `budgets` capability claims band 1500
(REQ-1501–REQ-1505, AC-1501–AC-1514) in `openspec/id-bands.yaml`. The modified REQ-608 keeps its
ID and its AC-614, and gains AC-630 as task-lifecycle's next free acceptance ID.

### The wall-clock budget becomes agent-minutes

The archived REQ-608 reads as elapsed time, and implementing it that way would pause every task
whose owner slept on a gate — 180 minutes of a task's life is nothing, 180 minutes of agent
runtime is a lot. Two more reasons make elapsed time the wrong quantity: total elapsed time is
already bounded by the per-stage timeout multiplied by the caps, and the thing that actually
needs a ceiling is consumption, which is what the cost budget also measures.

So the budget is redefined as the summed duration of the runs charged to the task, and REQ-608
is amended to say so. The stored key `max_wall_clock_minutes` is left alone — renaming it would
be a migration for a comment — and the requirement is where the meaning lives.

Why keep it at all rather than trusting cost: under a subscription session, the plan's preferred
billing mode, a provider may report no cost for any run. `max_cost_usd` then never fires, and a
cap that never fires while looking like protection is the failure this change exists to avoid.
Agent-minutes are timed by the orchestrator, so they are always available and always complete —
this is the cap that bites when telemetry does not arrive.

### Spend is derived, never accumulated

There is no running total on the task. Spend is computed from the attempt rows on demand: sum
`cost.costUsd` where present, sum `finishedAt - startedAt`. A counter would need to be
incremented in the same transaction as every outcome — including the failure and orphan paths —
and any missed increment would be a permanent, invisible undercount. The rows are already the
truth; a derived sum cannot drift from them.

The cost of deriving is one aggregate query per dispatch decision, on rows indexed by task. If
that ever matters, the fix is a materialized column maintained by the store, not a hand-rolled
counter in the engine.

### The check runs in the claim, not on a timer

`claim()` is already the single place that decides "this stage starts now", already runs under
the task's advisory lock, and already refuses dispatch for reasons of its own (a stage in
flight, a spent attempt cap). The budget check joins it. That placement gives REQ-1502 for free:
there is no path that starts a run without passing through it, and no path that interrupts a run,
because the check simply never sees a running stage.

Pausing is then the same shape as the existing cap-exhausted park: the transition and the
decision commit together, so a task cannot end up paused with nothing explaining it.

Conversation-response execution (`task-qa`) gets the same check at its own dispatch point. Its
spend counts towards the same budgets and it is subject to the same refusal — one budget per
task, as REQ-608 says, with no separate chat allowance. An owner-interrupted stage already ran,
so its recorded duration and any reported cost remain in the aggregate; this change never
initiates that interruption.

### Exhaustion offers two options, not three

The obvious third option — "continue anyway" — is the one deliberately withheld. A resume that
does not raise the budget hits the same wall on the next dispatch, and a system that pauses
again immediately after the owner told it to continue reads as broken rather than as strict. So
the options are *raise to a stated value* or *cancel*, and a raise that does not clear the
current spend is refused naming the spend rather than accepted into an instant re-pause.

The raise lands on `tasks.budgets`, which is already the per-task copy REQ-303 requires — a task
reports the budget it runs under, not a default. That copy was made for cap defaults changing
under a running task; raising a budget is the same operation from the other direction.

### Unknown cost stays unknown all the way to the surface

REQ-305 already stores absent telemetry as absent. This change carries that through the
aggregate: a task's cost spend is a sum *plus* a completeness flag, and the flag survives into
the API and the UI. Presenting `$0.00` for a task whose provider reported nothing would be a
confident lie about the one number the owner most wants to trust — and the agent-minutes figure
sitting beside it is what they should read instead.

## Risks / Trade-offs

- **Agent-minutes and money are not proportional.** A slow cheap model and a fast expensive one
  land differently against the same cap, so the agent-minutes budget is a coarse proxy. Accepted:
  its job is to stop a runaway when the precise instrument is unavailable, not to price the work.
- **The default of 180 agent-minutes is a guess.** It is generous for a task with a 30-minute
  per-stage ceiling and roughly a dozen nodes, and it is per-task configurable. Whether it is
  right is a question for the first real tasks, not for this change.
- **A budget reached mid-stage overshoots.** By design — the alternative discards the run. The
  overshoot is bounded by one stage, which is bounded by the stage timeout.
- **Deriving spend on every dispatch is a query per decision.** Small, indexed, and on a path
  that is already doing a transaction and a lock. Noted here so that the first time it shows up
  in a profile, the intended fix is a maintained column rather than an ad-hoc counter.

## Migration Plan

No migration. `tasks.budgets` is jsonb with both keys already present and already defaulted;
stage rows and conversation response attempts record the durations and telemetry the computation
needs. Existing tasks are covered retroactively — their spend is whatever their runs already say
it was.

Ordering: after `decision-records` and its `task-qa` prerequisite, whose discussion, options, and
answer-and-resume path REQ-1503 and REQ-1504 ride. Independent of `kickoff-brief` and
`harness-probe`; its `task-lifecycle` delta
MODIFIES REQ-608 while `harness-probe` ADDs REQ-615, so the two do not collide. If `task-qa`
archives without budget enforcement, its conversation dispatch records complete input for the
check that lands here.
