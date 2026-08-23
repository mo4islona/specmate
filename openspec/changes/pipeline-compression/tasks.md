Design decisions are referenced as D1–D5 and requirements by ID; neither is restated here.

## 0. The one thing that can change the plan

- [ ] 0.1 **Deferred by the owner, not done.** The check was to confirm the pinned provider CLI
      can start from an existing session without writing into it (D3's fork). Half of it is
      answered on paper: `--fork-session` exists and is documented as "when resuming, create a new
      session ID". What stays unverified is whether it holds under `-p` with `stream-json`, and
      whether a second container run resolves a session the first one wrote — the store is keyed
      by working directory, so a path mismatch hides a session the volume still holds. Implemented
      on the assumption that it works, with AC-235's cold fallback carrying the failure: if the
      resume is rejected the stage runs from artifacts and says so, rather than failing.

## 1. Storage

- [x] 1.1 Additive status-enum migration adding `specify` and `validate`, dropping nothing —
      REQ-405, D1. Verify: `bun run db:generate` produces an additive diff, and a task row holding
      `research` still reads back after `bun run db:migrate`.
- [x] 1.2 Give the stage row its provider session identifier — REQ-214. Verify:
      `bun test packages/db`.

## 2. The graph's new vocabulary

- [x] 2.1 Add the conditional node: a predicate id and threshold on a stage node, a registry of
      predicates each declaring the facts it reads, and the fact bundle the engine assembles —
      REQ-409, D2. Verify: `bun test packages/core/test/pipeline.test.ts`.
- [x] 2.2 Reject a predicate reading an output of the node it guards, or of a node that checks
      that node — AC-423. Verify: same command; a fixture catalog with a circular predicate fails
      to load naming the node.
- [x] 2.3 Add `resumes` to a stage node, rejecting a target that is later, absent, or of another
      role — REQ-410, AC-424. Verify: same command.
- [x] 2.4 Extend the reduction check so a profile may not drop a node another node resumes —
      AC-426. Verify: same command.

## 3. The role catalog

- [x] 3.1 Add the merged validating role: writes harness code and its reports, denied product
      code, `injectSpecSkill` on, corroborated — REQ-111, AC-130. Verify:
      `bun test packages/core/test/roles.test.ts`.
- [x] 3.2 Bind every checking node across providers and assert no checking node is default-bound —
      REQ-106, AC-135. Verify: same command; this is the live defect where the implementer's and
      the verifier's defaults coincide.
- [x] 3.3 Leave `researcher` in the catalog with nothing scheduling it, as `spec_writer` and
      `retro` already are. Verify: nothing to run — this task is a decision recorded, and the
      proposal's Non-goals says why.

## 4. The definition

- [x] 4.1 Rewrite the feature/bugfix definition to the ten-node shape: `planning`, kickoff gate,
      `specify` resuming `planning`, `spec_review` conditional, spec gate, `implement`, `validate`,
      `summarize`, final gate, `publish` — REQ-405, REQ-602, D1. Verify:
      `bun test packages/core/test/pipeline.test.ts` — the definition loads and every node reaches
      the terminal.
- [x] 4.2 Reduce profiles to `full` and `compact`, and give each size its caps — REQ-408, REQ-606,
      D4. Verify: same command, plus a test asserting no two sizes select the same profile under
      the same caps (AC-428).
- [x] 4.3 Record the declared size's caps on the task when the profile is applied — AC-427,
      AC-641. Verify: `bun test apps/orchestrator/test/engine.test.ts`.

## 5. The runner

- [x] 5.1 Parse the provider session identifier from the output stream and return it with the
      outcome — REQ-214, AC-232. Nothing reads it today. Verify:
      `bun test packages/runner/test/claude.test.ts`.
- [x] 5.2 Pass a base session on the invocation when the job carries one, forking rather than
      continuing in place — D3. Verify: same command.
- [x] 5.3 Fall back to a cold run when the session cannot be continued, recording that it did and
      why, and accepting the stage on its own terms — AC-235. Verify: same command with a stub
      provider that rejects the resume.
- [x] 5.4 A retry forks the resumed node's session as that node left it, carrying none of the
      failed attempt's turns — AC-236. Verify: `bun test apps/orchestrator/test/engine.test.ts`.

## 6. The engine

- [x] 6.1 Evaluate a conditional node on arrival: run it when the predicate holds, otherwise
      advance to its forward target and record the skip with the predicate's reason — AC-421.
      Verify: `bun test apps/orchestrator/test/engine.test.ts`.
- [x] 6.2 Dispatch a resuming stage with its base session identifier read from the resumed stage
      row — AC-233. Verify: same command.
- [x] 6.3 A restart between a node and the node resuming it still resumes after the gate is
      answered — AC-234. Verify: same command, driving a restart mid-gate.
- [x] 6.4 Corroborate the merged role's execution claims only, letting a `revise` over a passing
      harness stand — REQ-1103, AC-1113. Verify: `bun test packages/runner/test/corroboration.test.ts`.

## 7. The prompts

- [x] 7.1 Fold the brief and the specification instructions into `roles/planner.md` as two phases
      of one run plus a resumed continuation, keeping the five required headings the mechanical
      check reads — REQ-1303, AC-1322. Verify:
      `bun test packages/core/test/brief.test.ts`, and a brief written by the merged run passes
      `checkBrief`.
- [x] 7.2 Merge `roles/verifier.md` and `roles/reviewer.md` into the validating role's prompt,
      naming the two lenses separately and stating that a passing harness is not itself a ground
      for approve — AC-132, D5. Verify: inspect the prompt; both obligations appear, and the
      insufficiency is stated rather than implied.
- [x] 7.3 Instruct the validating role to demonstrate a demonstrable finding with a failing
      assertion — AC-1112. Verify: inspect the prompt.

## 8. The surface

- [x] 8.1 Render a skipped node in the rail with its reason where a node that ran shows its
      duration — AC-422. Verify: `bun run --cwd apps/web test src/lib/task-pipeline.test.ts` and
      `src/components/pipeline-rail.test.tsx`.

## 9. Gate

- [x] 9.1 `bun run check && bun run typecheck && bun run --cwd apps/web test` clean.
- [ ] 9.1b The database-backed suites pass per file; run in one process they collide on a shared
      Postgres, which is the flakiness 9.2 already names rather than anything this change caused.
- [ ] 9.2 `bun run ci` — the database-backed suites need a Postgres with connections to spare.
- [ ] 9.3 Walk one real task of each declared size end to end and confirm: the caps recorded match
      the size, `spec_review` is skipped with a stated reason where the spec is small, `validate`
      runs under a provider other than the implementer's, and `specify` continued `planning`'s
      session rather than reading the repository again.
- [ ] 9.4 Confirm a task created before the deploy finishes on its pinned graph. Verify: leave one
      task mid-flight across the deploy and watch it reach its terminal on the old node set.
