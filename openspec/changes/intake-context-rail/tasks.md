## 1. The spec suite makes room

- [x] 1.1 Let a capability hold more than one band in `openspec/id-bands.yaml` (`name: [900, 1900]`), and allocate from the newest block only. Verify: `bun run spec:next-id` reports `launch-screen` allocating from its 1900 block and `operator-ui` still allocating from what is left of 900.
- [x] 1.2 Move REQ-903 and its scenarios out of `openspec/specs/operator-ui/spec.md` into a new `openspec/specs/launch-screen/spec.md`, text unchanged, and point each capability's Purpose at the other. Verify: `git diff` shows no changed requirement or scenario text.
- [x] 1.3 Split `openspec/changes/single-field-intake/specs/operator-ui/spec.md` along the same line — MODIFIED REQ-903 to `specs/launch-screen/`, ADDED REQ-922 stays. Verify: `bun scripts/lint-spec-ids.ts` passes with no `MODIFIED targets unknown requirement` error.
- [x] 1.4 Lift the band rules out of the lint into `scripts/spec-bands.ts` and cover them: an ID in a capability's older block is accepted, one in no block of that capability is not, and allocation comes from the newest block even when an older one has room. Verify: `bun run vitest run scripts`.

## 2. The GitHub credential becomes readable by both services

- [x] 2.1 Create `packages/github` and move `apps/orchestrator/src/github-auth.ts` into it whole — `githubToken`, `saveGitHubAuth`, `githubLogin`, `GitHubLoginRequiredError` — updating the orchestrator's two import sites. Verify: `bun run typecheck`, and `bun test apps/orchestrator` still passes.
- [x] 2.2 Depend on it from `apps/api/package.json` and pass `GITHUB_APP_CLIENT_ID` through `apps/api/src/config.ts` as an optional variable. Verify: the API's own suites boot `loadConfig` with the variable unset (service-topology AC-513).
- [ ] 2.3 Assert that two callers refreshing one expired token concurrently redeem the refresh token once. Needs a database, so it belongs beside the other `bun test` suites rather than in `packages/github/test`, which runs on vitest. Not written.

## 3. The preview read

- [x] 3.1 Add `POST /intake/preview` in `apps/api/src/app.ts`, calling the same `resolveRepository` that `POST /tasks` calls, and returning the repository, the rule that resolved it, and the candidates in the shape a rejection already carries (task-surface AC-1062, AC-1063). `resolveRepository` gained `via` for the rule; intake itself ignores it.
- [x] 3.2 Add the reference parser as `packages/github/src/references.ts` — `owner/repo#123`, an issue or pull URL on either host — returning every reference the text names, unfetched, each marked as written or guessed. Verify: `packages/github/test/references.test.ts`.
- [x] 3.3 Pin that the preview writes nothing: call it repeatedly, then assert the task and event tables are untouched (AC-1064).
- [x] 3.4 Pin agreement: one test feeding identical text to the preview and to `POST /tasks` and asserting the same repository (AC-1065).

## 4. The repository read

- [x] 4.1 Add `GET /repositories/:id` returning what `GET /repositories` carries for that one row, plus the spec convention setting in force, the coverage waiver, and the most recent tasks against it (AC-1066).
- [x] 4.2 Carry a bounded, most-recent-first excerpt of what the repository remembers, with the total alongside it. The store's read side lands as `packages/workspace/src/memory.ts` under the names `repo-memory` gives it, so that change's fuller module supersedes this file whole.
- [x] 4.3 Answer a repository with nothing else to say with empty sections, and an identity naming nothing with a structured error (AC-1067, AC-1068).
- [x] 4.4 Carry the convention a real checkout resolved on the most recent task beside the owner's setting, so the screen shows what actually governed a run rather than only what was asked for (AC-1074).

## 4a. What governs a repository with no history here

