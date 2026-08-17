## 1. Schema

- [x] 1.1 Add `node_key` (task status value) and `blocking` to `decisions`, and the partial unique index `(task_id, node_key, key) where status = 'open'` — REQ-307, AC-324 (verify: `bun run db:generate` produces one migration; a second open row for the same triple raises a unique violation in `bun test packages/db`)
- [x] 1.2 Regenerate migrations and confirm no drift — REQ-311 (verify: `bun run db:generate` leaves the journal clean on a second run; `bun run db:migrate` against an empty database succeeds)
- [x] 1.3 Confirm the preceding conversation schema can enforce exactly one `decision`-scoped conversation per decision and cascade it with the task — REQ-1207, REQ-312, AC-332 (verify: `bun test packages/db` rejects a duplicate scoped conversation and preserves the decision/discussion link across reconnect)

## 2. Decision rendering in `packages/core`

- [x] 2.1 `decisionFromRequest(node, stageId, request)`: a `DecisionRequest` plus its node into the row to insert, carrying key, kind, prompt, options, and blocking — REQ-1202 (verify: `bun test packages/core` — blocking and non-blocking requests both render; the node travels with the row)
- [x] 2.2 `escalationForPark(cause, evidence)`: a park cause plus its round record into an escalation-kind decision whose prompt names the cause and carries the evidence, and whose key derives from cause and round — REQ-1203, AC-1208–AC-1210 (verify: table-driven test — one case per cause; the same cause in the same round renders the same key, in the next round a different one)
- [x] 2.3 `renderDecisionLog(decisions)`: the stored set into the `decisions.md` markdown — node, question, options, and answer or dismissal with who and when, dismissals visibly distinct, a header stating the file is generated — REQ-1205, REQ-1206 (verify: `bun test packages/core` — fixture set renders deterministically; two renders of one set are byte-identical; a dismissed decision does not render as an empty answer)
- [x] 2.4 `blockingOpen(decisions)`: whether anything still blocks — the predicate the resume path and the inbox share — REQ-1204 (verify: test — non-blocking-only open set does not block; empty set does not block)

## 3. Engine: raising

- [x] 3.1 Insert the requested decisions when a stage's result carries them, attaching to an open record with the same node and key instead of duplicating, and creating a new one when only resolved records match — REQ-1202, AC-1204, AC-1205, AC-1207 (verify: `bun test apps/orchestrator` — retry re-asking yields one open row; re-ask after an answer yields two rows, the first still answered)
- [x] 3.2 Raise the engine's own escalation in the same transaction as the park, for every cause `advance()` returns — REQ-1201, REQ-1203, AC-1201 (verify: test — parks from `escalate`, `cap_exhausted`, and `repeated_finding` each leave exactly one open escalation; a failed insert rolls the park back)
- [x] 3.3 A non-blocking request does not park: the task advances along its pinned graph with the decision open — REQ-1202, AC-1206 (verify: test — `ok` result carrying a non-blocking request advances and leaves an open row)
- [x] 3.4 Record the parked attempt as `waiting_human` rather than `succeeded`, keeping its committed output and its telemetry — REQ-1201, AC-1202 (verify: test — the stage row reads `waiting_human`; the next dispatch after resolution is a new attempt and the attempt-cap streak is unchanged)
- [x] 3.5 Create exactly one inert decision-scoped conversation in the same transaction as every requested or engine-raised decision; attaching to an existing open decision reuses it and performs no model run — REQ-1207, AC-1221 (verify: orchestrator tests cover requested/escalation/non-blocking decisions, transaction rollback, retry attachment, and zero response dispatches before an owner message)

## 4. Engine: resolving

- [x] 4.1 `Engine.answer(decisionId, actor, {optionId?, text?})`: under the task lock and in one transaction — the answer, the `decision_answer` feedback against the asking stage's role and provider, the `decision.answered` event, and the transition back to `resume_status` when nothing blocking remains open — REQ-1204, AC-1211, AC-1212, AC-1214 (verify: `bun test apps/orchestrator` — last blocker resumes; one of two does not; the feedback row names the role and provider)
- [x] 4.2 Reject resolution of a decision that is not open, and an answer carrying neither an option nor text, without writing anything — REQ-1204, AC-1213, AC-1215 (verify: test — both rejections leave the decision and the task untouched)
- [x] 4.3 `Engine.dismiss(decisionId, actor, reason?)` resolves like an answer for the purpose of resuming, recorded as a dismissal — REQ-1206, AC-1220 (verify: test — dismissing the last blocker resumes the task; the row reads dismissed, not answered)
- [x] 4.4 Dismiss whatever is open when a task reaches a terminal state — REQ-1206, AC-1219 (verify: test — cancelling a parked task leaves no open decisions and empties its attention items)
- [x] 4.5 `Engine.resume` no longer applies to `waiting_human`; the sweep reports a parked task with no open decision as a defect rather than repairing it — REQ-1201, REQ-1204 (verify: test — `resume` on a parked task is refused naming the decision path; a hand-made parked task with no open decision is logged by `sweep()`)
- [x] 4.6 Delegate a confirmed `answer_decision` conversation action to `Engine.answer` with the expected open decision, while ordinary discussion messages and unconfirmed proposals remain inert — REQ-1204, REQ-1207, AC-1222–AC-1224 (verify: tests discuss without resuming, confirm one proposal through the normal answer path, reject a stale proposal, and preserve the recorded outcome during later discussion)

