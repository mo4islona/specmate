## Why

The owner currently has no way to see what a task actually changed in the target repository
without leaving SpecMate and reading the branch directly. `agent-execution` already computes
exactly this diff today — `packages/runner/src/prompt.ts`'s `renderDiff` runs `git diff --stat`
and `git diff` between the task branch's merge-base with the base branch and `HEAD`, excluding
the OpenSpec change folder, to feed the reviewer role's prompt (REQ-201/AC-202) — but that
computation is private to prompt assembly inside the runner; nothing exposes it to a human. The
user asked for this directly, framed as "like a PR — just use git's own functionality": a
Files-Changed list plus per-file diff, at the task level, the same shape as a pull request's
diff tab.

## What Changes

- `task-surface` gains a read endpoint returning a task's code diff: the list of files changed
  in the target repository between the task branch's merge-base and its current `HEAD`
  (excluding the OpenSpec change folder — the same split `renderDiff` already draws, since
  change-folder diffing is the separate `artifact-diff-view` change), and the unified diff for
  one selected file.
- `operator-ui` gains a Files-Changed view: a file list with change stats (added/removed lines,
  status) and a per-file unified diff, reachable from the task view alongside the existing
  "Read artifacts" link.
- No new diffing logic is invented — the API computes this with the same `git diff`/`Git`
  wrapper (`@specmate/workspace`) the runner already uses, against the shared repository mirror
  (`workspace-lifecycle` REQ-704) that already backs a task's `HEAD` even after its own working
  tree is released (REQ-710 keeps the task branch and its commits resolvable).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `task-surface`: adds a read for a task's code diff (files-changed list, per-file unified
  diff).
- `operator-ui`: adds a Files-Changed view rendering that read.

## Impact

- `apps/api` (or wherever `task-surface` is implemented): a new read handler shelling out to
  git via `@specmate/workspace`'s existing `Git`/mirror helpers — no new package, no schema
  change (the diff is computed on demand from git history, not stored).
- `apps/web`: a new Files-Changed screen/panel, styled after a PR diff view (collapsible file
  list, unified diff per file).
- Works for archived tasks too, not only active ones, since the diff is computed from the
  shared mirror rather than from a live per-task workspace.

## Non-goals

- No diffing of OpenSpec artifacts (proposal/specs/design/tasks markdown) — that is the
  separate `artifact-diff-view` change; this one explicitly excludes the change folder, mirroring
  `renderDiff`'s existing exclusion.
- No per-stage attribution of which lines which stage attempt produced — this is a single
  cumulative task-level diff (base branch merge-base → current `HEAD`), matching a PR's own
  Files-Changed tab, not a per-attempt breakdown. `dag-visualization`'s per-node detail panel
  does not gain diff rendering as part of this change.
- No side-by-side/split diff rendering requirement — unified diff is sufficient for v1; a nicer
  rendering mode is a UI-only follow-up, not a spec change.
- No live diffing of an in-progress, uncommitted attempt — `HEAD` only advances via committed,
  accepted stage output (`workspace-lifecycle` REQ-706, `agent-execution` REQ-208), so this view
  is inherently accepted-only, consistent with `operator-ui` REQ-914's existing rule.
