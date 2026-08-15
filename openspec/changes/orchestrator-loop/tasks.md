## 1. Pipeline definition model

- [ ] 1.1 Define the pipeline types in `packages/core`: stage nodes (role, provider binding), gate nodes (approve target, redirect target with cap identity, rework targets), loop edges (target, loop identity), terminal outcome, and the catalog keyed by task type (verify: `packages/core/src/pipeline.ts` exports the types and the catalog)
- [ ] 1.2 Implement structural validation: unique node keys, keys within the task-status set, known roles, loop edges strictly backwards, gate resolutions resolvable, terminal reachable from every node — each defect reported naming the definition and the offending element (verify: `bun test packages/core` — one failing fixture per defect class)
- [ ] 1.3 Run validation at module load so an invalid catalog fails the process before any task is scheduled (verify: test — importing a catalog with a forward loop edge throws naming the edge)

## 2. The feature/bugfix definition

- [ ] 2.1 Encode the feature/bugfix definition mirroring the lifecycle: planning → kickoff brief → kickoff gate → research ⇄ spec review (spec cap) → spec gate → implement → verify → code review (impl cap, loop edges from verify and code review both to implement) → summarize → final gate, terminal archived; the publish node is added by the Phase-5 change (verify: test — loop identities, targets, and the three gates match the spec scenarios)
- [ ] 2.2 Derive the old `TRANSITIONS` table from the definition in a test, so the hand-written table and the graph cannot drift while both exist (verify: test — graph-derived transitions equal `state.ts` for every state)
- [ ] 2.3 Replace `canTransition` with graph-derived legality: pinned-graph edges plus the unchanged interrupt rules; delete the hand-written table once the test in 2.2 anchors the shape (verify: `bun test packages/core` — interrupt entry/exit cases keep passing)

## 3. Instantiation and pinning

- [ ] 3.1 Instantiate a definition into a task's run graph at creation, recording caps, budgets, and provider bindings on the task; reject a task type absent from the catalog naming it (verify: test — created task's `run_graphs` row matches the definition; unknown type rejected)
- [ ] 3.2 Widen the `RunGraphDag` jsonb type to carry gates, loop edges, and the terminal, and the stage cost jsonb to a structured usage record — model, timing, token kinds, cost, raw envelope — with no migration (verify: `bun run typecheck`; `drizzle-kit` generates no new migration)
- [ ] 3.3 Append a new graph version on re-planning, leaving prior versions and their stages readable (verify: test — version 2 created, version 1 and its stage rows intact)

## 4. Advancing

- [ ] 4.1 Implement `advance` as a pure function of pinned graph, node, outcome, stored rounds, and caps → transition, with no I/O (verify: `bun test packages/core` — table-driven cases for approve, revise-within-cap, revise-at-cap, escalate, plain success)
- [ ] 4.2 Record a review round with verdict and findings on every review completion, relying on the unique constraint against double-recording (verify: test — replaying the same completion does not create a second round)
- [ ] 4.3 Park on escalate and on cap exhaustion with the resume target stored, and emit an event naming the cause (verify: test — task in `waiting_human`, resume state recorded, event present)

## 5. The loop

