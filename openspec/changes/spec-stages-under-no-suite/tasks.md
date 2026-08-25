Design decisions are referenced as D1–D7 and requirements by ID; neither is restated here.

## 1. The condition machinery

- [x] 1.1 Widen an input fact to a number or a boolean, make `NodeCondition.threshold` optional,
      and have `PredicateSpec` declare whether it takes one — D2. Verify:
      `bun run vitest run packages/core/test/pipeline.test.ts`.
- [x] 1.2 Reject at load a condition supplying a threshold to a predicate that takes none, and one
      omitting a threshold a predicate needs — D2, REQ-409. Verify: same command; two fixture
      catalogs fail to load, each naming the offending node.
- [x] 1.3 Allow a condition on a gate node, and extend the load-time predicate and circularity
      checks to cover gates — REQ-409, D4. Verify: same command; a fixture gate whose predicate
      reads its own outcome fails to load.
- [x] 1.4 Add the `specSuiteInForce` input fact and the predicate reading it, whose reason names
      the repository having no specification suite — REQ-1706, D3. Verify: same command.

## 2. The catalog

- [x] 2.1 Put the condition on `specify`, `spec_review` and `human_spec_gate` in
      `FEATURE_BUGFIX_PIPELINE`, leaving `spec_review`'s existing scenario-floor condition in force
      alongside it — REQ-1706, AC-1718. Verify: same command; both profiles still load, and the
      compact profile still drops `spec_review` without stranding an edge.
- [x] 2.2 Invert the three tests pinning the removed REQ-1705 in
      `packages/core/test/pipeline.test.ts` — they now assert that the spine excludes the
      specification segment, that a predicate may read the convention, and that the fact exists —
      REQ-602, REQ-1706. Verify: same command.
- [x] 2.3 Pin that the kickoff gate and the final gate carry no condition in any shipped profile —
      AC-643. Verify: same command.

## 3. Dispatch

- [x] 3.1 Assemble `specSuiteInForce` from the task row at dispatch, not at pin time — AC-1719,
      D3. Verify: `bun test apps/orchestrator`; a task whose profile is set between its kickoff
      gate and its specifying stage skips or runs according to the value at dispatch.
- [x] 3.2 Skip a gate whose predicate does not hold: advance along its approve edge, present
      nothing to the owner, record no decision, record the skip with its reason — AC-429, D4.
      Verify: same command.
- [x] 3.3 End-to-end over a pinned graph: a task under the profile none walks kickoff gate →
      implement with all three nodes skipped, and a task under a suite walks all three — AC-1716,
      AC-1718, AC-642. Verify: same command.

## 4. Edges into a skipped node

- [x] 4.1 Refuse a gate command whose rework or redirect target was skipped on this task's walk,
      naming the target — REQ-411, D5. Verify: `bun test apps/api`.
- [x] 4.2 Keep approve and reject available on a gate all of whose loop edges were suppressed —
      AC-431. Verify: same command.
- [x] 4.3 Filter the gate's rework targets in `task-screen.tsx` by what the walk skipped, and leave
      them intact for a task that ran the target — AC-430, AC-432, D5. Verify:
      `bun run --cwd apps/web test`.

## 5. The brief's acceptance list

- [x] 5.1 Have the planner role write an acceptance list under the profile none, in the scenario
      shape D6 fixes, and not write one under any other profile — REQ-1302, AC-1326, AC-1327.
      Verify: inspect `roles/` for the planner prompt; the instruction is conditioned on the
      profile the ledger already carries.
- [x] 5.2 Extend REQ-1303's mechanical completeness check to the acceptance list under the profile
      none, failing the attempt on an absent or empty one — AC-1328. Verify: `bun run test:bun`
      over the brief check's suite; a fixture brief with an empty list fails naming it.
- [x] 5.3 Confirm the check stays silent about the list under a suite — AC-1327. Verify: same
      command.

## 6. Validation's inventory

- [x] 6.1 Read the scenario inventory from the acceptance source the profile selects, with one
      parser over both files — REQ-1102, AC-1114, D6. Verify: `bun run test:bun` over the
      verification suite.
- [x] 6.2 Fail the stage attempt on an acceptance source declaring no scenario, rather than
      corroborating an approve against it — REQ-1103, AC-1115, AC-1720. Verify: same command.
- [x] 6.3 Confirm a task that ran the specifying stage still corroborates against the change's
      specs, unchanged — AC-1105, AC-1106, AC-1107. Verify: same command.

## 7. Closing out

- [x] 7.1 Full suite green — `bun run test`, `bun run typecheck`, `bun run lint`.
- [x] 7.2 `bun run spec:validate` and `bun run spec:lint` pass over the change.
- [ ] 7.3 Walk a task in a repository with no suite against a live instance and read the rail: the
      three nodes present, marked skipped, each carrying its reason — AC-1717, AC-644.
