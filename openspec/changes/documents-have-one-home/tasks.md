# Tasks

## 1. Preconditions

- [ ] 1.1 Sync and archive `task-screen-redesign`, whose wording of REQ-907 this change's delta is
      written against. Verify: `bun run spec:validate` and `bun run spec:lint` both pass with this
      change's deltas in place.
- [ ] 1.2 Sync and archive `files-review-surface`, whose wording of REQ-916 and REQ-1013 this
      change's deltas are written against. Verify: as above.

## 2. Name a document for what it is

- [x] 2.1 Name, order and qualify a task's documents in one place, so the documents surface and a
      step's shelf agree — `apps/web/src/lib/task-documents.ts`, REQ-907, AC-1810, AC-1811,
      AC-1812. The name is the artifact kind; the qualifier is the capability a specification is
      for; the order is the reading order, decision log second. Verify:
      `bun run --cwd apps/web test -- artifacts-screen step-documents`.
- [x] 2.2 Draw the documents rail from it: kind headings gone, the change folder gone from the
      rows, the storage path moved onto the open document's own header — REQ-907, AC-1810.
      Verify: as above.
- [x] 2.3 Open the first document in reading order when the route names none — REQ-907, AC-1813.
      Verify: as above.
- [x] 2.4 Draw a step's shelf from the same names — REQ-907. Verify: as above.

## 3. Leave the code half to the Files surface

- [x] 3.1 Withhold the change folder from the files-changed read, and drop the group a file no
      longer belongs to — `packages/workspace/src/diff.ts`, REQ-1013, AC-1060. The folder withheld
      is the one the task's layout pinned (REQ-1707), which is what `taskFilesChanged` is handed.
      The per-file diff read is untouched and still serves those paths wherever the branch carries
      them (AC-1061). Verify: `bun test packages/workspace/test/diff.test.ts` and
      `bun test apps/api`.
- [x] 3.2 Collapse the Files listing to one group and say, where it is empty, where the task's own
      documents are — REQ-916, AC-945, AC-995. Verify:
      `bun run --cwd apps/web test -- files-changed-screen`.

## 4. Gate

- [ ] 4.1 `bun run ci`.
