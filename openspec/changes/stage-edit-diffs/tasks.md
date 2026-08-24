# Tasks

## 1. Capture the edit in the runner

- [x] 1.1 Extend `StageActivity` (`packages/core/src/provider.ts`) with the optional edit: repo-relative
      `path`, `additions`, `deletions`, `preview`, `patch`, `truncated`. Verify: `bun run typecheck`.
- [x] 1.2 Build a unified diff from a file-editing tool use's input in `packages/runner/src/`, covering
      the replace-shaped tools and the whole-file write, with the starting line resolved from the
      worktree when it can be. Verify: `bun test packages/runner` covers a replace, a new-file write, a
      multi-edit, and an input the tool does not recognize.
- [x] 1.3 Bound it: clamp `preview` to the timeline budget and `patch` to the hard ceiling, set
      `truncated`, and compute the counts from the whole diff rather than the clamped one. Verify:
      `bun test packages/runner` asserts the counts of a truncated edit describe the whole edit.
- [x] 1.4 Degrade on every failure path — unreadable file, text not found, missing input fields —
      to today's tool-and-target activity. Verify: `bun test packages/runner` asserts an event is
      still produced for each.

## 2. Carry it through the orchestrator

- [x] 2.1 Put the new fields on the `stage.activity` payload, built where it can be read on its own
      (`apps/orchestrator/src/activity.ts`). Verify: `bun test apps/orchestrator` asserts the payload
      carries the edit, and says nothing about one when there is none.

## 3. Bound what the timeline hands out

- [x] 3.1 Project `patch` out of the payload the timeline read and the SSE stream return
      (`apps/api/src/app.ts`). Verify: `bun test apps/api` asserts a timeline read carries `preview`
      and not `patch`.
- [x] 3.2 Add the per-event patch read, answering an event with no edit without erroring. Verify:
      `bun test apps/api` covers a truncated edit, an event with no edit, and an unknown event.

## 4. Render the edit

- [x] 4.1 Teach `DiffViewer` (`apps/web/src/components/diff-viewer.tsx`) line numbers derived from the
      unified diff's own hunk headers, without changing what the Files view already renders. Verify:
      `bun run --cwd apps/web test` covers a multi-hunk diff's numbering.
- [x] 4.2 Render a file-editing activity in the step's record as its edit — the line counts, the
      clamped diff, and the control that opens the whole edit, under the line that named the file.
      Verify: `bun run --cwd apps/web test` covers an edit, a clamped edit, and an activity with no edit.

## 5. Close it out

- [x] 5.1 `bun run ci` passes.
