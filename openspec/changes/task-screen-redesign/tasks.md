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

- [x] 1.1 Collapse the header to one row: title, state as a sentence, the surface's own
      repository line, and a labelled stream indicator at the far end. Verify:
      `bun run --cwd apps/web test src/components/task-header.test.tsx` and
      `src/lib/task-state.test.ts` — one row on every surface, and the sentence names what the
      task needs.
- [x] 1.2 Add the navigation column (Thread / Files n / Docs n / Guide, the last listed and marked
      unavailable), marking the current surface and becoming a row below `62rem`. Verify:
      `bun run --cwd apps/web test src/components/task-nav.test.tsx`.
- [x] 1.3 Route the surfaces: `/tasks/:id`, `/tasks/:id/files`, `/tasks/:id/docs`, with
      `/tasks/:id/artifacts` and `/tasks/:id/diff` redirecting and
      `/tasks/:id/artifacts/:artifactId` still opening one document — AC-961, AC-957. Verify:
      `bun run --cwd apps/web test src/screens/task-routes.test.tsx`.
- [x] 1.4 Move `artifacts-screen.tsx` and `files-changed-screen.tsx` under the shell, dropping
      their own headers and back-links; the diff keeps today's rendering (proposal Non-goals).
      Verify: open both tabs; neither draws a second header and neither restates the repository
      line.
- [x] 1.5 Delete the rail's artifact list and its `files changed →` link (`task-rail.tsx`); the
      counts live on the tabs and nowhere else — REQ-920's one-place rule. Verify:
      `grep -n "files changed" apps/web/src` returns nothing.

## 2. The thread (REQ-919, REQ-912)

- [x] 2.1 Reduce `buildThread` to the admission rule: questions, answers, comments, guide replies,
      gate outcomes. Chapters, stage lifecycle entries and activity leave. Verify:
      `bun run --cwd apps/web test src/lib/task-thread.test.ts` — a task with three stages and one
      comment yields one entry.
- [x] 2.2 Render an answered question as at most two clamped lines with a control that opens the
      whole exchange, carrying none of an open question's presentation — AC-958, AC-923. Verify:
      `bun run --cwd apps/web test src/components/thread-view.test.tsx`.
- [x] 2.3 Make the column one scrolling region: the action zone's own `22vh / 62vh / 34vh`
      container goes, and an open question sits directly above the input inside the same scroll —
      REQ-919. Verify: at 720px viewport height with a question open, nothing on the screen
      scrolls inside anything else.
- [x] 2.4 Keep the thread pinned to its newest entry unless the owner has scrolled up — AC-953.
      Verify: scroll into history and post a comment; the view stays where it was.

## 3. The rail and the run log (REQ-914, REQ-915)

- [x] 3.1 Add the fourth node state to `buildPipelineNodes`: stopped, carrying its facts and the
      reason (attempt cap, orphaned run, exhausted budget) — AC-966. Verify:
      `bun run --cwd apps/web test src/lib/task-pipeline.test.ts`.
- [x] 3.2 Fold nodes that have not run into one line naming how many. Verify: a task at its
      kickoff gate shows three nodes and one folded line, not twelve rows.
- [x] 3.3 Add the run log as a layer over the column: per-run duration, cost, tokens, model and
      commit in its header, the run's activity beneath it, and `Comment on this run` — AC-967,
      AC-940, AC-938. Verify: `bun run --cwd apps/web test src/components/run-log.test.tsx`.
- [x] 3.4 Stop rendering `stage.activity` in the thread; it is the run log's alone — AC-940,
      AC-959. Verify: `bun run --cwd apps/web test src/lib/task-thread.test.ts`.

## 4. The console (REQ-921, REQ-906, REQ-914)

- [x] 4.1 Derive the destination from the task's state and render it as a sentence under the one
      input — AC-962. Verify: `bun run --cwd apps/web test src/lib/task-console.test.ts` covering
      all six states plus the no-destination case.
- [x] 4.2 Delete `ComposerMode` and the stage select from `task-composer.tsx`; `Ask guide` leaves
      the console and the guide stays reachable from a question's `Discuss`. Verify:
      `grep -rn "ComposerMode\|whole task" apps/web/src` returns nothing.
