## 1. Result contract

- [ ] 1.1 Add a `returnsVerdict` flag to `RoleContract`, set for reviewer and verifier, and drop the "reviewer-only" annotation from `StageResult.verdict` — REQ-104 (verify: `bun run typecheck`; `ROLE_CONTRACTS` marks exactly those two roles)
- [ ] 1.2 Validate results against the flag: a result from a `returnsVerdict` role without a verdict, and a `revise` whose finding set is empty after derivation, are invalid results feeding the existing retry-then-escalate flow — REQ-104, AC-122 (verify: `bun test packages/core` — verdict-less verifier result rejected naming the role; verdict-less researcher result still accepted)

## 2. Verification module in `packages/core`

- [ ] 2.1 Implement the scenario inventory: extract `#### Scenario:` headers from a change folder's `specs/**/*.md`, keyed by exact header text, duplicates collapsed (verify: `bun test packages/core` — fixture change folder yields the expected inventory)
- [ ] 2.2 Implement the matrix parser: the table under the `## Matrix` heading of `verification.md` into scenario → assertion → outcome (`pass`/`fail`/`uncovered`) rows, tolerant of alignment and column whitespace, strict about heading and column set; an unreadable matrix is a parse failure, not an empty one — REQ-1102 (verify: fixtures for a clean table, a sloppily aligned table, a missing heading, a wrong column set)
- [ ] 2.3 Implement `corroborate(inventory, matrix, verdict)`: approve passes only when every scenario is covered with all-pass outcomes; violations name the offending scenarios; non-approve verdicts pass through — REQ-1103, AC-1105–AC-1107 (verify: table-driven tests — corroborated approve, uncovered scenario, absent scenario, failing outcome, honest revise)
- [ ] 2.4 Implement scenario-finding derivation: one finding per failing or uncovered scenario with an identifier deterministic from the scenario's identity, merged with the agent's own findings without duplication — REQ-1104, AC-1108, AC-1109 (verify: test — same fixture yields identical identifiers across two runs; agent finding with an unrelated id survives the merge)

## 3. Executor enforcement in `packages/runner`

- [ ] 3.1 Run corroboration in the executor after the run for roles the catalog declares, before the outcome is accepted: an uncorroborated approve fails the attempt naming the scenarios, and nothing is committed — REQ-1103, AC-1106, AC-1107 (verify: `bun test packages/runner` — stub run returning approve with an uncovered scenario fails; the workspace commit hook is never reached)
- [ ] 3.2 Attach derived scenario findings to non-approve verifier outcomes so the recorded round carries them — REQ-1104, AC-1108 (verify: test — stub revise run with a failing matrix row surfaces the derived finding in the parsed outcome)
- [ ] 3.3 Keep non-verifier roles untouched by the new checks (verify: test — a reviewer outcome with findings and no matrix passes the executor unchanged)

## 4. Role prompt

- [ ] 4.1 Rewrite `roles/verifier.md`: verdict and scenario-keyed findings in `RESULT.json`, the exact `## Matrix` format with an example, the run-twice rule for a failing assertion, and uncovered-plus-decision for what cannot be exercised — REQ-1101, REQ-1102, REQ-1105, AC-121 (verify: prompt names the same outcome vocabulary the parser accepts; no remaining claim that the verdict lives in `verification.md`)

## 5. End to end

- [ ] 5.1 Walk one verify stage through executor and corroboration with the stub provider: an honest revise is accepted with its derived findings, a dishonest approve fails the attempt — AC-1105, AC-1106, AC-1108 (verify: `bun test packages/runner` — both paths asserted in one fixture pair)

## 6. Validation

- [ ] 6.1 `bun run ci` passes (verify: command exits zero)
- [ ] 6.2 `openspec validate --changes verifier-stage --strict` passes (verify: command exits zero)
