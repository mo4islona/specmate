# Tasks

## 1. Name a failure to start for what it is

- [x] 1.1 Have the exec result say whether the process that exited was the provider or a client
      that never reached it (`packages/runner/src/backend.ts`, `docker-backend.ts`,
      `local-backend.ts`). The docker backend decides it from the client's own exit numbering;
      the in-process backend never reports it. Verify: `bun test packages/runner` asserts a
      client-side start failure and a provider exit are distinguished, and that the in-process
      backend never reports the former.
- [x] 1.2 Add the backend failure to the stage failure vocabulary and raise it from
      `runProviderStage` instead of `provider_error`, carrying what the backend reported
      (`packages/runner/src/provider-run.ts`). Verify: `bun test packages/runner` asserts a
      start failure records the backend reason with the runtime's own message, and that a
      provider exiting non-zero with no result still records `provider_error`.

## 2. The failure vocabulary becomes a table

The properties every later section branches on — did the run produce a result, can re-running it
change the outcome — are recorded nowhere today. `RunFailure`
(`packages/runner/src/provider-run.ts`) and `StageFailure` (`executor.ts`) are bare unions of
identifiers, `ConversationFailure` (`conversation-executor.ts`) is a second copy that has already
drifted from both, and the UI renders whichever identifier arrives through `humanize`. Nothing
says a scope violation and a timeout are different kinds of thing, which is why the code treats
them alike.

- [x] 2.1 Replace the unions with one table over the vocabulary, each member carrying whether the
      run produced a result and whether re-running it can change the outcome
      (`packages/runner/src/`). The stage and conversation vocabularies are subsets of it, not
      independent lists. Verify: `bun test packages/runner` asserts the table covers every member
      of both vocabularies exhaustively, so a new failure cannot be added without choosing its
      properties, and `bun run typecheck` passes with the unions derived from the table.
- [x] 2.2 Give each member the sentence a human should read instead of its identifier, and render
      that in the thread rather than `humanize(reason)`
      (`apps/web/src/lib/task-thread.ts`). Verify: `bun run --cwd apps/web test` asserts a stage
      failure renders its sentence, including the backend failure added in §1.
- [x] 2.3 Write the working note that keeps the analysis behind the table, in the shape
      `docs/autonomy-gaps.md` established — the class of defect, what it cost per node, and what
      closed it (`docs/stage-failures.md`). Verify: the note names the table as the canonical
      list and states the cost arithmetic of the two caps rather than restating the members.

## 3. Verify the pin, and recover it

- [x] 3.1 Add "does this image reference resolve here" to the backend interface, implemented for
      docker by inspecting it and for the in-process backend as always true
      (`packages/runner/src/backend.ts`, `docker-backend.ts`, `local-backend.ts`). Verify:
      `bun test packages/runner` covers a resolvable reference, an absent one, and a runtime that
      cannot be reached at all.
- [x] 3.2 Check the task's pinned image before dispatching a stage and, when it does not resolve,
      re-pin through `WorkspaceService.repinEnvironment` before the job is built
      (`apps/orchestrator/src/engine.ts`, `run-stage.ts`). Verify: `bun test apps/orchestrator`
      asserts a stage dispatched on an unresolvable pin runs against the new environment and
      records `task.environment_repinned`, and that a resolvable pin is dispatched untouched with
      no event — including when the configured default has since changed (AC-816, AC-817).
- [x] 3.3 Fail the stage naming the unresolvable image, leaving the stored pin as it was, when
      the replacement environment cannot be resolved either. Verify: `bun test apps/orchestrator`
      asserts the task's pin is unchanged and the failure detail names the image (AC-818).

## 4. Stop failing a planner for the folder it was told to write

- [x] 4.1 Take the change name declared by the run's own result into the write-scope check, for a
      role whose contract declares plans (`packages/runner/src/scope.ts`,
      `packages/runner/src/executor.ts`). Verify: `bun test packages/runner` covers a declaring
      role writing under the declared name, the same role writing under neither name, and a
      non-declaring role, which is unaffected (AC-243).
- [x] 4.2 Say in the role file which folder to write into and that the declared name is applied
      by the system after the stage is accepted (`roles/planner.md`). Verify: the role file names
      the provisional folder as the place to write and the declaration as the way to rename it.
- [x] 4.3 Name the change folder in the assembled prompt as an instruction rather than only as a
      heading over an existing artifact (`packages/runner/src/prompt.ts`). Verify:
      `bun test packages/runner` asserts the prompt states the folder path for a role that writes
      artifacts.

## 5. Carry the rejection into the next attempt

- [x] 5.1 Let a failed or declined attempt's reason and detail leave the executor and reach the
      next attempt's prompt assembly (`packages/runner/src/executor.ts`,
      `packages/runner/src/prompt.ts`). Verify: `bun test packages/runner` asserts the second
      attempt's prompt states the first attempt's rejection, and the first attempt's states none
      (AC-248, AC-249).
- [x] 5.2 Carry it across a re-dispatch too, so an attempt the engine dispatches after a failed
      stage row is told the same thing (`apps/orchestrator/src/engine.ts`,
      `packages/runner/src/ledger.ts`). Verify: `bun test apps/orchestrator` asserts a
      re-dispatched attempt's ledger carries the previous stage row's failure reason.

## 6. Keep the sound session when only the packaging was wrong

- [x] 6.1 Continue the declined attempt's own session on the retry — declined being what §2's
      table says produced a result — and fall back to a cold start with a recorded reason where
      the provider will not fork it (`packages/runner/src/executor.ts`, `provider-run.ts`).
      Verify: `bun test packages/runner` asserts a retry after a declined result forks that
      attempt's session, a retry after a failed run does not, and a refused fork degrades to cold
      with the reason recorded (AC-244, AC-245).

## 7. Do not spend the cap on the unfixable

- [x] 7.1 Fail the task immediately, without re-dispatching, when §2's table says re-running
      cannot change the outcome (`apps/orchestrator/src/engine.ts`). Verify:
      `bun test apps/orchestrator` asserts a backend start failure dispatches no second attempt
      and fails the task naming the stage and reason, while a timeout and an unparseable result
      still retry to the cap (AC-645, AC-646).
- [x] 7.2 Stop the runner's own second attempt for the same class, so the two caps agree
      (`packages/runner/src/executor.ts`). Verify: `bun test packages/runner` asserts one
      provider invocation for a backend start failure and two for a timeout.

## 8. Close it out

- [x] 8.1 Run the full suite: `bun run test`, `bun run typecheck`, `bun run lint`.
- [x] 8.2 Run `bun scripts/lint-spec-ids.ts` and confirm no duplicate or dangling ID.
- [x] 8.3 Record in `deploy/RUNBOOK.md` that a runner-image rebuild no longer strands tasks, and
      what the `task.environment_repinned` entry in a task thread means when an owner sees one.