- [x] 4.3 Label the input by the open question, show that question directly above the input, and
      leave the rest as one line each to move between — AC-964. Verify:
      `bun run --cwd apps/web test src/components/decision-stack.test.tsx`.
- [x] 4.4 Disable the input where the state has no destination, state why, and offer raising the
      cap — AC-965. Verify: a task paused on an exhausted budget accepts no text.
- [x] 4.5 Keep the gate's own verbs beside the input at a gate, and the restart's guidance field
      at a stopped node — REQ-905, REQ-914. Verify: open a task at each state; the verbs are the
      state's own.

## 5. The writer (task-surface REQ-1008, agent-contracts REQ-102)

- [x] 5.1 Teach the feedback endpoint to resolve the addressed node from the task's state and
      store guidance targeted at it, falling back to commentary when there is none — AC-1046.
      Verify: `bun test apps/api/test/app.test.ts`.
- [x] 5.2 Emit an event for both kinds so the text appears in the thread it was typed into —
      AC-963. Verify: same command; the timeline carries the comment either way.
- [x] 5.3 Clear `consumedByStageId` in the transaction that records a stage ending anything but
      accepted — AC-129. Verify: `bun test apps/orchestrator/test/engine.test.ts` — guidance
      written before a failing attempt is rendered into the retry's ledger.
- [x] 5.4 Cover the ledger side: an intervention claimed by a stage that failed is pending again,
      and one carried by an accepted run is not. Verify:
      `bun test packages/runner/test/ledger.test.ts`.

## 6. The phone (REQ-911)

- [x] 6.1 Keep the surface navigation at every width, collapse the rail into one disclosure, and
      open the run log as a full-height layer with its own way back — AC-968. Verify: 420px-wide
      screenshots of a running task and of an open run log.

## 7. Gate

- [x] 7.1 `bun run check && bun run typecheck && bun run --cwd apps/web test` clean.
- [x] 7.2 `bun run ci` — the database-backed suites need a Postgres with connections to spare;
      run before merging.
- [ ] 7.3 Walk a live task through the six console states and confirm each destination line
      matches where the text actually went. Two of the six are checked in a browser against a
      seeded task (a question open, and a gate); the other four are covered by
      `task-console.test.ts` only.

## 8. Pass 3b — closing the gap to the drawing

The first build of pass 3 landed the routes and the rules but drew a different screen: a nav
column beside the app's own task list, a question as a card above a separate input, and a
running stage reported in three places at once.

- [x] 8.1 Turn the surface navigation into a row under the header and give the repository
      context its trailing end — REQ-920. Verify: `bun run --cwd apps/web test` covers the row's
      links and counts; `surfaceContext` covers AC-960.
- [x] 8.2 Make the open question the console's own head, with the other open questions as a
      pager and its options as direct actions above the input — REQ-912, AC-964. Verify:
      `task-composer.test.tsx`.
- [x] 8.3 Give the console the six states the drawing has: a tone, a destination line above or a
      hint below, a verb of its own on the primary button, and the state's quiet ways out —
      REQ-921. Verify: `task-console.test.ts`.
- [x] 8.4 Move the running stage's activity and its `Stop` under the running node in the rail,
      and the cleanup state under the node it happened to — REQ-914, AC-931.
- [x] 8.5 Reduce the rail to the pipeline and the spend, with each node carrying its duration and
      commit; move the harness gap, the plan size and the lineage beside the state — REQ-920.
- [x] 8.6 Give the run log the drawing's shape: the run's facts in its header, the role that ran
      it, and each line as time, action, target — REQ-914, REQ-915.
- [x] 8.8 Read the thread as a chat: the side an entry sits on is who spoke, so no column is
      reserved for a name and the owner's own turns carry no label. Only an entry with something
      said gets a balloon; a launch or an approval stays one quiet line. The exact moment leaves
      the screen for the entry's tooltip and an `sr-only` `<time>` — REQ-919. Verify:
      `thread-view.test.tsx`.
- [ ] 8.7 The Files surface still renders the pre-pass-3 list-detail panel. Drawing 4 — tree with
      filter, stacked per-file cards, `Viewed` and `n / N viewed`, hunk expanders, unified/split —
      is the change that amends REQ-916/AC-944 and is not this one.

