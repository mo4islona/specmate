## 1. The owner's request reaches the task

- [x] 1.1 Add a nullable `description` column to `tasks` and regenerate the migration — REQ-303, AC-326 (verify: `bun run db:generate` produces one migration and leaves the journal clean on a second run)
- [x] 1.2 Accept optional request text in `CreateTask`, store it, and return it on task reads — REQ-1001, AC-1026 (verify: `bun test apps/api` — a task created with request text returns it; one created without is accepted)
- [x] 1.3 Render the request into the ledger, falling back to the title when absent — REQ-202, AC-224 (verify: `bun test packages/runner` — ledger snapshot carries the request; the title-only task renders the title as the ask; two renders of one state stay byte-identical)

## 2. The owner's gate comments reach the next stage

- [x] 2.1 Load the task's gate comments (redirect and rework feedback, newest last) into the ledger snapshot — REQ-202, REQ-1305 (verify: `bun test packages/runner` — `ledger-db` test asserts the comment is loaded with the gate it was left at)
- [x] 2.2 Render them in the ledger without letting them grow unbounded, under the existing ledger byte limit — REQ-202, AC-225, AC-1312 (verify: test — a task redirected twice renders both comments; an oversized set is truncated by the existing limiter, not by an ad-hoc rule)

## 3. The planner can read

- [x] 3.1 Give the planner's role contract `reads: ['proposal', 'decision_log']`, leaving `writes: ['proposal']`, `writesCode: false`, and `injectSpecSkill: false` — REQ-1301, REQ-1302 (verify: `bun test packages/core` — the catalog test asserts the planner's declared kinds; `bun test packages/runner` — a planner prompt with a draft proposal in the folder contains it)
- [x] 3.2 Declare on the role contract that a planner run's proposal output is checked for completeness — REQ-1303 (verify: test — the flag is set for the planner and for no other role)

## 4. The brief check

- [x] 4.1 Implement `checkBrief(markdown)` in `packages/core`: the required parts present and non-empty (what and why, approach, key points, questions or their explicit absence, size with expected iterations) and the document within the configured ceiling; the result names every missing part — REQ-1302, REQ-1303 (verify: `bun test packages/core` — fixtures for a complete brief, each part missing in turn, an empty section, a silent questions section, and an over-long brief)
- [x] 4.2 Run it in the executor after the run and before the commit, for roles the catalog declares, only when the run wrote the proposal; a failure fails the attempt naming the missing parts and commits nothing — REQ-1303, AC-1306, AC-1307 (verify: `bun test packages/runner` — stub run leaving an incomplete brief fails the attempt and never reaches the commit hook; a complete one commits)
- [x] 4.3 Leave every other role untouched by the check — REQ-1303 (verify: test — a researcher run rewriting `proposal.md` into a full proposal passes the executor unchanged)

## 5. `roles/planner.md`

- [x] 5.1 Write the prompt: what the planner is given, that `planning` reads the repository and grounds the draft while `kickoff_brief` presents it, the exact brief shape with its key-points and questions blocks, the length discipline, and the rule that an unplaceable request is a blocking decision rather than an invented brief — REQ-1301, REQ-1302, AC-1302, AC-1304 (verify: the prompt names the same section headings `checkBrief` accepts; `bun test packages/runner` — the prompt file resolves for the planner role)
- [x] 5.2 State the `RESULT.json` shape for both nodes, including open questions as non-blocking decision requests and the stable keys they carry — REQ-1304, REQ-105 (verify: prompt's example result parses against `StageResult` in a test)

## 6. Questions on the card

- [x] 6.1 Raise the brief's questions as non-blocking decisions so the task reaches its gate carrying them — REQ-1304, AC-1309 (verify: `bun test apps/orchestrator` — a brief stage returning non-blocking requests advances to the gate with the decisions open)
- [x] 6.2 Resolve what a task has open when a gate is approved: answers stand, unanswered ones are dismissed as declined — REQ-1304, AC-1310, AC-1311 (verify: test — approving with one answered and one unanswered question leaves one answered and one dismissed decision, and the rendered decision log shows both)
- [x] 6.3 Confirm research reads them: the log the research stage receives carries the answers and the declines — AC-1310, AC-1311 (verify: orchestrator e2e — the stage after the gate has both in its assembled prompt)
- [x] 6.4 Give every brief question its decision-scoped conversation and keep discussion messages or proposed answers inert until the owner explicitly resolves the decision — REQ-1304, AC-1315 (verify: test — a follow-up message and a proposed answer leave the decision open; explicit confirmation records the answer)

## 7. Web

- [x] 7.1 Make the request text the new-task form's primary input, optional, preserved on validation failure — REQ-903, AC-925 (verify: `bun test apps/web` — a multi-paragraph request reaches the client's API call intact)
- [x] 7.2 Render the brief in the task view at the kickoff gate, key-points block accented, with the gate actions — REQ-913, AC-926 (verify: test — a task parked at `human_kickoff_gate` renders the proposal inline; deciding needs no navigation)
- [x] 7.3 Discuss and answer the brief's questions from the gate view, keeping explicit answer confirmation separate from chat; present redirect as unavailable with its reason when the cap is spent — REQ-913, AC-927, AC-928, AC-936 (verify: test — discussion keeps the decision and gate actions live; confirming an answer resolves it; a task at the cap shows approve and cancel operable and redirect disabled with the reason)

## 8. The cap is a real stop

- [x] 8.1 Surface the spent redirect cap as a conflict the client can branch on, leaving the task at its gate — REQ-1305, AC-1313, AC-1314 (verify: `bun test apps/api` — the third redirect responds with the cap conflict code and the task's status is unchanged)

## 9. End to end

- [x] 9.1 A task walks draft → planning → kickoff_brief → gate with the stub provider: the brief is complete, its questions are open and discussable without being resolved, and the task is parked at the gate — AC-1303, AC-1309, AC-1315 (verify: `bun test apps/orchestrator` — one e2e case)
- [x] 9.2 Redirect once with a comment, and assert the regenerated planning stage's prompt carries it; then approve and assert research starts with no open question — AC-1312, AC-1311 (verify: same e2e file, second case)

## 10. Validation

- [x] 10.1 `bun run ci` passes (verify: command exits zero)
- [x] 10.2 `openspec validate kickoff-brief --strict` passes and `bun run spec:lint` reports no duplicate or dangling IDs (verify: both commands exit zero)
