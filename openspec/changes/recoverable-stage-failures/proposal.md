## Why

Roadmap phase: operational hardening of Phase 5's execution path, alongside `codex-provider`.

Four failures observed in production this week share one shape: the stage was failed for
something the run itself did not do, and the harness then paid a full cold re-run — sometimes
four of them — to arrive at the same place.

**The pinned runner image stopped existing.** A task pins its image by digest at first provision,
and REQ-802 makes that binding. But the image is built on the deployment host and published
nowhere, so under Docker's containerd image store the pinned digest is a manifest digest that
lives on exactly one machine. A deploy that rebuilds the image moves the tag and the old manifest
is collected. Every stage of that task then dies before its container starts:

```
Unable to find image 'specmate/runner-universal@sha256:85ebb7e8…' locally
docker: Error response from daemon: pull access denied for specmate/runner-universal,
        repository does not exist or may require 'docker login'
```

It cannot be undone by rebuilding — a digest is a content address, and the image is built from a
moving base with packages from a mirror, so no rebuild reproduces it — and there is nothing to
re-tag, because the manifest is gone rather than dangling. `repinEnvironment` was written for
exactly this and has no caller outside tests, so the only cure is an `UPDATE` against the
database.

**That failure was attributed to the provider.** `docker run` exits 125 when the client cannot
start the container at all. The stage recorded `provider_error` — "provider exited 125 and left
no RESULT.json" — for a provider that never ran, sending a reader to the wrong logs.

**A planner was failed for naming its own change folder.** The write-scope check compares what a
run touched against the change folder as the workspace currently names it, and the folder only
takes its declared name after the declaring stage is accepted. A planner that follows
`roles/planner.md` — "`change` … names the folder every artifact of this task is written into" —
writes `openspec/changes/<declared>/proposal.md` and is failed as having modified product code.
Its proposal was correct. The prompt never states the provisional path as an instruction; it
appears only as a `<slug>` placeholder in the result examples and as a heading over an existing
artifact.

**And every one of those retries started from nothing.** A rejected attempt's work is discarded,
its session is dropped, and the next attempt receives a prompt identical to the one that failed —
the ledger has sections for the task, the plan, the loops, the previous review round,
interventions and gate comments, and none for "your last attempt was rejected, here is why". An
agent told nothing has no reason to behave differently, so a mechanical defect is re-rolled at
the cost of re-reading the repository. With the runner's own cap of two attempts inside an engine
cap of two dispatches, one node can spend four full runs on it.

The common defect is that the harness does not distinguish a run that was wrong from a run that
was fine and got rejected — and treats both as reasons to start over blind.

Nothing records the distinction, either. The failure vocabulary exists as bare unions of
identifiers — `RunFailure` and `StageFailure` in the runner, and `ConversationFailure`, a second
copy that already carries members neither of the others has and lacks two they do. The properties
that separate these failures — whether the run produced a result at all, whether re-running it
can change anything — are written down nowhere: not in a spec, not in a doc, not in the code that
branches on them. The thread renders whichever identifier arrives, which is why a stage that was
failed for naming its own folder reads as `scope violation` and nothing else.

## What Changes

- `execution-environment`: a pin is verified before it is used. Where the pinned runner image
  cannot be resolved on the host that must run it, the environment is re-pinned to what the
  deployment now runs and the substitution is recorded on the task. The pin keeps its meaning
  wherever it still holds: a resolvable pin is never re-pinned, and a mid-task change of the
  default image still does not reach a task whose own image is intact.
- `agent-execution`: a run that never started is reported as a failure of the backend rather than
  of the provider, with the detail the runtime actually gave.
- `agent-execution`: the failure vocabulary becomes one table carrying, per member, whether the
  run produced a result and whether re-running it can change the outcome. Every branch below
  reads those properties from it rather than re-deciding them, and a member added without them
  does not compile.
- `agent-execution`: the write-scope check accepts the change folder the run's own result
  declared, for a role whose contract is to declare one. Writing the artifact under the name it
  is about to be renamed to stops being a violation.
- `agent-execution`: a retry is told what was rejected and why. A rejection that names a
  mechanical defect in an otherwise complete run may continue that attempt's session; a failure
  that impugns the reasoning itself still starts cold, which is what REQ-209 protects and this
  change keeps.
- `task-lifecycle`: a failure no retry can fix does not spend the retry cap. Re-running a stage
  whose container could not be started is the same run again.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `execution-environment`: the pin is verified before dispatch, and an unresolvable one is
  recovered by a recorded re-pin.
- `agent-execution`: a failure to start the run is its own reported reason; the write-scope check
  knows about a declared change folder; a retry is told why its predecessor was rejected and,
  where the rejection is mechanical, continues its session.
- `task-lifecycle`: the retry cap is spent only on failures a retry could plausibly fix.

## Impact

- `packages/runner`: the backend answers whether an image reference resolves and whether the
  process it ran was the provider or a client that never got that far; the write-scope check
  takes the declared change folder; a rejected attempt's session and rejection travel out of the
  executor instead of being dropped.
- `packages/workspace`: `repinEnvironment` gains its production caller.
- `apps/orchestrator`: dispatch verifies the pin and re-pins through the workspace service; the
  rejection of the previous attempt reaches the next one's ledger; the cap check consults whether
  the failure is retryable.
- `apps/web`: a failure renders the sentence its table entry carries instead of its humanized
  identifier. `task.environment_repinned` is already in the thread's vocabulary.
- `docs/stage-failures.md`: a working note in the shape `docs/autonomy-gaps.md` established,
  keeping the analysis behind the table — the class of defect, what it cost per node, what closed
  it. The table stays canonical; the note points at it rather than restating it.
- `roles/planner.md`: says which folder to write into and that the declared name is applied by the
  system, so the prompt and the check agree.
- Tasks whose pin still resolves are untouched, which is every task on a host that has not
  rebuilt its runner image.

## Non-goals

- Publishing the runner image to a registry. That would make the pin resolvable by construction
  and is the better long-run answer, but it needs a registry, credentials on the host, and a
  change to how deployment builds. `design.md` records why the recovery path is worth having even
  after a registry exists.
- Reproducible image builds. Pinning the base by digest and the apt set by version would narrow
  the window, not close it: the recovery is needed whenever the image is absent for any reason.
- Retaining superseded images on the host. Worth doing as deployment hygiene; it is a discipline
  rather than a mechanism, so the code that has to run anyway cannot rely on it.
- Re-pinning toolchains. Only the image is recovered. An unavailable toolchain version is a
  different failure with a different remedy, and no live task has hit it.
- Renaming the change folder earlier than it is renamed today. The convergence point established
  by `plan-named-change-folder` is deliberate and stays; this change makes the check agree with
  it rather than moving it.
- Feeding a *successful* stage's own critique back into itself. The feedback added here is the
  harness's rejection of an attempt, not a new review loop.
- Raising or lowering either attempt cap. The caps are right; what they were being spent on was
  not.
