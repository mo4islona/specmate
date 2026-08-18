## Context

`packages/runner/src/prompt.ts`'s `renderDiff` already computes almost exactly the diff this
change needs — `git diff --stat` and `git diff` between the task branch's merge-base with its
base branch and `HEAD`, excluding the change folder (`:(exclude)${workspace.changeDir}`) — but
it runs inside a live, checked-out worktree (`cwd: params.workspace.path`) during a stage, and
its output goes into a prompt string, not an API response.

`packages/workspace/src/manager.ts` shows the branch a task's diff needs is always a local ref
in the shared mirror, not something requiring a worktree: `ensureBranch` creates
`refs/heads/${taskBranch(slug)}` inside the mirror bare repository directly, and `release`
removes only the working tree — "the branch and its commits stay in the cache." `git diff`
between two refs works against a bare repository with no checkout at all, so this change does
not need a worktree either, live or reconstructed — it reads the same shared mirror
(`ensureMirror`, `packages/workspace/src/mirror.ts`) via `git.inMirror(mirror, [...])`, the same
pattern `ensureBranch`/`resolveBaseCommit` already use for other mirror-only reads.

`apps/api` already depends on `@specmate/workspace`, so it can call the same `Git` class and
mirror helpers directly — no new package, no IPC to the runner.

## Goals / Non-Goals

**Goals:**
- Expose the task-level, product-code-only diff (files list + per-file unified diff) through
  `task-surface`, computed against the shared mirror, working whether or not the task's own
  worktree currently exists.
- Render it in `operator-ui` as a PR-style Files-Changed list with a per-file diff.

**Non-Goals:**
- No worktree provisioning or reuse — this reads the bare mirror directly.
- No new diffing algorithm — literally the same `git diff`/`--stat` invocation shape
  `renderDiff` already uses, relocated to run against the mirror instead of a worktree, and
  exposed via HTTP instead of embedded in a prompt.
- No caching/storage of the diff — computed on demand each read; if this becomes a cost problem
  under real usage, that is a follow-up, not a spec change.

## Decisions

**Compute against the shared mirror via `git.inMirror`, not a worktree.** `ensureMirror`
already keeps `refs/heads/<task-branch>` and `refs/remotes/origin/<base-branch>` fetched and
pruned; diffing two refs needs no checkout. This is *lighter* than `renderDiff`'s own approach
(which happens to have a worktree on hand because a stage is running in one anyway) and is what
makes REQ-1013/AC-1037 ("works after workspace release") true by construction rather than by
special-casing the released state.

**Reuse the merge-base + exclude-changeDir shape from `renderDiff`, don't reinvent it.** Same
`mergeBase`-equivalent lookup (`resolveBaseCommit`/merge-base against `refs/remotes/origin/<base
branch>`), same `-- . :(exclude)<changeDir>` pathspec so this change and `artifact-diff-view`
partition cleanly along the same line `renderDiff` already draws — a file is covered by exactly
one of the two diffs, never both, never neither.

**Two read shapes, not one blob.** `git diff --name-status` (or `--numstat` for line counts)
gives the file list cheaply; the full `git diff` patch for one file is fetched only when that
file is selected — mirrors how `operator-ui` REQ-907 already treats artifacts (list cheaply,
fetch content on selection), and avoids sending a potentially large multi-file patch for a task
the owner is just glancing at.

**No stage attribution.** The diff is `merge-base..HEAD` on the branch, full stop — matching a
PR's own Files-Changed tab and the user's explicit framing ("like a PR, just use git's own
functionality"). `dag-visualization`'s per-node detail deliberately stays as-is (attempts +
telemetry only, per that change's own design.md) rather than growing a diff feature by
extension.

## Risks / Trade-offs

- **Large diffs** (a big implementation stage) → `--numstat`/`--name-status` for the list is
  cheap regardless of patch size; only the selected file's patch is fetched in full. If a single
  file's patch is itself enormous, that is a rendering concern for `apps/web` (e.g. truncate
  with a "view full diff" fallback), not a new requirement here.
- **Mirror staleness** — `ensureMirror` fetches on every call today (`fetch origin --prune
  --quiet`), so a read is already as fresh as the remote; no separate refresh step needed.
- **A repo host deleting the task branch after merge** (outside SpecMate's control) would make
  the diff unresolvable going forward — `workspace-lifecycle` REQ-710 guarantees SpecMate's own
  side keeps commits resolvable, not that an external host never prunes its own copy. Treated as
  a not-found response, not a crash; not a new requirement, since it is a pre-existing
  possibility for any git-history read.

## Migration Plan

None — new read-only endpoint and UI view, computed on demand; no schema and no data migration.