## 9. Pass 4 — the column is the step

Pass 3 emptied the middle column and filled the rail: a task running for a minute showed one line
of thread, while the node's activity, its stop control and its facts were stacked into a 17rem
column beside it. The rule inverts — **the column is the step the owner is reading**, the rail is
the switch between steps — and the console loses the sentences that were restating what the field
already says.

- [x] 9.1 Scope the thread to one step and give every entry a home: a stage event to its stage's
      node, a named event to the node it names, everything else to the node the task stood on
      (`assignSteps`, `buildStepFeed`) — REQ-919, AC-959, AC-969, AC-990. Verify:
      `bun run --cwd apps/web test src/lib/task-thread.test.ts`.
- [x] 9.2 Render the machine's record and a person's turn in one column — time/action/target lines
      beside balloons — and mark the newest action of a live run as in progress — REQ-915,
      AC-940, AC-941. Verify: `bun run --cwd apps/web test src/components/thread-view.test.tsx`.
- [x] 9.3 Head the thread with the step's own facts (state, duration, model, spend, role, commit)
      and the cleanup notice that used to sit under the rail's row — REQ-914, AC-967. Verify:
      open a running task; the rail row carries the walk, the header carries the facts.
- [x] 9.4 Delete the run-log layer: activating a node switches the thread instead of opening over
      it, on the phone too — REQ-914, REQ-911, AC-968. Verify: `grep -rn "run-log" apps/web/src`
      returns nothing.
- [x] 9.5 Move Stop into the console's control row beside Send, on the field's own surface, and
      delete the strip outside it — REQ-921, REQ-914, AC-931, AC-991. Verify:
      `bun run --cwd apps/web test src/components/task-composer.test.tsx`.
- [x] 9.6 Drop `ConsoleDestination.line` and the `⌘↵` hint; the placeholder names the destination
      and only a state that qualifies it keeps a line above the field — REQ-921, AC-962. Verify:
      `bun run --cwd apps/web test src/lib/task-console.test.ts`.
- [x] 9.7 Restore the kickoff brief at its gate: pass 3 dropped the call site and left an Approve
      button with nothing to read — REQ-913, AC-926. Verify: open a task parked at its kickoff
      gate; the brief renders in the gate's own chapter above the console.
- [x] 9.8 Pin a comment by reading the step it is about: an older step the owner opened takes the
      input as a note on that run, while any state that is asking something keeps it — REQ-906,
      AC-912. Verify: `bun run --cwd apps/web test src/lib/task-console.test.ts`.
- [x] 9.9 End a step with the documents its runs wrote, rendered in place, and let a gate show
      the documents of the step it judges — REQ-919, REQ-907, REQ-913, AC-989. Verify:
      `bun run --cwd apps/web test src/lib/task-documents.test.ts`.
- [ ] 9.10 Walk a live task: a running node streaming activity into the thread, a finished node
      opened from the rail, and a gate with its brief. Not yet done against a real task.

## 10. Pass 5 — say each thing once, and only what changed

Pass 4's screen was legible and still said the step's state four times, filled a stopped step's
column with twenty-five lines of `Reading`, and folded seven of the ten pipeline nodes into
`+4 more`. This pass is what the owner asked for after reading a real task on it.

- [x] 10.1 Split activity into what changes and what does not: reads, searches, fetches and plan
      revisions report as one live line that replaces itself and leaves no record; a change keeps
      its line, in the past tense, naming what it changed; an unrecognized tool is treated as a
      change — REQ-915, AC-978, AC-979. Verify:
      `bun run --cwd apps/web test src/lib/task-thread.test.ts`.
- [x] 10.2 Render a target as its path within the repository, not as the sandbox absolute path
      every line would otherwise repeat — AC-980. Verify: same command.
- [x] 10.3 Give the thread a transcript's grammar: `Edited(src/foo.ts)` for a tool use, a sentence
      with a branch beneath it for what happened to the run, the clock off the screen and into the
      entry and an `sr-only` `<time>` — REQ-919. Verify:
      `bun run --cwd apps/web test src/components/thread-view.test.tsx`.
