## 1. Vocabulary

- [x] 1.1 Define the role catalog with reads, writes, code permission, skill injection, default provider, and prompt file (verify: `packages/core/src/roles.ts`)
- [x] 1.2 Define the provider identifiers and artifact kinds shared with the database schema (verify: enums in `packages/db/src/schema.ts` match)
- [x] 1.3 Implement cross-provider reviewer selection with single-provider degradation (verify: `packages/core/test/result.test.ts`)

## 2. Result contract

- [x] 2.1 Define the `RESULT.json` schema with a version literal and defaulted optional fields (verify: `packages/core/src/result.ts`)
- [x] 2.2 Define decision requests with a stable key, kind, prompt, options, and blocking flag
- [x] 2.3 Define review verdicts and findings with caller-stable identifiers and severities
- [x] 2.4 Implement a parser that returns a readable rejection reason instead of throwing (verify: malformed-JSON and unknown-role tests)

## 3. Provider interface

- [x] 3.1 Define the stage job passed to a provider — workspace, change folder, assembled prompt, skill revision, timeout, attempt (verify: `packages/core/src/provider.ts`)
- [x] 3.2 Define the stage outcome — result, raw log, exit code, duration
- [x] 3.3 Define the provider interface: run a job, report authentication health

## 4. Task lifecycle

- [x] 4.1 Define the task states and the transition table (verify: `packages/core/src/state.ts`)
- [x] 4.2 Mark the three human gates and the terminal states
- [x] 4.3 Define the caps — spec and implementation iterations, kickoff regenerations, repeated-finding threshold — and the budgets, with defaults
- [x] 4.4 Implement transition checking, including interrupt states reachable from any active state

## 5. Verification

- [x] 5.1 Test that every state has a transition entry and every target is a known state
- [x] 5.2 Test the full happy path from draft to archived
- [x] 5.3 Test that review loops go backwards and cannot skip to publication
- [x] 5.4 Test that terminal states reject cancellation and pausing
- [x] 5.5 Test the role catalog invariants: only implementer and verifier write code; spec-touching roles receive the standard
- [x] 5.6 Test result parsing for minimal, malformed, unknown-role, and reviewer-verdict cases
