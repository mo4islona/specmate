The first pass shipped on this branch and is the starting point, not a rollback: `task-thread.ts`,
`task-pipeline.ts`, `repo-link.ts`, `commit-ref.tsx`, `pipeline-rail.tsx` and the vitest setup are
kept and reshaped. Only what pass 3 changes is listed here.

## 0. Already satisfied by the first pass

- [x] 0.1 Commits render short, linked, with the full hash carried (`repo-link.ts`,
      `commit-ref.tsx`) — AC-955. Verify: `bun run --cwd apps/web test src/lib/repo-link.test.ts`.
- [x] 0.2 A run is numbered only where its node ran more than once — AC-954. Verify: a task with
      one attempt per node shows no run numbers anywhere on the screen.
- [x] 0.3 The rail states the task's baseline model binding once and marks only departures
      (`bindingBaseline`) — AC-948 stays satisfied. Verify:
      `bun run --cwd apps/web test src/lib/task-pipeline.test.ts`.
- [x] 0.4 `apps/web` runs on vitest + jsdom + testing-library; the root `test` script runs both
      suites. Verify: `bun run test`.

## 1. The shell (REQ-920, REQ-901, REQ-907)

- [ ] 1.1 Collapse the header to one row: title, state as a sentence, the surface's own
      repository line, and a labelled stream indicator at the far end. Verify:
      `bun run --cwd apps/web test src/components/task-header.test.tsx` — the header renders one
      row on every surface and the state sentence names what the task needs.
- [ ] 1.2 Add the navigation column (Thread / Files n / Docs n / Guide, the last listed and marked
      unavailable), marking the current surface and becoming a row below `62rem`. Verify:
      `bun run --cwd apps/web test src/components/task-nav.test.tsx`.
- [ ] 1.3 Route the surfaces: `/tasks/:id`, `/tasks/:id/files`, `/tasks/:id/docs`, with
      `/tasks/:id/artifacts` and `/tasks/:id/diff` redirecting and
      `/tasks/:id/artifacts/:artifactId` still opening one document — AC-961, AC-957. Verify:
      `bun run --cwd apps/web test src/screens/task-routes.test.tsx`.
- [ ] 1.4 Move `artifacts-screen.tsx` and `files-changed-screen.tsx` under the shell, dropping
      their own headers and back-links; the diff keeps today's rendering (proposal Non-goals).
      Verify: open both tabs; neither draws a second header and neither restates the repository
      line.
- [ ] 1.5 Delete the rail's artifact list and its `files changed →` link (`task-rail.tsx`); the
      counts live on the tabs and nowhere else — REQ-920's one-place rule. Verify:
      `grep -n "files changed" apps/web/src` returns nothing.

## 2. The thread (REQ-919, REQ-912)

- [ ] 2.1 Reduce `buildThread` to the admission rule: questions, answers, comments, guide replies,
      gate outcomes. Chapters, stage lifecycle entries and activity leave. Verify:
      `bun run --cwd apps/web test src/lib/task-thread.test.ts` — a task with three stages and one
      comment yields one entry.
- [ ] 2.2 Render an answered question as at most two clamped lines with a control that opens the
      whole exchange, carrying none of an open question's presentation — AC-958, AC-923. Verify:
      `bun run --cwd apps/web test src/components/thread-view.test.tsx`.
- [ ] 2.3 Make the column one scrolling region: the action zone's own `22vh / 62vh / 34vh`
      container goes, and an open question sits directly above the input inside the same scroll —
      REQ-919. Verify: at 720px viewport height with a question open, nothing on the screen
      scrolls inside anything else.
- [ ] 2.4 Keep the thread pinned to its newest entry unless the owner has scrolled up — AC-953.
      Verify: scroll into history and post a comment; the view stays where it was.

## 3. The rail and the run log (REQ-914, REQ-915)

- [ ] 3.1 Add the fourth node state to `buildPipelineNodes`: stopped, carrying its facts and the
      reason (attempt cap, orphaned run, exhausted budget) — AC-966. Verify:
      `bun run --cwd apps/web test src/lib/task-pipeline.test.ts`.
- [ ] 3.2 Fold nodes that have not run into one line naming how many. Verify: a task at its
      kickoff gate shows three nodes and one folded line, not twelve rows.
- [ ] 3.3 Add the run log as a layer over the column: per-run duration, cost, tokens, model and
      commit in its header, the run's activity beneath it, and `Comment on this run` — AC-967,
      AC-940, AC-938. Verify: `bun run --cwd apps/web test src/components/run-log.test.tsx`.
- [ ] 3.4 Stop rendering `stage.activity` in the thread; it is the run log's alone — AC-940,
      AC-959. Verify: `bun run --cwd apps/web test src/lib/task-thread.test.ts`.

## 4. The console (REQ-921, REQ-906, REQ-914)

- [ ] 4.1 Derive the destination from the task's state and render it as a sentence under the one
      input — AC-962. Verify: `bun run --cwd apps/web test src/lib/task-console.test.ts` covering
      all six states plus the no-destination case.
- [ ] 4.2 Delete `ComposerMode` and the stage select from `task-composer.tsx`; `Ask guide` leaves
      the console and the guide stays reachable from a question's `Discuss`. Verify:
      `grep -rn "ComposerMode\|whole task" apps/web/src` returns nothing.
- [ ] 4.3 Label the input by the open question and add the `1 of N` pager over the open set —
      AC-964. Verify: `bun run --cwd apps/web test src/components/decision-stack.test.tsx`.
- [ ] 4.4 Disable the input where the state has no destination, state why, and offer raising the
      cap — AC-965. Verify: a task paused on an exhausted budget accepts no text.
- [ ] 4.5 Keep the gate's own verbs beside the input at a gate, and the restart's guidance field
      at a stopped node — REQ-905, REQ-914. Verify: open a task at each state; the verbs are the
      state's own.

## 5. The writer (task-surface REQ-1008, agent-contracts REQ-102)

- [ ] 5.1 Teach the feedback endpoint to resolve the addressed node from the task's state and
      store guidance targeted at it, falling back to commentary when there is none — AC-1046.
      Verify: `bun test apps/api/test/app.test.ts`.
- [ ] 5.2 Emit an event for both kinds so the text appears in the thread it was typed into —
      AC-963. Verify: same command; the timeline carries the comment either way.
- [ ] 5.3 Clear `consumedByStageId` in the transaction that records a stage ending anything but
      accepted — AC-129. Verify: `bun test apps/orchestrator/test/engine.test.ts` — guidance
      written before a failing attempt is rendered into the retry's ledger.
- [ ] 5.4 Cover the ledger side: an intervention claimed by a stage that failed is pending again,
      and one carried by an accepted run is not. Verify:
      `bun test packages/runner/test/ledger.test.ts`.

## 6. The phone (REQ-911)

- [ ] 6.1 Keep the surface navigation at every width, collapse the rail into one disclosure, and
      open the run log as a full-height layer with its own way back — AC-968. Verify: 420px-wide
      screenshots of a running task and of an open run log.

## 7. Gate

- [ ] 7.1 `bun run check && bun run typecheck && bun run --cwd apps/web test` clean.
- [ ] 7.2 `bun run ci` — the database-backed suites need a Postgres with connections to spare;
      run before merging.
- [ ] 7.3 Walk a live task through the six console states and confirm each destination line
      matches where the text actually went.
