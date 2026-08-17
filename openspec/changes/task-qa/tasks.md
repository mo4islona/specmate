## 1. Persistence

- [x] 1.1 Replace the unshipped `asks` schema and migration with `conversations`, `conversation_messages`, and `conversation_actions`, including ordered-message, one-active-response, scoped-subject, idempotent-action, and task-cascade constraints — REQ-312, AC-327–AC-329 (verify: `bun run db:generate` produces the replacement migration; `bun test packages/db` rejects duplicate active responses and duplicate subject conversations)
- [x] 1.2 Add `interrupted` to stage status and `conversation` / `intervention` to feedback kind; store interruption actor/action and preserve absent telemetry as absent — REQ-302, REQ-309, REQ-1607 (verify: `bun test packages/db` rejects unknown enum values and round-trips an interrupted attempt with missing usage)
- [x] 1.3 Remove the ask schema/API types and confirm migration/schema parity from an empty database — REQ-311 (verify: `bun run db:generate` is clean on a second run and `bun run db:migrate` succeeds against an empty database)

## 2. Conversation core

- [x] 2.1 Define conversation, ordered message, response-attempt, and action contracts with closed lifecycles and expected-version targets — REQ-1601, REQ-1602, REQ-1606 (verify: `bun test packages/core` covers legal lifecycles, FIFO positions, and stale target rejection)
- [x] 2.2 Implement transactional operations to open/list conversations, append owner messages with `conversation` feedback and events, claim one response, settle/retry it, and cascade terminal-task rejection — REQ-1601, REQ-1602, REQ-309 (verify: core tests cover active/terminal tasks, concurrent posts, one retry, and later-message progress after failure)
- [x] 2.3 Change the answer-only role and structured result to produce one assistant message plus validated action proposals while retaining zero write permissions — REQ-102, REQ-1606 (verify: `bun test packages/core` rejects unknown action kinds and confirms no conversation role may write artifacts or product code)
- [x] 2.4 Build deterministic conversation context from stored summary/transcript, task ledger, current artifacts and code diff, plus state/artifact deltas since the anchor — REQ-1603, AC-1606–AC-1608 (verify: core fixtures reconstruct byte-identical context after session metadata is removed and exclude transcript from stage context)

## 3. Runner and disposable snapshots

- [x] 3.1 Replace the one-shot answer executor with a conversational executor that accepts stored context and emits a message/action result through scratch without committing files — REQ-102, REQ-1603, REQ-1605 (verify: `bun test packages/runner` covers follow-up context, malformed output, and a straying run whose edits and detached commit disappear)
- [x] 3.2 Expose a cancellable execution handle for both isolated and local backends, terminating the exact labeled task/node/attempt and settling the run promise once — REQ-1607, AC-1619 (verify: runner tests interrupt a hanging child/container and prove a differently labeled run survives)
- [x] 3.3 Preserve opaque provider-session metadata when returned and record whether stored, cached, or reconstructed context served each attempt without requiring session reuse — REQ-1603, REQ-1604 (verify: runner tests return opaque metadata and reconstruct the same logical conversation without consuming it)

## 4. Conversation scheduling and recovery

- [x] 4.1 Add a conversation response pool independent of stage workspace ownership, FIFO within each conversation and bounded globally — REQ-1602, REQ-1605, AC-1611 (verify: `bun test apps/orchestrator` runs a response beside a blocked stage, never runs two responses for one conversation, and preserves message order)
- [x] 4.2 Use the reconstruction-first path permitted by REQ-1604: release every disposable response runtime without closing the conversation and rebuild later turns from durable context; keep reuse metadata optional — REQ-1603, REQ-1604 (verify: orchestrator tests complete consecutive turns in order, release every snapshot, and identify the reconstructed/stored context path)
- [x] 4.3 Recover orphaned response attempts from the store under the single-retry cap and clean their deterministic snapshots — REQ-1602, REQ-312, AC-327 (verify: orchestrator restart test settles a stale active response and continues its queued successor)
- [x] 4.4 Advance the stored context anchor only in message order and include committed task/state deltas on the next turn — REQ-1605, AC-1612 (verify: a stage commits between two turns and the second context names the new commit and changed artifacts)

## 5. Confirmed actions and interruption

