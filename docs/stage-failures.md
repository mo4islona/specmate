# Stage failures — a wrong run, and a good run the harness declined

This is a working note, not a change. It records a class of defect found while watching real
runs: a stage ends badly, and the harness does the same thing regardless of why — discard the
tree, drop the session, run the same prompt again, say nothing to the agent about what was wrong
with the last one.

The change that closed it is `openspec/changes/archive/2026-08-29-recoverable-stage-failures`.
This note keeps the analysis and the arithmetic; the vocabulary itself is in the code, and the
behaviour it settled is in the living specs.

## 1. The distinction the harness did not draw

A stage attempt ends badly in one of two ways.

Either **the run was wrong** — it timed out, it crashed, it left nothing, it wrote an envelope
that does not parse, it reported its own failure. Its reasoning is what failed, and a retry that
inherits it inherits the fault. This is the case REQ-209 was written for.

Or **the run was fine and the harness declined it** — the artifacts are complete and correct, and
a check the harness runs afterwards found a named, mechanical defect in how they were handed
over. Nothing about the reasoning is suspect. What the agent needs is the finding, not a blank
slate.

Both took the same path, because nothing in the code said they differ.

## 2. What that cost, per node

Two caps nest. The runner tries an attempt twice (`MAX_ATTEMPTS`,
`packages/runner/src/executor.ts`); the engine dispatches a failed stage again up to
`STAGE_ATTEMPT_CAP`, which defaults to 2 (`apps/orchestrator/src/index.ts`). Nothing is wrong
with either number on its own — they exist so an agent and a check that disagree get a second
try.

Multiplied, one node can spend **four full provider runs** on one defect. Each of the four is a
cold start: the working tree is taken back to the last stage commit, the session is dropped, and
the prompt assembled for the next attempt is byte-identical to the one that produced the
failure — the ledger has sections for the task, the plan, the loops, the previous review round,
interventions and gate comments, and none for "your last attempt was rejected, here is why".

So the cost is not paid on the failures. It is paid on re-running work that was already correct,
blind, at full price, up to three more times.

## 3. Where the vocabulary lives

`FAILURE_KINDS` in `packages/core/src/failures.ts` is the canonical list. It carries, per member,
whether the run produced a result and whether re-running it can change the outcome, plus the
sentence a reader is shown instead of the identifier. Every branch that treats one failure
differently from another reads those properties rather than deciding for itself, and a member
added without them does not compile.

This note does not repeat the members; a list in prose is the second source that goes stale.
What was there before was three of them: `RunFailure`, `StageFailure` and `ConversationFailure`,
as bare unions of string literals in two files, already drifted apart — the conversation list
carried two members neither of the others had and lacked two the stage list did.

## 4. The cases that produced this note

**A pinned runner image stopped resolving.** A task pins its image by digest at first provision
(REQ-802). A digest addresses content, which makes it a stable reference only where that content
is still present: where the image is not resolved through a registry, the pin holds until the
image it names is superseded, and then names nothing. Every later stage of such a task dies
before its container starts, and no rebuild reproduces the digest — so the task cannot recover on
its own, because the pin is stored state rather than something a run re-derives.

**That failure was recorded against the provider.** `docker run` exits 125 when the client cannot
start the container at all. The stage recorded `provider_error` — "provider exited 125 and left
no RESULT.json" — for a provider that never ran, sending a reader to the wrong logs.

**A planner was failed for naming its own change folder.** The write-scope check compares what a
run touched against the change folder as the workspace currently names it, and the folder only
takes its declared name once the declaring stage is accepted. A planner that did what
`roles/planner.md` describes wrote `openspec/changes/<declared>/proposal.md` and was failed as
having modified product code. Its proposal was correct.

**Every one of those retries started from nothing.** See §2.

## 5. Status

Closed by `recoverable-stage-failures`, archived, its deltas merged into `agent-execution`
(REQ-208, REQ-209, REQ-216, REQ-217), `execution-environment` (REQ-802) and `task-lifecycle`
(REQ-613):

- A pin is verified before it is used, and an unresolvable one is recovered by a re-pin recorded
  on the task (REQ-802).
- A run that never started is its own reason, carrying what the runtime said (REQ-216).
- The write-scope check accepts the change folder a declaring role's own result named (REQ-208).
- A retry is told what its predecessor was rejected for, and may continue that attempt's session
  where the rejection was mechanical (REQ-217, REQ-209).
- A failure re-running cannot change does not spend the cap (REQ-613).

Left deliberately open, each named as a non-goal in the change:

- The pin is still not resolved through a registry. Doing so would make it resolvable by
  construction; the recovery path stays worth having either way, because an image can be absent
  for reasons a registry does not fix.
- Only the image is recovered. An unavailable toolchain version is a different failure with a
  different remedy, and no live task has hit it.
- Neither cap moved. The caps were never the problem.
