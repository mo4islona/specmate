## 1. The declaration carries the name of the work

- [x] 1.1 Add `title` (non-empty, ≤120) and `type` (`TaskType`) to `PlanShape` in `packages/core/src/plan.ts`; keep `size` and `prerequisites` as they are.
- [x] 1.2 A declaration missing the title or the type fails the attempt naming the missing part, exactly as a missing size does (kickoff-brief AC-1321) — carried by the schema itself (`plan.title` is named in the parse error), so `checkPlanPresent` needed no second check.
- [x] 1.3 Unit test in `packages/core/test/result.test.ts`: a planner result carrying `size` but no `title` is rejected naming `title`; a complete declaration parses.

## 2. Persistence

- [x] 2.1 Make `tasks.base_branch` nullable in `packages/db/src/schema.ts` — null means "the repository's default, not yet resolved" — and drop the `'main'` column default.
- [x] 2.2 Generate the migration with `bun run db:generate`; verify against a live database that existing rows keep their branch and a new row accepts null (persistence AC-344).
- [x] 2.3 Add the default-repository setting to the `app_settings` accessors beside the model defaults, reading back absent when never set.

## 3. Intake resolves the repository

- [x] 3.1 Add `resolveRepository(input, knownRepos, defaultRepo)` in `apps/api/src/app.ts` (or a module beside it) implementing the fixed order from design.md — explicit field, URL in the request text, unambiguous known-repo name, default setting — comparing with `normalizeRemote` from `@specmate/workspace` and matching the remote's last path segment as a whole word (task-surface AC-1047, AC-1048).
- [x] 3.2 Return a distinguishable "unresolved" outcome carrying the candidate list, and reject the create request naming `repoUrl` with the candidates on the error body; two matches reject rather than choose (AC-1049, AC-1050).
- [x] 3.3 Extend the validation error envelope and `ApiRequestError` in `apps/web/src/lib/api-client.ts` with the optional candidate list, leaving every other rejection shape unchanged (operator-ui AC-906).
- [x] 3.4 Loosen `CreateTask` in `apps/api/src/app.ts`: `description` required (keeping the 20,000-byte cap), `title`, `type`, `repoUrl` and `baseBranch` optional; derive the title from the request's first line when absent and the slug from it as today (AC-1001, AC-1002, AC-1056).
- [x] 3.5 Pass an absent base branch through `createTask` in `apps/orchestrator/src/store.ts` as null rather than defaulting to `main`.
- [x] 3.6 Extend the existing `GET /repositories` — which already lists the repositories tasks name — with the last-used ordering, the default marked, and the default itself even when nothing has run against it (AC-1051, AC-1053, AC-1055). A second endpoint would have been a second answer to one question.
- [x] 3.7 Add the default-repository read and update endpoints beside the model-defaults ones, rejecting a value that is not a well-formed repository URL (AC-1052, AC-1054).
- [x] 3.8 API tests in `apps/api/test/app.test.ts` covering AC-1001, AC-1002, AC-1056 through AC-1055 — including that a rejected intake creates no task and no event.

## 4. Planning renames the task

- [x] 4.1 Apply the declared title and type in `recordPlanOutcome` in `apps/orchestrator/src/store.ts`, in the same transaction that records the size, and emit a `task.renamed` event carrying both (kickoff-brief AC-1316, AC-1320).
- [x] 4.2 Assert in `apps/orchestrator/test/store.test.ts` that the slug is untouched by the rename and that the event lands on the task's stream (persistence AC-343).
- [x] 4.3 Update `roles/planner.md`: the `plan` block gains `title` and `type`, with one line each on what they are for — the title names the work now that the repository has been read, the type is a label.
- [x] 4.4 Check the planner prompt's example result against the parser (`bun test packages/core`) so the shipped example cannot be the shape that fails the attempt.

## 5. The base branch resolves at provisioning

- [x] 5.1 Add default-branch resolution to `packages/workspace/src/mirror.ts`: read the mirror's `origin/HEAD`, and raise a named error when the remote reports none (workspace-lifecycle AC-738).
- [x] 5.2 In `packages/workspace/src/manager.ts`, use the resolved default when the provisioning request carries no base branch, and return the branch actually used to the caller.
- [x] 5.3 In `apps/orchestrator/src/engine.ts` (and `index.ts` where the provisioning request is built), persist the resolved branch onto the task the first time it is provisioned, so `publish.ts` and the diff view keep reading a concrete branch (AC-737).
- [x] 5.4 Confirm the workspace-service consistency check (`service.ts`) tolerates a task whose stored branch was null at request time and concrete afterwards.
- [x] 5.5 Workspace tests: a task with no base branch against a repository defaulting to `master` is cut from `master` and reports it; a remote with no default fails naming the repository.

## 6. The launch screen

- [x] 6.1 Rewrite `apps/web/src/screens/new-task-screen.tsx` around one request textarea and the launch action; move the base branch and the per-role model overrides into a single collapsed `Advanced` disclosure; delete the title and type fields and the stale "The task starts in draft" note (operator-ui AC-971).
- [x] 6.2 Render the repository choice from a rejection's candidates beside the preserved request, with resubmission carrying the chosen repository (AC-972).
- [x] 6.3 Update `apps/web/src/screens/new-task-screen.test.tsx` for the new shape, keeping the existing coverage of AC-905, AC-906, AC-925 and AC-948.
- [x] 6.4 Add the default-repository section to `apps/web/src/screens/settings-screen.tsx`, including the fresh-install state that still lets the owner name one (AC-973, AC-974).
- [x] 6.5 Make the task view show the repository the task resolved to where it is visible on arrival, so an inferred repository is checkable before planning finishes — the header already carried it; it now reads the unpinned base branch as the repository's default, and the timeline names the rename.

## 7. Close-out

- [x] 7.1 `apps/orchestrator/src/admin.ts` `create` still works with an explicit title and type, and no longer requires a base branch — `--base` was already optional, and the created row now carries a null branch. Verified by running it against a scratch database.
- [x] 7.2 Run `bun run ci` (check, typecheck, test, spec validate, spec lint) and fix what it names.
- [ ] 7.3 Launch a task against a real repository from the rewritten screen with a request naming no repository, confirm the candidate choice appears, and confirm the task is renamed once planning declares its title.
