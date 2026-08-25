# Tasks

## 1. Preconditions, settled at planning time

- [x] 1.1 Let a capability hold more than one ID band (`openspec/id-bands.yaml`,
      `scripts/lint-spec-ids.ts`) and give `operator-ui` the next free one, its first being full.
      Verify: `bun run spec:lint` passes and `bun run spec:next-id` rolls `operator-ui` into the
      new band once the old one is exhausted.
- [x] 1.2 Sync and archive `artifact-diff-view`, whose wording of REQ-916 and REQ-1013 this
      change's deltas are written against. Verify: `bun run spec:validate` and `bun run spec:lint`
      both pass with this change's deltas in place.

## 2. Widen what the two diff reads can answer

- [x] 2.1 Return the comparison's tip alongside the files — REQ-1013, AC-1079. The tip is already
      resolved as part of the range, so `diffFiles` (`packages/workspace/src/service.ts`) composes
      the two into `TaskDiffFiles` rather than `taskFilesChanged` recomputing it. Verify:
      `bun test apps/api` asserts the tip names a commit and is renamed once the branch commits
      again.
- [x] 2.2 Take a context width in `taskFileDiff`, bounded by a maximum, answering a width past the
      maximum with the widest served rather than an error, and a width past the file's length with
      the whole file as context — REQ-1013, AC-1080. Verify: `bun test packages/workspace` covers
      the default, a wider read, the bound, and a file shorter than the width.
- [x] 2.3 Carry both through the two endpoints (`apps/api/src/app.ts`), the width as an optional
      query parameter so an old client is unaffected. Verify: `bun test apps/api` asserts the file
      list carries the tip and a widened read returns more context than the default.

## 3. Teach the kit to draw a diff two ways

- [x] 3.1 Give `Diff` (`apps/web/src/ui/diff.tsx`) a two-column arrangement pairing removed with
      added lines within a hunk, sharing the parse the single column already does — REQ-916,
      AC-1804. Verify: `bun run --cwd apps/web test` covers a hunk with unequal removed and added
      counts, and an add-only hunk.
- [x] 3.2 Render a hunk header as a control that asks for more surrounding context, and draw what
      comes back in place — REQ-916, AC-1803. Verify: `bun run --cwd apps/web test` covers widening
      one hunk of a multi-hunk diff and leaving the others alone.
- [x] 3.3 Add both to `/kit` (`apps/web/src/screens/kit-screen.tsx`) in every state they have.
      Verify: `bun run --cwd apps/web test src/screens/kit-screen.test.tsx`.

## 4. Rebuild the Files surface as a pass

- [x] 4.1 Group the listing by directory inside each of the two groups, each file carrying its
      status and counts, with a filter that narrows it — REQ-916, AC-943, AC-995, AC-1800. A real
      tree was built first and read as a ladder: folders sort above files at every level, so a
      change folder's own `proposal.md` drew *below* the `specs/…/spec.md` nested two levels deeper
      than it. `lib/diff-tree.ts` never nests past a directory and its files, and shortens a long
      directory from the front. Verify: `bun run --cwd apps/web test` covers a mixed task, a
      spec-only task, a filter matching nothing, and the ladder shape that prompted the change.
- [x] 4.2 Stack every file's diff on the surface in collapsible cards, the first few expanded and
      the rest fetching when expanded; selecting in the tree brings a card into view rather than
      opening a layer — REQ-916, AC-944. Verify: `bun run --cwd apps/web test` asserts no read is
      issued for a collapsed card, and that selecting a file leaves every other card on the surface.
- [x] 4.3 Clamp a card whose diff is longer than the surface can hold as one document, say so, and
      offer the rest without leaving the surface — REQ-916. Verify: `bun run --cwd apps/web test`
      covers a diff over the ceiling and one just under it.
- [x] 4.4 Add the per-file `Viewed` mark and the pass count, stored in the browser under the
      comparison's tip, with the total counting the whole comparison rather than the filtered view
      — REQ-916, AC-1801, AC-1800. Verify: `bun run --cwd apps/web test` asserts the count advances
      on a mark and does not move when the filter does.
- [x] 4.5 Drop the marks when the tip has moved and say the comparison moved rather than showing an
      unstarted pass — REQ-916, AC-1802. The surface is keyed by the tip, so a task that commits
      mid-review reads its pass fresh rather than reconciling one. Verify:
      `bun run --cwd apps/web test` covers a return visit with a moved tip and one with the same tip.
- [x] 4.6 Offer the unified/split choice on the surface, remembered between visits, and withhold it
      below the width that can carry two columns — REQ-916, AC-1804. Verify:
      `bun run --cwd apps/web test` covers the choice holding across a remount and the narrow case.
- [x] 4.7 Leave `FileDiffDrawer` itself untouched — it is still the answer to a file named outside
      this surface — REQ-916, AC-996, AC-997. Its coverage moved out of the Files screen's tests,
      which no longer open it, into `components/file-diff-drawer.test.tsx`. Verify:
      `bun run --cwd apps/web test src/components/`.

## 5. Close it out

- [x] 5.1 `bun run ci` passes — run against a throwaway Postgres, since the database-backed suites
      skip themselves without one.
- [ ] 5.2 Read a real task's Files view on the deployed client: a task with only specification
      work, and one with both groups and a file long enough to clamp. Confirm the pass counts, a
      widened hunk, and that an accepted commit mid-review resets the marks and says why.
