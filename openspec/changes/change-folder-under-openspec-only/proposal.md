## Why

Provisioning creates SpecMate's OpenSpec change folder in the target repository's working tree —
in every repository, under every profile — and the first stage's `git add -A` sweeps it into a
commit. `spec-stages-under-no-suite` stopped the pipeline *running* the specification segment where
there is no suite; it left the folder itself standing. So a repository that does not use OpenSpec
still gets `openspec/changes/<name>/` on its branch and in its pull request, holding a schema marker
for a workflow it does not run, the kickoff brief, and the decision log.

Under the profile `custom` this is worse than a stray directory. That repository does keep a living
specification — in its own shape, at a location its owner configured — and SpecMate files a second,
differently shaped change record beside it. REQ-1704 already says the planner grounds the change in
the specification that exists; planting our own convention in the tree contradicts the same
sentence.

The rule this change makes true: **a task writes into the repository what that repository's own
convention asks for, and nothing else.** Under `openspec` that is the change folder, exactly as
today. Under `custom` and `none` the task's artifacts are SpecMate's working record rather than the
repository's content, so they stay out of the tree and the database holds them.

**Roadmap.** Continues the Phase 2 context-sources thread (§2 "Context sources", §14 Phase 2) that
`2026-08-24-spec-convention-profiles` opened and `spec-stages-under-no-suite` carried on. Those two
taught SpecMate which convention governs a repository and let the pipeline act on the answer; this
one stops SpecMate writing a convention the repository never asked for.

## What Changes

- **BREAKING** AC-716 is inverted. Provisioning a repository whose profile is not `openspec` SHALL
  create nothing in the repository's tree — no change folder, no schema marker. The task's change
  folder is created instead at a workspace path that never enters a commit, under the same scratch
  exclusion REQ-707 already applies.
- Every consequence of a profile is stated in one place: what the repository keeps, where the change
  folder stands, whether the pipeline specifies, and what a spec-touching role is given as the
  convention to follow. Callers ask that object rather than testing the profile themselves.
- Which of the two layouts a task uses is **pinned at its first provisioning** and never re-read. A
  profile the owner changes mid-task governs what the task *does* next (REQ-1706); it must not move
  artifacts already written, nor file one task's work under two paths.
- Artifact indexing stops keying on a commit: after every stage the change folder is indexed whether
  or not the stage produced one, and an out-of-tree artifact is recorded carrying no git object.
- Where the folder is out of tree the database holds artifact content **whole and authoritative**.
  Where it is in the repository, git stays the store and the stored snapshot stays display-only —
  REQ-301 is unchanged for that half.
- Provisioning restores an out-of-tree change folder from the store whenever the workspace does not
  carry it: a fresh worktree, a self-repair, a discard, a conversation checkout. The decision log
  already works this way, and this is the same move for the rest of the folder.
- What the runner reads as "what this run changed" includes the out-of-tree folder, so the
  write-scope check and the brief-completeness check keep seeing what a role wrote. Without this
  both would silently pass on a folder git does not report.
- Publication reads the approved summary from the store rather than from a path on the branch.
- A `custom` or `none` task's branch and pull request therefore carry product code alone, and a task
  whose stages so far wrote only artifacts has no commit at all.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-lifecycle`: REQ-705 governs where the change folder is created and pins it per task;
  REQ-708 indexes after every stage rather than after every commit; a new requirement restores an
  out-of-tree folder from the store into a workspace that lacks it.
- `persistence`: REQ-301 states which of git and the database is authoritative for an artifact, and
  that content out of tree is stored whole.
- `spec-conventions`: a new requirement states what a task may write into the repository under each
  profile, and that one implementation answers every question a profile decides.
- `agent-execution`: REQ-208's scope check is pinned to see writes into an uncommitted change
  folder.
- `kickoff-brief`: REQ-1303's completeness check is pinned to fire for a proposal that git does not
  report as changed.

## Impact

- `packages/core`: the profile's implementation — the layout, whether the repository keeps the
  folder, whether the segment runs, and which standard a spec-touching role is given.
- `packages/workspace`: `paths.ts` (a change path is built from a layout), `manager.ts`
  (provisioning, scaffolding, the change-name convergence), `index-artifacts.ts` (index from the
  working tree, git object optional), `service.ts` (pin the layout, index on every stage, restore
  the folder from the store).
- `packages/db`: one nullable column on `tasks` pinning the layout, plus a migration.
- `packages/runner`: `scope.ts` (changed paths include the out-of-tree folder) — `brief.ts`,
  `prompt.ts` and `corroboration.ts` then need no change of their own.
- `apps/orchestrator`: `publish.ts` reads the summary from the store.
- Owner-visible: a `custom` or `none` task's pull request no longer carries the brief, the decision
  log or the summary as files. They stay readable in SpecMate, and the summary is still the pull
  request's body.

## Non-goals

- **Writing into a `custom` suite's own shape or location.** The change's specification is still
  produced and still readable; folding it into the repository's suite stays the owner's move. Doing
  it for them needs a convention SpecMate cannot infer.
- **Moving anything out of the tree under `openspec`.** A repository that keeps its changes in
  `openspec/changes/` gets exactly what it gets today.
- **Retrofitting tasks that already committed a change folder.** The rule binds a task from its
  first provisioning; branches already carrying a folder keep it and their history.
- **Changing the artifact catalog, the roles' contracts, or what a role writes.** Only where the
  folder sits changes.
- **Enriching the pull request to compensate.** The body is still the approved summary; nothing new
  is added to make up for files that are no longer there.
