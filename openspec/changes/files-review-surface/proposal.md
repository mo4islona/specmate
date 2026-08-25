## Why

Roadmap phase: the tail of Phase 3 (`docs/plan.md` §14, "UI v1") — the last piece of the pass-3
sweep over the task view that `task-screen-redesign`, `pipeline-compression`, `stage-edit-diffs`
and `artifact-diff-view` belong to.

`task-screen-redesign` rebuilt every surface of the task view except one. Its task 8.7 says so in
as many words: "The Files surface still renders the pre-pass-3 list-detail panel… is the change
that amends REQ-916/AC-944 and is not this one." This is that change. The drawing it defers to is
`docs/design/task-screen-pass-3.md` §Files, and nothing has been built from it.

What the surface does today is pick one file at a time. `artifact-diff-view` grouped the list and
moved the diff into a layer, which fixed the reachability problem — a spec-only task no longer
reads `Files 0` — and left the reading problem exactly where it was. A review is a pass over
everything the task changed, and this surface makes it a sequence of round trips: open a file,
read it, close it, remember you read it, open the next. Nothing on the screen knows how far you
got. On the twelfth file you are keeping the count yourself, which is the one job a review tool
exists to take off you.

The muscle memory for this is GitHub's, and the drawing takes that shape deliberately: a tree on
the left, every file stacked on the right, a `Viewed` tick per file and `n / N viewed` above them.
The tick is the whole point. It is what turns a list of twelve files into a pass with an end.

## What Changes

- `operator-ui`: the Files view stops being a list with a detail pane and becomes a review
  surface. A file tree with a filter box replaces the flat list. Every file's diff is on the
  surface at once, stacked, each in a collapsible card carrying its path, status and counts. Each
  card has a `Viewed` tick, and the surface carries `n / N viewed` over the whole comparison. A
  hunk's surroundings can be widened in place, and the diff renders unified or split at the
  reader's choice. Selecting a file in the tree brings its card into view instead of opening a
  layer; the layer stays for a diff opened from anywhere else in the task view.
- `task-surface`: the files-changed read names the comparison it describes, so a `Viewed` tick can
  be a claim about a specific diff and can be dropped when the task commits over it. The per-file
  diff read accepts how much surrounding context to return, which is what a hunk expander asks
  for.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `operator-ui`: REQ-916 — the Files view becomes a stacked review surface with a tree, a filter,
  per-file `Viewed`, hunk expanders and a unified/split choice. AC-944 is contradicted outright
  and is modified, not added beside: nothing is selected any more, so a requirement saying
  selection renders the diff cannot stand next to one saying every file is already rendered.
- `task-surface`: REQ-1013 — the files-changed read carries the comparison's identity, and the
  per-file diff read takes a requested context width.

## Impact

- **Two preconditions, already met.** REQ-916 and REQ-1013 were both modified by
  `artifact-diff-view`, implemented but unarchived, and this change's deltas are written against
  its wording — so it was synced and archived first. `operator-ui`'s AC band was also full, two
  numbers short of what this change needs, so a capability may now hold more than one band and
  `operator-ui` claims the next free one. No living requirement describes that registry, so it
  carries no delta. Both are recorded as done in `tasks.md` §1.
- `packages/workspace`: `taskFilesChanged` returns the comparison's tip alongside the files;
  `taskFileDiff` takes a context width and bounds it.
- `apps/api`: the two diff reads carry those through. No new endpoint.
- `apps/web`: the Files screen is rebuilt around a tree and a stack of per-file cards. `Viewed`
  and the reader's unified/split choice are browser-local, keyed to the comparison. `FileDiffDrawer`
  survives unchanged — it still serves AC-996, a diff opened from outside this surface.
- Nothing about how a task runs changes. This is a reading surface.

## Non-goals

- **No comments on a diff.** The drawing puts a `💬` in each file's header and its own open
  question asks what it would post into. Commenting on a path is a feature with a data model
  behind it, and it is not this change.
- **No syntax highlighting.** The drawing calls for it within the existing palette. It is
  orthogonal to the surface's shape, wants its own decision about a tokenizer, and the surface
  reads correctly without it.
- **No server-side `Viewed`.** It is browser-local, by the owner's decision — recorded with its
  cost in `design.md`.
- **No change to what the comparison is.** Still merge-base to branch tip, still `--no-renames`,
  still no rename or copy detection.
- **No merge of Docs into Files.** They answer different questions, as `artifact-diff-view`
  already said.
- **No review verdict.** Ticking every file marks a pass complete for the reader and approves
  nothing; gates stay where they are.
