## Why

Roadmap phase: the tail of Phase 3 (`docs/plan.md` §14, "UI v1"), continuing the pass-3 sweep
`task-screen-redesign` and `files-review-surface` belong to.

The documents surface reads as a list of files in a folder, and the same files are listed a second
time on Files. Three duplications on one screen:

- Every kind is a heading over the one file it names — `TASKS` over `tasks.md`, `REVIEW` over
  `review.md` — because seven of the eight kinds round-trip through their file names. The eighth
  is `spec`, and there the file name is the part that distinguishes nothing: a change touching
  seven capabilities has seven files called `spec.md`, told apart only by the folder above them,
  which is the part a rail's width truncates first.
- Every row carries the change folder underneath it. It is one string, the same on all of them,
  cut before the segment that could have differed.
- Every one of those files is also in the Files count, wherever the repository's own convention
  is an OpenSpec suite and the change folder therefore stands in its tree (REQ-1707). Against the
  merge-base that folder is almost always new outright, so its "diff" is every line of every
  document marked added — the same text the documents surface renders properly, in the one form
  nobody wants to read it in, padding the file count a reviewer opens that surface for. Under the
  other two profiles the folder is out of the tree already, so the surface as it stands means the
  code under one profile and the code plus its documents under another.

Underneath the first of those is an assumption the system stopped being allowed to make when
`spec-convention-profiles` landed: that a document's file name says what the document is. OpenSpec
is one profile of three (REQ-1701). `kind` is the vocabulary every profile is mapped onto, and it
is the only name that survives a repository laid out another way.

The listing is also unordered — it comes back sorted by kind, so the decision log lands after the
summary, behind the document whose whole job is to be the end.

## What Changes

- `operator-ui`: a document is named by what it is, not by the file holding it; the listing reads
  in the order the documents read; the storage path is said once, on the document, instead of
  under every row; and opening the surface opens a document rather than an instruction to pick
  one. The same naming holds on a step's own shelf, which is the other place documents are listed.
- `operator-ui`: the Files view is the code the task changed. It no longer groups, because there
  is one group left.
- `task-surface`: the files-changed read withholds the task's own change folder, whichever layout
  the task is pinned to put it under. The per-file diff read is unchanged and still serves a path
  inside it wherever the branch carries one (AC-1061), so nothing becomes unreachable — a document
  has one home, not none.

### New Capabilities

(none)

### Modified Capabilities

- `operator-ui`: REQ-907 — documents are named, ordered and opened; REQ-916 — the Files view
  covers code, and AC-995 is contradicted outright rather than added beside, since a
  specification-only task now has nothing on that surface at all.
- `task-surface`: REQ-1013 — the file list is the code half, and AC-1060 says so.

## Impact

- **Two preconditions.** REQ-907 is modified by `task-screen-redesign`, and REQ-916/REQ-1013 by
  `files-review-surface`; both are implemented and unarchived, and this change's deltas are
  written against their wording. Both must be synced before this one, or this change's text will
  silently revert theirs.
- **Settled against `change-folder-under-openspec-only`.** That change decides whether the folder
  is in the repository at all; this one decides whether it is on the Files surface. They meet in
  `taskFilesChanged`, which withholds the folder the task's layout pinned — `openspec/changes/…`
  or `.specmate/changes/…` — so the surface says the same thing under every profile. The split
  went with it: the API test that change added for AC-1722 no longer names a group, and the
  Files-view test asserting the absence of a specification group is gone, that absence being
  structural now rather than a fact about one profile.
- **A task before the implementer runs shows `Files 0`.** That is what the surface now means and
  it is true — the count stops overstating the code by the size of the change folder. The empty
  state says where the documents are, so the count is not read as "nothing has happened".
- **No diff of a document.** Reading how a later stage rewrote `tasks.md` is no longer a thing the
  Files view does. The document's current text is on the documents surface, and the step that
  wrote it shows it in the thread (REQ-907). Accepted deliberately: against the merge-base that
  diff was the whole file as additions, so it was never the delta anyone wanted. Under a profile
  whose repository does not carry the folder there was no such diff to read in the first place,
  which is the reading AC-1061 now has where the branch carries none of those paths.
