# Tasks

## 1. Stop withholding the change folder

- [x] 1.1 Make `taskFilesChanged` (`packages/workspace/src/diff.ts`) cover the whole comparison and
      return each file's group, deriving the group from the task's own change folder. Verify:
      `bun test packages/workspace` covers a branch with both kinds of file, and one with only specs.
- [x] 1.2 Carry the group through the files-changed response (`apps/api/src/app.ts`). Verify:
      `bun test apps/api` asserts a spec-only task lists its files marked as specification.

## 2. Group the list and lift the diff into a layer

- [x] 2.1 Add the file-diff drawer (`apps/web/src/components/`): one file's diff over the current
      surface, closing back to it. Verify: `bun run --cwd apps/web test` covers opening, closing, and
      a path the comparison has nothing for.
- [x] 2.2 Group the Files view's list by the response's group and open its selection in the drawer.
      Verify: `bun run --cwd apps/web test` covers both groups listed and a selection opening the drawer.
- [x] 2.3 Open the drawer from a file named in the step's record. Verify: `bun run --cwd apps/web test`
      asserts the record's edit opens the drawer without leaving the surface.

## 3. Close it out

- [x] 3.1 `bun run ci` passes.
