## 1. Persistence

- [ ] 1.1 `asks` table in `packages/db/src/schema.ts` — task FK (cascade), question, status enum (`pending|answering|answered|failed`), answer/failure text, telemetry jsonb (the shared usage record type), created/resolved timestamps — plus `question` in `feedback_kind`; generate the migration (verify: inspect the generated SQL — one table, one additive enum alter)
- [ ] 1.2 DB tests: status enum rejected outside the closed set; cascade on task delete removes asks (verify: `bun test packages/db`)

## 2. Core

- [ ] 2.1 `answerer` entry in the role catalog: reads all artifact kinds, writes none, may-modify-code false; catalog/RESULT.json validation accepts the role (verify: `bun test packages/core`)
- [ ] 2.2 Ask operations in `packages/core`: create (ask row + `question` feedback row + `ask.created` event, one transaction; rejects empty question and terminal task), resolve (store answer/failure + event), list (verify: core tests cover create on active/terminal tasks and both resolutions)
- [ ] 2.3 `roles/answerer.md`: answer from the artifacts and the ledger; never promise or make changes; point at redirect/rework for action; write the answer to `ANSWER.md` in the scratch area (verify: file exists and states the no-changes rule)

## 3. Runner

- [ ] 3.1 Answer-only run shape in `packages/runner`: inject the question into context assembly, read `ANSWER.md` back as the run product, missing/empty answer with an `ok` result is a failed run (verify: runner test with a stubbed provider)
- [ ] 3.2 Enforce read-only mechanically: after the run, the workspace discard path restores the tree; a run that modified files still yields its answer but the modifications are gone and no commit exists (verify: runner/workspace test drives a straying stub)

## 4. Orchestrator

- [ ] 4.1 Ask executor on the tick: oldest pending ask per workspace-idle task, stages scheduled before asks, mark `answering`, run, resolve; single retry then `failed` (verify: orchestrator test — ask posted mid-stage runs only after the stage, three asks answer oldest-first)
- [ ] 4.2 Restart recovery: an `answering` ask with no live run is treated as a failed attempt and re-run under the retry cap (verify: orchestrator test seeds a stale `answering` row)
- [ ] 4.3 Telemetry recorded per answering attempt on the ask row, same record type as stage attempts (verify: test asserts model/timings/tokens/cost present, absent ≠ zero)

## 5. API

- [ ] 5.1 `POST /tasks/:id/asks` and `GET /tasks/:id/asks` delegating to the core operations; structured errors: `validation` for empty question, `conflict` for terminal task, `not_found` for unknown task (verify: api tests for each)
- [ ] 5.2 `ask.created` / `ask.answered` / `ask.failed` flow through the SSE stream with resume like any event (verify: api stream test observes all three)

## 6. Web

- [ ] 6.1 Input mode control on the task view: comment | ask, operable at 390px width (verify: browser at phone viewport)
- [ ] 6.2 Timeline rendering: question entry appears immediately with pending pulse, answer renders as markdown (raw HTML disabled) beneath it on `ask.answered`, failure with reason on `ask.failed`, all without reload; asks visually distinct from comments and labeled with the stage the task was in (verify: browser against live and failing fixture asks)
- [ ] 6.3 Q&A history hydrates from `GET /asks` on load, stream only appends — reload mid-pending shows the pending ask (verify: reload the task view while an ask is pending)

## 7. End-to-end

- [ ] 7.1 Full pass: post an ask mid-stage from the browser, watch the stage finish first, the answer arrive on the stream, the `question` feedback row and telemetry recorded, and the task branch free of any ask trace (verify: scripted walkthrough; `git log` on the task branch shows stage commits only)
