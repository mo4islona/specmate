## Why

Roadmap phase: the tail of Phase 3, alongside `stage-edit-diffs`.

`code-diff-view` deliberately excluded the OpenSpec change folder from the task's Files view and
named the exclusion's replacement in its own non-goals: "that is the separate `artifact-diff-view`
change". This is that change.

The exclusion has a cost the owner met head-on. A task that has done nothing but specification
work — which is every task between planning and the spec gate, the longest stretch of the
pipeline — has changed only files inside its change folder, so its Files tab reads `Files 0` and
its screen says no product code has been committed. The tab is built and correct and reads as
unimplemented, because the only work the task has done so far is the work the tab refuses to show.
The specs are reachable, under Docs, as rendered documents — which answers "what does the spec
say" and never "what did this stage change about it", the question a reviewer actually has.

The second half is where a diff opens. Selecting a file today replaces the Files view's right
pane, which is fine on that surface and useless everywhere else: a file named in a step's record
has nowhere to open to. A diff wants to be a layer over the surface the owner is already on.

## What Changes

- `task-surface`: a task's files-changed list stops excluding the OpenSpec change folder and
  covers everything the task branch changed, each file carrying which of the two it is — the
  specification the task wrote, or the product code it changed. Reading one file's diff is
  unchanged except that a change-folder path is now a legal argument to it.
- `operator-ui`: the Files view lists both groups under headings that name them, and its count is
  the count of everything the task changed. A file's whole diff opens in a drawer over the current
  surface, reachable from the Files list and from a path named anywhere else in the task view.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `task-surface`: the files-changed list covers the change folder and groups what it returns.
- `operator-ui`: the Files view shows both groups; a file's diff opens as a layer, not only as
  that view's right pane.

## Impact

- `packages/workspace`: `taskFilesChanged` loses its exclusion argument and gains the grouping;
  the exclusion itself does not disappear from the codebase — `renderDiff` in `packages/runner`
  still draws the same split for the reviewer's prompt, and that is left exactly as it is.
- `apps/api`: the files-changed response gains a group per file. No new endpoint: the per-file
  diff read already takes an arbitrary path.
- `apps/web`: the Files view groups its list; a new drawer renders one file's diff over whatever
  surface is showing, and the Files view's own selection uses it.
- The tab's count changes meaning, and for the better: `Files 0` on a task that has written seven
  spec files was the bug.

## Non-goals

- No diffing of an artifact against anything but the task branch's own base. "What did this stage
  change" at per-stage granularity is `stage-edit-diffs`' subject, not this one's.
- No merging of the Docs surface into Files. Docs renders artifacts as documents — the reading
  view — and stays; this is the diff view of the same files, and the two answer different
  questions.
- No rename or copy detection. The comparison keeps `--no-renames`, as it does today.
- No editing, commenting on, or approving a diff. This is a read.