- [ ] 5.1 Implement the poll tick in `apps/orchestrator`: select tasks positioned at a stage node with no attempt in flight, take a per-task advisory lock, dispatch up to the configured concurrency (verify: test with a stubbed runner — two runnable tasks, concurrency 1, one dispatch per tick)
- [ ] 5.2 Dispatch a stage end to end: ensure the workspace, create or update the attempt record, execute through the runner, persist the outcome and cost, commit per the workspace contract, then advance (verify: test — stub provider walks one stage and the task moves to the next node)
- [ ] 5.3 Bind the provider per stage from the role catalog and the cross-provider rule, recording the binding on the stage (verify: test — single configured provider reviews its own work, per agent-contracts)
- [ ] 5.4 Emit an event for every transition, dispatch, completion, and park (verify: test — the event sequence for one happy-path stage is exactly dispatch → completion → transition)
- [ ] 5.5 Add the orchestrator settings — poll interval, stage concurrency, per-stage attempt cap — validated at startup like the existing ones (verify: startup with an invalid value exits non-zero naming the variable)
- [ ] 5.6 Persist per-attempt telemetry from the runner's envelope: reported model, start and finish, token usage by kind, cost, raw envelope — absent recorded as null, never zero (verify: test — the stub's envelope surfaces model and tokens on the attempt row; a garbled envelope leaves telemetry null and the stage still succeeds)
- [ ] 5.7 Verify per-task aggregation is answerable from the store alone: total tokens and cost per stage and per round for one task (verify: test — a seeded two-round task aggregates without reading logs)

## 6. Failure and retries

- [ ] 6.1 On a failed attempt, discard the workspace and re-dispatch with an incremented attempt number while attempts remain (verify: test — attempt one half-rewrites an artifact and fails; attempt two reads the committed text)
- [ ] 6.2 On attempt-cap exhaustion, move the task to `failed` recording the stage and last reason, and emit the event (verify: test — the task record and event name the stage and reason)
- [ ] 6.3 Keep the runner's internal result-retry and the engine's attempt cap distinct: one dispatch consumes one attempt regardless of the runner's inner retry (verify: test — a dispatch whose runner retried internally still counts as one attempt)

## 7. Restart recovery

- [ ] 7.1 Label runner containers with task, node, and attempt in the docker backend's argument vector (verify: unit test asserts the label flags)
- [ ] 7.2 On startup, sweep: find stages recorded `running`, terminate any container carrying their label, discard the workspace, mark the attempt failed with reason `orphaned`, and re-dispatch under the same cap, updating records in place (verify: test — a seeded `running` stage with no container is re-run as the next attempt with no duplicate rows)
- [ ] 7.3 Leave parked and gated tasks untouched by the sweep (verify: test — a task at a gate is identical before and after startup)
- [ ] 7.4 Log what the sweep found and killed (verify: test — the sweep's log names the task, node, and attempt)

## 8. Gate operations

- [ ] 8.1 Implement `approve`, `redirect`, and `rework` validating against the pinned graph: approve follows the gate's approve edge, redirect follows its redirect edge and counts against its cap identity, rework re-enters a declared target with fresh round counters (verify: tests — each op from a seeded gate, plus rejection from a non-gate state)
- [ ] 8.2 Implement `resume` for parked escalations, returning the task to its recorded resume state (verify: test — parked task resumes exactly where it stopped)
- [ ] 8.3 Record the acting identity and an event for every gate operation (verify: test — approve writes an event naming who)
- [ ] 8.4 Expose the operations and dev task creation (a task positioned at a named node, for manual runs until intake exists) through the orchestrator's admin entry point (verify: a seeded task at `research` walks to the spec gate and is approved from the command line)

## 9. Terminal housekeeping

- [ ] 9.1 Release the task's workspace on archive and on cancel, keeping the branch in the mirror (verify: test — worktree gone, branch still resolvable in the mirror)
- [ ] 9.2 Make the final gate's approve resolve to `archived` in the shipped definition, per the deferred publish node (verify: test — approval at the final gate archives)

## 10. Documentation

- [ ] 10.1 Document the new orchestrator settings in `.env.example` and the loop's recovery behavior in `README.md` (verify: a fresh clone finds every new variable documented)
- [ ] 10.2 State in `README.md` that pipelines are data and where the catalog lives, so the incident phase starts from the written rule (verify: `README.md` names `packages/core` as the catalog's home)

## 11. Validation

- [ ] 11.1 `bun run ci` passes (verify: command exits zero)
- [ ] 11.2 `openspec validate --changes orchestrator-loop --strict` passes (verify: command exits zero)