- [x] 4a.1 Add `probeRepository` to `packages/github`: the default branch, and which of a given set of paths the tree holds — a lookup per path on the contents endpoint, no clone, no model. A lookup that could not be performed is not the answer "absent" (AC-1077).
- [x] 4a.2 Add `GET /repositories/probe?repoUrl=…`, registered before `/repositories/:id` so the static segment wins, addressed by the remote because a repository with no history has no id. Compose the probed tree with `resolveSpecConvention` from `@specmate/core` — the same function provisioning calls (AC-1075, AC-1076).
- [x] 4a.3 Degrade like the reference read: no credential, an unreadable host, a repository the credential cannot see all answer with a reason and a 200 (AC-1077, AC-1078).
- [x] 4a.4 Cache per repository for a window, sharing the in-flight promise. Verify: `packages/github/test/repository.test.ts`.
- [x] 4a.5 Show it in the rail's Specification section for an unseen repository, saying where the answer came from, and put the probed default branch in the History line.

## 5. The GitHub reference read

- [x] 5.1 Add the issue/pull read to `packages/github`, addressed by host, owner, repository and number only, refusing any host it does not read before any request leaves the process (AC-1073).
- [x] 5.2 Expose it on the API and map every failure — no credential, expired, not found, not visible, rate limited — onto "unreadable, with a reason", never onto an error status (AC-1070, AC-1071).
- [x] 5.3 Cache per reference for a short window, sharing the in-flight promise so a burst collapses onto one request, and pin that a second read inside the window makes none (AC-1072).
- [ ] 5.4 Read one real issue against the live credential once, by hand, and check the shape against the fixture. Not done — the tests run against a fake `fetch`, so the field names are asserted from GitHub's documented schema rather than from a live response.

## 6. The rail

- [x] 6.1 Add the preview, repository and reference reads to `apps/web/src/lib/api-client.ts` and `query-keys.ts`, keyed so that editing the request re-fetches the preview but not the repository or the issue.
- [x] 6.2 Build the rail in `apps/web/src/components/intake-rail.tsx` from the kit, adding `Skeleton` and `Reveal` to `src/ui` and to `/kit`. Verify: `ui/kit-discipline.test.ts` passes.
- [x] 6.3 Give the launch screen its second column: the rail beside the composer on wide viewports, below it on narrow ones, and second in the source so the request is reached first (operator-ui REQ-911).
- [x] 6.4 Debounce the preview on the request text; the query key is the settled text, and React Query aborts the superseded request through the signal it hands the fetcher.
- [x] 6.5 Render the candidate choice in the rail, writing the chosen repository into the same form field the rejection path fills, shown as chosen and releasable (AC-1901, AC-1902).
- [x] 6.6 Link every fact to where it is read in full or changed — the repository and the issue out to the host, a task to its view, the convention to Settings (AC-1906).
- [x] 6.7 Tests in `apps/web/src/components/intake-rail.test.tsx` covering AC-1900 through AC-1906 and AC-1911, with the reads mocked at the module boundary (`vi.mock`).

## 7. The rail settles, and does not jump

- [x] 7.1 Render the rail's slots before there is anything in them, and show the default repository rather than a placeholder when the request is empty and a default is set (AC-1907, AC-1908).
- [x] 7.2 Keep the previous answer on screen while a newer one is in flight, marked as refreshing, rather than clearing it (AC-1909).
- [x] 7.3 Settle new content with a transition in the components layer; the reduced-motion rule already in `index.css` removes it.
- [x] 7.4 Pin that an arriving answer moves neither the focus nor the caret (AC-1910), in `apps/web/src/screens/new-task-screen.test.tsx`.

## 8. Deployment

- [x] 8.1 Pass `GITHUB_APP_CLIENT_ID` to the `api` service in `docker-compose.yml`, alongside the orchestrator's. Verify: `docker compose config` shows it on both.
- [ ] 8.2 Note in the deployment runbook that the credential `github-login` already stores is now read by the API too, and that enrichment is the only thing that degrades without it. The runbook is not in this repository.