- [x] 5.1 Persist proposals and confirm actions idempotently under the task lock, comparing their expected task/decision/gate/stage version before delegating — REQ-1606, AC-1614–AC-1616 (verify: orchestrator tests prove an unconfirmed proposal is inert, duplicate confirmation applies once, and a stale target returns conflict)
- [x] 5.2 Render confirmed future-run guidance into the task ledger and record which stage consumed it, never including surrounding transcript — REQ-102, REQ-1603, REQ-1606 (verify: stage prompt fixture contains the action id and instruction but none of the preceding conversation)
- [x] 5.3 Implement direct stop claim: conditionally mark the exact running stage interrupted, pause the task at its node, and record stopping before external termination — REQ-1607, AC-1618, AC-1623 (verify: a completion-vs-stop race has exactly one winner, no later stage is targeted, and stopping requires no conversation)
- [x] 5.4 Terminate the exact execution, wait for settlement, discard to the last accepted commit, verify cleanliness, then leave the task paused with restart available — REQ-1607, REQ-711, AC-1620, AC-1623, AC-735 (verify: orchestrator/workspace tests remove tracked and untracked partial edits; successful cleanup dispatches nothing and failed cleanup exposes no restart)
- [x] 5.5 Implement separate restart of the interrupted stage with optional guidance entered directly or selected from a conversation proposal; store the confirmed target/text as one intervention and return to the stored node only after safe cleanup — REQ-1607, AC-1617, AC-1624 (verify: restart without guidance, with direct guidance, and with a conversation instruction each create one new attempt at the same node; only confirmed text enters its ledger)
- [x] 5.6 Guard every stage completion/commit with `status = running`, so a late result from an interrupted attempt is discarded; exclude interrupted rows from the trailing failure cap while retaining history and spend — REQ-613, REQ-1607, AC-1619, AC-631 (verify: a killed stub returns success late, produces no commit/transition, and its replacement still has the full failure allowance)
- [x] 5.7 Recover an applying stop after orchestrator death by repeating exact-label termination and idempotent cleanup while keeping the task paused — REQ-1607, AC-1620, AC-1623 (verify: restart test seeds each boundary between claim, kill, and discard and reaches one safely paused task with no replacement attempt)

## 6. API and events

- [x] 6.1 Replace ask endpoints with conversation create/list, message append, transcript read, and response-telemetry reads; reject terminal posts with structured errors — REQ-1012, REQ-1601, REQ-1608 (verify: `bun test apps/api` covers each endpoint, ordered hydration, and terminal conflict)
- [x] 6.2 Add action confirmation through the engine operation, reporting action/task state and distinguishing stale conflict from validation failure — REQ-1012, AC-1028, AC-1029 (verify: API tests assert delegation and prove no transition logic exists in the route)
- [x] 6.3 Emit resumable events for message/response/action lifecycle and reconstruct transcript plus later events without gaps or duplicates — REQ-1012, REQ-1608, AC-1030 (verify: stream test reconnects mid-response and observes completion and action application once)
- [x] 6.4 Expose direct stop and separate restart endpoints that delegate to the orchestrator, persist direct restart guidance idempotently, and report stopping/paused/running conflicts distinctly — REQ-1012, AC-1032, AC-1033 (verify: API tests stop without a conversation, observe paused after cleanup, retry direct guidance without duplication, and restart only through the separate operation)

## 7. Web

- [x] 7.1 Replace comment/ask mode with a hydrated multi-turn conversation surface showing ordered messages, response progress/failure, and each answer's state/commit anchor — REQ-914, REQ-1608, AC-929 (verify: `bun test apps/web` reloads mid-response and renders a contextual follow-up without manual refresh)
- [x] 7.2 Render proposed actions separately from prose and require confirmation that names target, instruction, and effect; retain the transcript on validation or conflict — REQ-914, REQ-1606, AC-930, AC-932 (verify: web tests prove a proposal has no effect before confirmation and a conflict refreshes task state)
- [x] 7.3 Implement stop confirmation with explicit uncommitted-work/cost disclosure and phone-sized operability, then a separate restart form naming the interrupted stage and accepting optional direct or proposed guidance — REQ-914, REQ-1608, AC-931, AC-1622, AC-1624 (verify: browser at 390px reaches both controls, shows the exact restart instruction at confirmation, and operates them without horizontal scrolling)
- [x] 7.4 Show `Stop current run` whenever a stage is running, display stopping/cleanup progress, then show a separate restart control on the paused task — REQ-914, AC-935 (verify: browser test stops a run with no conversation present and cannot restart before cleanup succeeds)
- [x] 7.5 Render the pinned pipeline with the current node, attempt, state, and accepted commit, plus a durable activity timeline that exposes accepted commits/artifacts but never labels in-flight file edits as accepted — REQ-914, AC-937, AC-938 (verify: web tests cover running, stopping, paused, completed, and an in-flight edit that appears only after accepted completion)

## 8. Spend and end to end

- [x] 8.1 Include every conversation response attempt and interrupted stage in task spend, preserving incomplete provider telemetry — REQ-1604, REQ-1607, REQ-1501 (verify: spend test includes a failed response retry and an interrupted stage, with absent cost marked incomplete)
- [x] 8.2 Walk one task end to end: watch its current pipeline node and activity, discuss during a running stage, receive a commit-anchored answer, stop directly, observe paused state/interrupted history/clean rollback, then enter and confirm new restart guidance and see the replacement consume only that instruction and advance — AC-1611, AC-1617, AC-1619, AC-1623, AC-1624, AC-937, AC-938 (verify: orchestrator/web e2e asserts store rows, events, prompt content, visible pipeline state, accepted-change boundary, branch history, and final state)

## 9. Validation

- [x] 9.1 `bun run ci` passes (verify: command exits zero)
- [x] 9.2 `openspec validate task-qa --strict` and `bun run spec:lint` pass (verify: both commands exit zero)