- [x] 10.4 Stop the step's head restating the page header's state where the two are about the same
      node, and name the model with the effort it is bound at — REQ-914, AC-983. Verify:
      `bun run --cwd apps/web test src/components/step-header.test.tsx`.
- [x] 10.5 Stop the console naming the node the step's head has named — REQ-921, AC-985. Verify:
      `bun run --cwd apps/web test src/lib/task-console.test.ts`.
- [x] 10.6 Rebuild the rail: every node in order, the state as a mark, one fact about what it
      cost, no model and no commit, and nodes that have not run shown but not activatable —
      REQ-914, AC-981, AC-982. This reverses 3.2 and retires 0.3's `bindingBaseline` /
      `isBaselineBinding`, which had no caller left once the baseline line went. Verify:
      `bun run --cwd apps/web test src/components/pipeline-rail.test.tsx`.
- [x] 10.7 Make the step's documents a shelf: named, sized, one open at a time, clamped, with the
      whole of it in place and a way to the Docs surface — REQ-907, AC-986. Verify:
      `bun run --cwd apps/web test src/components/step-documents.test.tsx`.
- [x] 10.8 Carry the task's pull request on the task detail endpoint and make the repository line a
      marked link with the pull request beside it — REQ-920, AC-984. Verify:
      `bun test apps/api/test/app.test.ts` and
      `bun run --cwd apps/web test src/components/repo-ref.test.tsx src/lib/repo-link.test.ts`.
- [ ] 10.9 Walk a live task: a running node with the live line replacing itself, a stopped node
      whose column carries only what it changed, and a gate with its documents on the shelf. Not
      yet done against a real task.
- [x] 10.10 Explain each step on the rail, after the pointer rests and at once on focus, drawn
      into the document body so the rail's own scrolling and border cannot crop it — REQ-914,
      AC-987. Verify: `bun run --cwd apps/web test src/components/hover-hint.test.tsx`.
- [x] 10.11 Stop the rail shuffling on selection: a row's geometry is the same selected or not,
      and selecting the row already being read keeps the selection there instead of handing it to
      whichever node the task stands on — REQ-914, AC-988. Verify: pin an earlier step, click its
      row again; the selection stays on it.

## 11. Permanent task deletion (REQ-1800, REQ-1023)

- [x] 11.1 Add `DELETE /tasks/:id`: accept only archived and cancelled tasks, release the
      workspace before deleting, return a structured conflict for active or failed tasks, and
      leave the task intact when release fails — AC-1081, AC-1082, AC-1083. Verify:
      `bun test apps/api/test/app.test.ts`.
- [x] 11.2 Cover the existing task cascade through the endpoint: stages, run graphs, iterations,
      decisions, artifacts, pull requests, feedback, events, conversations, messages and actions
      disappear; the task leaves the list and detail returns not found — REQ-310, AC-1084.
      Verify: `bun test apps/api/test/app.test.ts` and inspect that no schema migration was added
      for this section.
- [x] 11.3 Add the typed API client mutation and settle its task-list, attention, and task-detail
      cache entries after success without issuing a second delete request. Verify:
      `bun run --cwd apps/web test src/lib/api-client.test.ts`.
- [x] 11.4 Reshape a task-navigation row into a navigation link with a sibling overflow trigger;
      keep the trigger reachable by keyboard and touch, show permanent deletion only for archived
      and cancelled rows, and place it last after a separator — AC-1805, AC-1806. Verify:
      `bun run --cwd apps/web test src/components/task-navigation.test.tsx`.
- [ ] 11.5 Add the confirmation: name the SpecMate data removed and the repository history kept,
      require the exact task title, expose pending and failure states, remove the successful row,
      and return to the inbox when the deleted task is open — AC-1807, AC-1808. Verify:
      `bun run --cwd apps/web test src/components/task-navigation.test.tsx` and a 420px browser
      check of the task index and confirmation.
- [ ] 11.6 Run the change gate after implementation. Verify:
      `bun scripts/lint-spec-ids.ts && bunx openspec validate task-screen-redesign --strict && bun run check && bun run typecheck && bun run test`.