## 5. The decision log in the change folder

- [x] 5.1 Regenerate `decisions.md` from the store into the change folder before a stage is dispatched, so the run's prompt assembly picks it up — REQ-1205, AC-1216 (verify: `bun test apps/orchestrator` — stub-provider stage sees the answered question in its assembled prompt)
- [x] 5.2 The regenerated log rides the stage's own commit, and a stage's edits to it do not survive into the next stage's context — REQ-1205, AC-1217 (verify: `bun test packages/workspace` or the orchestrator e2e — the commit contains the log; a stage that overwrites it is followed by a stage whose log is the store's rendering)
- [x] 5.3 A re-provisioned workspace reproduces the log from the store — REQ-1205, AC-1218 (verify: test — discard and re-provision, then dispatch; the log is present and matches the store)
- [x] 5.4 Confirm no role gains `decision_log` among its writes — REQ-1205 (verify: `bun test packages/core` — the role catalog has no writer of `decision_log`)

## 6. API

- [x] 6.1 `GET /tasks/:id/decisions` returning kind, status, question, options, scoped conversation identity, and the answer or dismissal — REQ-1011, AC-1024 (verify: `bun test apps/api` — a task with one open and one resolved decision returns both with their discussion identities and fields)
- [x] 6.2 `POST /decisions/:id/answer` and `POST /decisions/:id/dismiss` delegating to the engine operations, responding with the task's resulting state — REQ-1011, AC-1022 (verify: test — answering the last blocker responds with the resumed state; the API constructs no transition of its own)
- [x] 6.3 Resolution of an already-resolved decision responds as a conflict, distinguishable from a validation error — REQ-1011, REQ-1010, AC-1023 (verify: test — the two responses carry distinct error codes)
- [x] 6.4 Widen the attention aggregation with open decisions, naming the question and when it was raised, for parked and non-parked tasks alike — REQ-1009, AC-1025, AC-1020 (verify: test — a task with a non-blocking open decision appears; resolving it empties the list)
- [x] 6.5 Accept confirmation of a decision-answer proposal through the conversation action endpoint and delegate it to the same answer operation as the direct endpoint — REQ-1011, AC-1031 (verify: API test compares both paths' decision, feedback, event, and resulting task state and finds no route-owned transition)

## 7. Web

- [x] 7.1 A decision card in the task timeline: markdown question, options as actions, free-text answer, scoped discussion entry, and an explicit "the task is stopped on this" state — REQ-912, AC-921, AC-933 (verify: `bun test apps/web` — a raised decision arriving on the stream renders a card and opens its contextual conversation without reload)
- [x] 7.2 Keep discussion prose and proposed answers visually distinct from the recorded outcome; only direct resolution or explicit proposal confirmation updates the card — REQ-912, AC-922, AC-923, AC-934 (verify: test — follow-up and proposal leave the card open; confirmation shows the answer and removes resolution controls while retaining transcript)
- [x] 7.3 The card and discussion are operable on a phone-sized viewport, and the inbox item for an open decision links to it — REQ-912, REQ-902, AC-924 (verify: test at a phone viewport width — options, discussion, and answer input are reachable with no horizontal scroll; the inbox item navigates to the card)

## 8. Admin entry

- [x] 8.1 Replace `admin.ts resume` with `answer` and `dismiss` over a decision, and list a task's open decisions in `show` — REQ-1204 (verify: `bun apps/orchestrator/src/admin.ts show --task <id>` prints open decisions; answering the last blocker resumes the task)

## 9. End to end

- [x] 9.1 One task walks: a stage asks a blocking question → the task parks with an open decision and inert discussion → the owner asks follow-ups without resuming → confirms a proposed answer → the task resumes at the same node → the next run's prompt carries the decision outcome but no transcript — AC-1201, AC-1211, AC-1216, AC-1221–AC-1223 (verify: `bun test apps/orchestrator` — one e2e case with the stub provider asserts every record, message, transition, and prompt boundary)
- [x] 9.2 A spec loop exhausts its cap with no agent request: the escalation names the loop, the cap, and the round, and answering it resumes the task — AC-1208, AC-1211 (verify: e2e case with a stub reviewer returning `revise` past the cap)

## 10. Validation

- [x] 10.1 `bun run ci` passes (verify: command exits zero)
- [x] 10.2 `openspec validate decision-records --strict` passes and `bun run spec:lint` reports no duplicate or dangling IDs (verify: both commands exit zero)
