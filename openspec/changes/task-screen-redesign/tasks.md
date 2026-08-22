## 1. Thread grouping (REQ-918)

- [x] 1.1 Add `apps/web/src/lib/task-thread.ts`: the event vocabulary (titles, tones, the
      silent set), the activity/detail/label helpers moved off the screen, and `buildThread`
      grouping events and conversation messages into per-stage chapters.
      Verify: `bun test apps/web/src/lib/task-thread.test.ts`.
- [x] 1.2 Cover the grouping rules with tests: stage-scoped placement, a mid-run comment
      joining its run, gate work becoming the gate's chapter, re-entry opening a new chapter,
      parking opening the destination's chapter, boundary-stamped entries staying with their
      stage, silent events leaving no entry, and a started stage whose events fell outside the
      event window still getting a chapter. Verify: same command.
- [x] 1.3 Render chapters in `apps/web/src/components/thread-view.tsx`: collapsed by default
      except the newest, `isChapterOpen` as the single rule shared with the screen, per-chapter
      stats, activity capped at the last 8 lines with the dropped count shown, and resolved
      decision cards rendered in place. Verify: open a task in the app and collapse a chapter.

## 2. Pinned rail (REQ-914)

- [x] 2.1 Add `apps/web/src/lib/task-pipeline.ts`: `buildPipelineNodes` (per-node state, runs,
      current node, role, binding), `bindingBaseline`/`isBaselineBinding`, `shortModel`.
      Verify: `bun test apps/web/src/lib/task-pipeline.test.ts`.
- [x] 2.2 Add `apps/web/src/components/pipeline-rail.tsx` and `task-rail.tsx`: the node list
      with live status, node activation revealing runs and commits, artifacts, and the spend
      meters. Verify: click a node in the app; its runs appear and its chapter opens.
- [x] 2.3 Delete `apps/web/src/components/model-bindings-panel.tsx`; the binding now shows on
      the node that departs from the baseline. Verify: `grep -r model-bindings-panel apps/web`
      returns nothing.
- [x] 2.4 Rewrite `budget-panel.tsx` as the rail's spend meters, keeping REQ-1505's
      incomplete-cost wording. Verify: `bun test apps/web/src/components/budget-panel.test.tsx`.

## 3. Commits, attempts, and labels

- [x] 3.1 Add `apps/web/src/lib/repo-link.ts` (`repoLabel`, `commitUrl`, `shortCommit`) and
      `components/commit-ref.tsx`. Verify: `bun test apps/web/src/lib/repo-link.test.ts`.
- [x] 3.2 Number a run only where its node ran more than once — in the rail, the chapter title,
      the run controls, and the composer's stage picker. Verify: a task with one attempt per
      node shows no run numbers anywhere on the screen.

## 4. The zone that needs a person (REQ-912, REQ-914)

- [x] 4.1 Extract `gate-panel.tsx` (approve foremost, redirect/rework behind one disclosure)
      and `run-controls.tsx` (`RunningStrip` with a two-step stop confirmation, `CleanupStrip`,
      `RestartPanel`). Verify: open a task parked at a gate; approve is the only visible action.
- [x] 4.2 Restyle `decision-card.tsx`: options as the direct actions, free text behind a
      disclosure (open when there are no options), dismiss/discuss quiet.
      Verify: `bun test apps/web/src/components/decision-card.test.tsx`.
- [x] 4.3 Order the zone so a decision the task is stopped on precedes the run controls and a
      merely-open one follows them. Verify: inspect a parked task and a running one.

## 5. Screen assembly

- [x] 5.1 Rewrite `apps/web/src/screens/task-screen.tsx` around header → action zone → thread →
      composer, with the rail beside it; extract `task-composer.tsx` and
      `conversation-message.tsx`. Verify: `bun run typecheck`.
- [x] 5.2 Keep the thread pinned to its newest entry unless the owner has scrolled up.
      Verify: scroll into history and post a comment; the view stays where it was.
- [x] 5.3 Cap the action zone (46vh at a gate, 34vh otherwise) so the thread keeps room at
      720px viewport height. Verify: measured 137/256/322px of thread at 720/900/1000px.
- [x] 5.4 Collapse the rail into one disclosure below `xl` and keep the page free of horizontal
      scrolling (REQ-911). Verify: 420px-wide screenshot of a running task.

## 6. Second pass, from the owner reading the deployed screen

- [x] 6.1 Strip the duration, tokens, cost, and commit off chapter headers — the rail states
      them for the same node. Verify: a chapter header's text is the stage name alone
      (`thread-view.test.tsx`).
- [x] 6.2 Render an open decision only where it is answered; keep the card in history once it
      resolves. Verify: `bun run --cwd apps/web test` — "an open decision is not repeated".
- [x] 6.3 Absorb a chapter opened by an event that precedes its node's stage row (`task.created`
      at the entry node) into the run it precedes. Verify: `task-thread.test.ts`.
- [x] 6.4 Stack several open questions: one answerable, the rest one line each
      (`decision-stack.tsx`). Verify: `decision-stack.test.tsx`.
- [x] 6.5 Count `blocked` as parked — it is the status the engine parks a task in when a
      blocking decision is open, and it was excluded. Verify: a blocked task shows "The task is
      stopped on this."
- [x] 6.6 Give the action zone its own bottom edge and most of the column while the task is
      stopped, so a clipped card never reads as the thread's first entry. Verify: a blocked task
      at 940px viewport height.
- [x] 6.7 Open an artifact in the thread's place (`artifact-reader.tsx`), not on its own screen.
      Verify: click a rail artifact; the URL does not change and the rail stays.

## 7. Test runner

- [x] 7.1 Move `apps/web` to vitest + jsdom + testing-library; keep `bun test` everywhere else;
      root `test` script runs both and CI calls `bun run test`.
      Verify: `bun run test` runs 561 bun tests and 100 vitest tests.

## 8. Gate

- [x] 6.1 `bun run check && bun run typecheck && bun test apps/web` all clean.
- [ ] 6.2 `bun run ci` — the database-backed suites (`packages/db`, `apps/api`,
      `apps/orchestrator`) need a running Postgres; run before merging.
