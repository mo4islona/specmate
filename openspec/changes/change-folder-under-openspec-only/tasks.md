Design decisions are referenced as D1–D9 and requirements by ID; neither is restated here.

## 1. The profile's implementation

- [x] 1.1 State a profile's consequences in one object — the layout, whether the repository keeps the
      folder, whether the segment runs, the suite and its note, and the standard a spec-touching role
      is given — and have `specSuiteInForce` read it rather than repeat the rule — REQ-1707, AC-1725,
      D1. Verify: `bun run vitest run packages/core`.
- [x] 1.2 Build a change path from a layout rather than a root, with one table mapping the two —
      D3. Verify: `bun test packages/workspace`; no caller builds a change path from a literal
      (`grep -rn "openspec/changes" packages apps` names only the constant and the tests).

## 2. The pinned layout

- [x] 2.1 Add `tasks.change_layout` and generate the migration, whose backfill sets every
      already-provisioned row to `repository` — D2, D9. Verify: `bun run db:generate` writes one
      migration, `bun run db:migrate` applies it, and a task past `draft` reads `repository`.
- [x] 2.2 Split scaffolding out of `WorkspaceManager.provision`, so the working tree exists before
      the layout is known — D2, D4. Verify: `bun test packages/workspace`; provisioning alone no
      longer creates a change folder.
- [x] 2.3 Pin the layout in `WorkspaceService.provision` after the convention is resolved, guarded on
      the column still being null, and open the folder under it — REQ-705, AC-715, AC-716, AC-743,
      AC-1721, AC-1722, AC-1723, AC-1724, D2. Verify: `bun test packages/workspace`; a repository
      with no OpenSpec root gets nothing in its tree, and a second provisioning after the owner
      switched the profile opens the folder where the first one did.

## 3. The store

- [x] 3.1 Index from the working tree where the repository does not carry the folder, recording no
      git object and the content whole; keep `ls-tree` and the display ceiling where git holds the
      truth — REQ-301, AC-353, AC-745, D4, D5. Verify: `bun test packages/workspace`.
- [x] 3.2 Index after every stage rather than only after a commit, keeping the deletion sweep on both
      paths — REQ-708, AC-723, AC-724, AC-744, D5. Verify: `bun test packages/workspace`; a stage
      that committed nothing still indexes what it wrote.
- [x] 3.3 Restore an out-of-tree change folder from the index when the workspace does not carry it,
      on provisioning, on a conversation checkout, and after a discard — REQ-712, AC-746, AC-747,
      AC-748, D4. Verify: `bun test packages/workspace`; deleting the folder and re-provisioning
      brings every recorded artifact back, and a discard drops what the attempt wrote.
- [x] 3.4 Refuse a discard whose workspace names no absolute path or no checkout, and hold every
      caller to the signature that carries the task — D8. Verify: `bun test packages/workspace`; a
      discard handed a bare string fails instead of touching the working directory.

## 4. What a run changed

- [x] 4.1 Add the out-of-tree change folder to what a run is read to have changed, reporting a file
      only where its content differs from the store's copy or the store has none, and never the rest
      of `.specmate/` — REQ-208, AC-256, D6. Verify: `bun test packages/runner`.
- [ ] 4.2 Pin that the brief-completeness check fires for a proposal git does not report — REQ-1303,
      AC-1329, D6. Verify: `bun test packages/runner`; a planner run writing an incomplete brief into
      an out-of-tree folder fails the attempt.
- [ ] 4.3 Pin that the declared-name convergence still sees a declaring run's artifacts under the
      internal layout — AC-243, AC-250, D6. Verify: `bun test packages/runner`.

## 5. Publication

- [x] 5.1 Read the approved summary from the artifact index instead of from a path on the branch —
      D7. Verify: `bun test apps/orchestrator`; a task whose folder converged on a declared name
      publishes with the right body, and a task with no folder on its branch publishes at all.

## 6. Surfaces

- [ ] 6.1 Check the task screen against an out-of-tree task: artifacts render from the store, the
      files view shows product code alone with no specification group, and neither surface reports an
      error where the branch has no commit — AC-1035, AC-1722. Verify: `bun run --cwd apps/web test`
      plus a read of `/tasks/<id>/files` and `/tasks/<id>` for such a task.

## 7. Close-out

- [x] 7.1 Full suite green — `bun run test`, `bun run typecheck`, `bun run check`.
- [x] 7.2 `bun run spec:validate` and `bun run spec:lint` pass over the change.
- [ ] 7.3 Walk a task in a repository with no suite against a live instance: its branch carries
      product code alone, its brief and summary read from SpecMate, and its pull request opens with
      the approved summary as the body — AC-1722, D7.
