## 1. Diff computation

- [x] 1.1 Add a function (e.g. in `@specmate/workspace` or `apps/api`) that, given a task's
      `repoUrl`, `baseBranch`, and branch name, calls `ensureMirror` and resolves the merge-base
      against `refs/remotes/origin/<baseBranch>`, reusing the same merge-base logic
      `renderDiff`/`mergeBase` (`packages/runner/src/prompt.ts`) already implements.
- [x] 1.2 Implement the files-changed list via `git.inMirror(mirror, ['diff', '--numstat',
      base, branch, '--', '.', ':(exclude)<changeDir>'])`, parsing added/removed counts and
      status per file.
- [x] 1.3 Implement the one-file patch via `git.inMirror(mirror, ['diff', base, branch, '--',
      '<path>'])`.
- [x] 1.4 Unit test both against a fixture repo: a task branch with product-code commits, one
      with none (AC-1035), and one excluding a change-folder-only commit (confirms the
      changeDir exclusion holds).

## 2. task-surface endpoint

- [x] 2.1 Add the files-changed list read (REQ-1013/AC-1034, AC-1035).
- [x] 2.2 Add the one-file diff read (AC-1036).
- [x] 2.3 Confirm both work for a task whose workspace has already been released (AC-1037) —
      test against a task fixture that has gone through `release()`.
- [x] 2.4 Not-found handling for a resolvable-but-missing branch (host deleted it externally) —
      structured error, not a crash (`task-surface` REQ-1010's existing error-shape rule).

## 3. operator-ui Files-Changed view

- [x] 3.1 Add a Files-Changed screen/panel reachable from the task view alongside the existing
      "Read artifacts" link (REQ-916/AC-943).
- [x] 3.2 File list shows status and added/removed counts; selecting a file fetches and renders
      its unified diff as a readable document (AC-944).
- [x] 3.3 Empty state when a task has no product-code changes yet (AC-945).

## 4. Verification

- [x] 4.1 `bun run spec:lint` and `openspec validate code-diff-view --strict` pass.
- [x] 4.2 `bun run spec:validate` (repo-wide) passes alongside the other in-flight Phase 3
      changes.
- [x] 4.3 Manually open a real task with committed product-code changes and confirm the
      Files-Changed view matches `git diff <base>...<branch>` run by hand, and confirm the same
      view still works after archiving that task.
