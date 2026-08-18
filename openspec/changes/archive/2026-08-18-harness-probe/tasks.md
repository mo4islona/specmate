## 1. The assessment in the result contract

- [x] 1.1 Add the coverage assessment to `StageResult` — the classification from the stored vocabulary plus the evidence behind it — and a `probesHarness` flag to `RoleContract`, set for the planner and no other role — REQ-110, REQ-1401 (verify: `bun run typecheck`; `bun test packages/core` — the catalog marks exactly the planner)
- [x] 1.2 Reject a probing role's result that carries no assessment, feeding the existing retry-then-escalate flow; leave every other role's result accepted without one — REQ-110, AC-124, AC-125 (verify: `bun test packages/core` — a planner result without the assessment is invalid naming the role; a researcher result without one is valid)

## 2. Recording the classification

- [x] 2.1 Write the classification and its evidence onto the task when a probing stage completes, before the task advances — REQ-1401, AC-1403 (verify: `bun test apps/orchestrator` — after a stub planning stage the task's coverage is what the result carried, and nothing read the change folder)
- [x] 2.2 Keep the ledger's coverage line truthful for every later stage, including the evidence in short form — REQ-1401, REQ-1405, AC-1414 (verify: `bun test packages/runner` — a waived task's ledger states the waiver; renders stay deterministic)

## 3. The warning the brief cannot omit

- [x] 3.1 Extend `checkBrief` with the coverage rule: given a task coverage short of adequate, a brief whose key points carry no coverage warning fails, naming it — REQ-1402, AC-1404, AC-1405 (verify: `bun test packages/core` — fixtures for missing-and-silent, missing-and-warned, adequate-and-silent)
- [x] 3.2 Pass the task's recorded coverage into the check from the executor, as a parameter beside the length ceiling — REQ-1402 (verify: `bun test packages/runner` — the executor's check receives the task's coverage; a stub run on a `missing` task with a silent brief fails before the commit)
- [x] 3.3 Refuse to reach the gate while coverage is unknown after planning — REQ-1402, AC-1406 (verify: `bun test apps/orchestrator` — a planning result whose assessment never landed does not advance the task to the brief's gate; folded into the same `checkBrief`/`checkBriefCompleteness` coverage rule as 3.1/3.2 — `human_kickoff_gate` is a gate node, unreachable via the dev `at:` override, so `kickoff_brief`'s brief check is the only door and already refuses `unknown`)

## 4. The choice

- [x] 4.1 Raise the coverage decision — split, proceed, cancel — as a non-blocking decision with options when coverage is short of adequate, so it reaches the kickoff gate with the brief; raise nothing when coverage is adequate — REQ-1403, AC-1407, AC-1410 (verify: `bun test apps/orchestrator` — a `partial` task parks at its gate with the decision open; an `adequate` one has none)
- [x] 4.2 Answering "proceed" records the waiver on the task and lets the gate approve into research — REQ-1403, AC-1408 (verify: test — the task's coverage reads waived and research is dispatched)
- [x] 4.3 Approving the gate with the coverage decision unanswered means proceeding: the waiver is recorded as the decision resolves — REQ-1403, AC-1409 (verify: test — approve without answering leaves a waived task and a resolved decision, and the resolution reads as proceeding rather than as an empty dismissal)
- [x] 4.4 Answering "cancel" cancels the task through the existing operation — REQ-1403 (verify: test — the task is cancelled and its open decisions are dismissed by the existing terminal path)
- [x] 4.5 Allow the owner to discuss the coverage evidence and options while keeping messages and proposed answers inert until an option is explicitly confirmed — REQ-1403, AC-1417 (verify: test — discussion leaves coverage and task state unchanged; confirming an option invokes the existing answer path)

## 5. The split

- [x] 5.1 Answering "split" creates a harness task against the same repository and base branch, its request carrying the probe's evidence and what the harness must cover — REQ-1404, AC-1411 (verify: `bun test apps/orchestrator` — the new task exists with its own pinned graph and its request quotes the evidence)
- [x] 5.2 Record the dependency and move the original to `blocked`; refuse a dependency that would make a task wait on itself — REQ-1404, REQ-615, AC-1411, AC-1413 (verify: test — the original is `blocked` with the harness task in its blockers; a self-dependency is rejected and nothing is written)
- [x] 5.3 Widen `canTransition`'s interrupt rule so `blocked` is enterable from any active state, leaving its outgoing edges as the graph already declares them — REQ-615 (verify: `bun test packages/core` — entering `blocked` is legal from a stage node and from a gate; leaving it still resolves only to the pipeline entry or cancellation)

## 6. Waiting and release

- [x] 6.1 Confirm nothing is dispatched for a blocked task under repeated polling — REQ-615, AC-626 (verify: `bun test apps/orchestrator` — several ticks with a blocked task dispatch nothing for it)
- [x] 6.2 Release dependents when a blocker reaches its terminal successfully: the last blocker clears, the task enters its pipeline's entry and re-plans — REQ-1404, REQ-615, AC-627, AC-628, AC-1412 (verify: test — with two blockers the task waits for both; on release it enters `planning` and its coverage is classified again)
- [x] 6.3 Raise a dependent to the human when its blocker is cancelled or fails, with a decision naming the dead blocker — REQ-615, AC-629 (verify: test — cancelling a blocker leaves the dependent parked with an open decision, not blocked forever)

## 7. Prompts

- [x] 7.1 Extend `roles/planner.md`: what to probe for, how to classify the area the task touches, that the classification and its evidence go in `RESULT.json`, and that a gap is a mandatory key-points warning stated in the brief — REQ-1401, REQ-1402, AC-1402 (verify: the prompt's vocabulary matches the stored classification set; its example result parses against `StageResult` in a test)
- [x] 7.2 Add one line to `roles/summarizer.md`: a waived task's summary states it was verified without a state-level harness — REQ-1405, AC-1415 (verify: `bun test packages/runner` — the summarizer prompt for a waived task carries the instruction and the ledger's waiver)

## 8. Web

- [x] 8.1 Show the task's coverage state on the task view, with a waiver visually distinct, without opening an artifact — REQ-1405, AC-1416 (verify: `bun test apps/web` — a waived task renders its coverage state on the task view)
- [x] 8.2 Present the coverage decision's options and scoped discussion at the kickoff gate alongside the brief, with confirmation distinct from chat — REQ-1403, AC-1407, AC-1417 (verify: test — discussion and all three explicit options are operable from the gate view at a phone-sized viewport; the gate's existing decision list already renders every open decision generically — DecisionCard's options/discuss controls are unchanged and mobile-first by construction, so no task-screen changes were needed beyond §8.1's badge)

## 9. End to end

- [x] 9.1 A task on a repository with no harness for the touched area: planning classifies it `missing`, the brief carries the warning, the owner discusses the choice without changing state, then explicitly proceeds; research starts with the waiver in its ledger — AC-1404, AC-1407, AC-1408, AC-1414, AC-1417 (verify: `bun test apps/orchestrator` — one e2e case with the stub provider)
- [x] 9.2 The same task split instead: a harness task is created, the original blocks, the harness task archives, the original re-enters planning and is classified again — AC-1411, AC-1412, AC-627 (verify: same e2e file, second case)

## 10. Validation

- [x] 10.1 `bun run ci` passes (verify: command exits zero)
- [x] 10.2 `openspec validate harness-probe --strict` passes and `bun run spec:lint` reports no duplicate or dangling IDs (verify: both commands exit zero)
