## 1. The question cap

- [x] 1.1 Add `max_questions_per_stage` (default 3) to `DEFAULT_CAPS` and `Caps` in `packages/core/src/state.ts`.
- [x] 1.2 Add a pure `partitionRequests(requests, cap)` to `packages/core/src/decisions.ts` returning `{ recorded, refused }`: every blocking request is recorded, and non-blocking questions are recorded up to the cap in the order the stage returned them (decisions AC-1225, AC-1226, AC-1227).
- [x] 1.3 In the stage-completion path of `apps/orchestrator/src/engine.ts`, record only `recorded` and emit a `decision.refused` event naming the refused keys and the cap when `refused` is non-empty.
- [x] 1.4 Unit tests over `partitionRequests`: over the cap, under it, blocking-heavy, and a mixed list preserving order.

## 2. Question identity

- [x] 2.1 Change the open-decision lookup in `apps/orchestrator/src/store.ts` so a non-blocking `question` matches on `(taskId, key)` and everything else keeps `(taskId, nodeKey, key)`; keep `attachToOpenDecision`'s prompt refresh unchanged (decisions AC-1228, AC-1207).
- [x] 2.2 Tests in `apps/orchestrator/test/decisions.test.ts`: one question from two nodes is one open decision carrying the later prompt; two escalations under one key from two nodes stay two records.

## 3. Repository-scoped answers

- [x] 3.1 Add a `repo_policies` table to `packages/db/src/schema.ts`: `repoUrl`, `key`, `value` jsonb, `originTaskId` (nullable, `on delete set null`), `revokedAt` (nullable), timestamps, and a partial unique index on `(repo_url, key) where revoked_at is null` (persistence AC-340, AC-342).
- [x] 3.2 Generate the migration; hand-add the caps backfill merging `max_questions_per_stage` into existing rows.
- [x] 3.3 Store functions in `apps/orchestrator/src/store.ts`: `livePolicy(db, repoUrl, key)`, `recordPolicy(db, {repoUrl, key, value, originTaskId})` (idempotent against the partial index — an existing live record wins, AC-1427), `revokePolicy(db, id)` for the owner's revocation, and `revokeLivePolicy(db, repoUrl, key)` for the one an adequate classification performs.
- [x] 3.4 Verify against a live database that the partial index refuses a second live row and permits a second row once the first is revoked.

## 4. Waiver and inheritance

- [x] 4.1 Write the policy wherever the waiver is written today — `waiveHarnessStatus` in `apps/orchestrator/src/engine.ts`, which both the explicit `proceed` and the gate-approval route already share (harness-coverage REQ-1406).
- [x] 4.2 In `recordPlanOutcome`: when coverage is short of adequate and a live policy exists for the task's repository, waive the task's coverage, write the resolved inheritance decision at `(human_kickoff_gate, harness-coverage)` naming the origin task, and build the choice with no coverage assessment so only a proposed plan can still raise a card (AC-1422, AC-1423, AC-1424).
- [x] 4.3 In the same function: when coverage is classified adequate, revoke the repository's live policy — the gap it accepted is gone (AC-1425).
- [x] 4.4 Make sure the inherited decision is not re-created on the second probing stage of the same task: `inheritCoverageWaiver` checks for an existing record at that identity, resolved or not, before writing one.

## 5. REST and UI

- [x] 5.1 `GET /api/v1/repo-policies` returning the live records with their repository, key, origin task id and title, and creation time (task-surface AC-1043).
- [x] 5.2 `DELETE /api/v1/repo-policies/:id` revoking one, responding with the structured not-found error when it does not exist or is already revoked (AC-1044, AC-1045).
- [x] 5.3 API tests for both, including the not-found shape.
- [x] 5.4 A `RepoPolicies` section on the Settings screen listing them with a revoke control and an explicit empty state (operator-ui AC-950, AC-951, AC-952).

## 6. Test isolation

- [x] 6.1 A repository-scoped record outlives the task that made it, which the DB-backed suites did not have to think about before: give each seeded fixture task its own repository URL, clear the harness-coverage suite's policies in its `afterEach`, and clear the shared e2e origin's between e2e tests.

## 7. Tests

- [x] 7.1 `apps/orchestrator/test/harness-coverage.test.ts`: proceeding records the policy; a second task in the same repository inherits it with no open decision and a resolved inheritance record; an adequate classification revokes it; a plan with prerequisites still raises its card while inheriting the waiver.
- [x] 7.2 A cap test: a planner result with five questions records three and emits the refusal event naming the other two.
- [x] 7.3 `bun run ci` green: `check`, `typecheck`, `test`, `spec:validate`, `spec:lint`.
