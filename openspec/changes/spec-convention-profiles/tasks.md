## 1. The profile as a type (REQ-1701)

- [x] 1.1 Add the profile and its descriptor to `packages/core` — the three values, and the
      resolved shape carrying the suite's location and the owner's convention note where one
      applies. Export from `packages/core/src/index.ts`. Verify: `bun run typecheck`.
- [x] 1.2 Add a resolver that takes the detected value and the owner's setting and returns one
      descriptor, including the case where a configured location was not found in the tree —
      AC-1701, AC-1702. Verify: `bun test packages/core/test/spec-conventions.test.ts`.

## 2. Detection and resolution during provisioning (REQ-1702)

- [x] 2.1 Detect an OpenSpec root in the checked-out tree — `openspec/specs/`, not `openspec/`,
      so a repository that only ever received a change folder still detects as none. Verify:
      `bun test packages/workspace/test/spec-conventions.test.ts` — a tree with `openspec/specs/`
      detects openspec, a tree with only `openspec/changes/<slug>/` detects none.
- [x] 2.2 Migrate: one additive `tasks` column for the resolved profile, defaulting to
      undetermined. Verify: `bun run db:generate` produces one migration, `bun run db:migrate`
      applies it against a fresh database.
- [x] 2.3 Resolve `override ?? detected` in the provisioning path and write it to the task row,
      alongside what provisioning already writes there — AC-1703, AC-1704, AC-1705. Verify:
      `bun test packages/workspace/test/spec-convention-resolution.test.ts`.
- [x] 2.4 Confirm the resolved profile follows the setting between two stages of one task, since
      provisioning runs before each — AC-1706. Verify:
      `bun test packages/workspace/test/spec-convention-resolution.test.ts`.

## 3. The owner's setting (REQ-1702, REQ-923)

- [x] 3.1 Add a `spec-conventions` key to `packages/db/src/settings-store.ts`: read, and a
      partial update under the same `for update` transaction `updateModelDefaults` uses. Key the
      map by `normalizeRemote(repoUrl)` so the SSH and HTTPS spellings are one repository.
      Verify: `bun test packages/db/test/settings-store.test.ts`.
- [x] 3.2 Reject a save that names a configured suite without a location — AC-977. Verify: the
      same suite, a rejected update leaves the stored value untouched.
- [x] 3.3 Expose read and write over the API alongside the existing settings endpoints. Verify:
      `bun test apps/api/test` — the round trip returns what was saved.
- [x] 3.4 Add the Settings section: the repositories with a profile set, the profile in force,
      controls to change and to remove, and the explicit empty state — AC-975, AC-976, AC-978,
      AC-979. Verify: `bun run --cwd apps/web test src/components/spec-conventions-section.test.tsx`.

## 4. The ledger line (REQ-1703)

- [x] 4.1 Carry the resolved profile into `LedgerSnapshot` and render one `## Task` line beside
      `Harness coverage`, naming the suite's location and convention, or saying plainly there is
      none — AC-1707, AC-1708. Verify: `bun test packages/runner/test/ledger.test.ts`.
- [x] 4.2 Pin that no suite content reaches the prompt — AC-1709. Verify:
      `bun test packages/runner/test/prompt.test.ts` — the assembled prompt for a task in a
      repository with a suite contains the location and no text from the suite's files.

## 5. What the planner does with it (REQ-1704)

- [x] 5.1 Add the grounding section to `roles/planner.md`: under an OpenSpec suite, name the
      requirements the request touches by ID in the brief and write `specs/` as a delta against
      them; under a configured suite, the same under the owner's note; under none, unchanged —
      AC-1710, AC-1711, AC-1712, AC-1713. Verify: inspect `roles/planner.md` — each of the three
      profiles has an instruction, and the none case says not to invent identifiers.
- [x] 5.2 State the ID-allocation convention the planner follows, and that a collision between
      two concurrent tasks is caught by the repository's own lint rather than prevented here
      (design.md — Risks). Verify: inspect `roles/planner.md`.

## 6. The stage that never goes away (REQ-1705)

- [x] 6.1 Pin that no profile changes the pipeline: the specifying stage and the rest of the
      spine are present under every profile, and no node gains a condition reading the profile —
      AC-1714. Verify: `bun test packages/core/test/pipeline.test.ts`.
- [x] 6.2 Walk a task in a repository with no suite from draft to the specification gate and
      confirm the gate carries a specification — AC-1715. Verify:
      `bun test apps/orchestrator/test/e2e.test.ts`.

## 7. Closing out

- [x] 7.1 Run the suite and the spec gates. Verify: `bun run ci`.
