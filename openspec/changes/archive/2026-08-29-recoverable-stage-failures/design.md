# Design — telling a wrong run apart from a rejected one

Everything here follows from one distinction the harness does not currently draw. A stage attempt
can end badly in two ways. Either the run was wrong — it timed out, it crashed, it produced
nothing, it wrote an envelope that does not parse, it reported its own failure — or the run was
fine and the harness rejected what it handed over, for a reason the run can be told and can fix.
The first deserves a clean slate. The second deserves an explanation and its work back.

Today both take the same path: discard the tree, drop the session, re-run cold, say nothing. The
sections below apply the distinction to the four places it is being paid for.

## Where the distinction is written down

It is not, anywhere. That is not a documentation gap; it is the mechanism of the bug.

The vocabulary lives as three unions of string literals. `RunFailure` holds what a provider run
can end as, `StageFailure` adds what the executor's own checks can decline, and
`ConversationFailure` is a third list assembled independently — it carries `malformed_message` and
`cleanup_failed`, which neither of the others has, and lacks `uncorroborated` and
`incomplete_brief`, which the stage list does. Two copies of a vocabulary that has already drifted
is the ordinary outcome of keeping it as literals in two files.

What none of them carries is any property of a member. Whether the run produced a result, whether
re-running can change anything, what a human should be told — none of it is recorded, so every
place that wants to branch on it either re-derives it or, as today, does not branch at all. The
retry path treats a declined proposal like a timeout because nothing ever said they differ.

So the vocabulary becomes a table: one entry per member, carrying the properties the branches
need, with the unions derived from it. The point is not tidiness. It is that a member added
without deciding whether re-running it can help will not compile, and the next failure reason
someone introduces cannot quietly join the expensive branch by default.

One canonical source, references elsewhere. The specification states the properties normatively —
a run that never started is not a provider failure, a retry is told why its predecessor was
rejected, a failure re-running cannot change does not spend the cap — without enumerating
members, because a list in prose is the second source that goes stale. The working note in `docs/`
keeps the analysis and the cost arithmetic, which is what a person reads when they want to know
why the table looks like that, and points at the table for what is in it.

## The pin that could not be honoured

REQ-802 exists so a task's later stages run on the environment its earlier ones did. Rebuilding
the image under a running task swaps the compiler, the package manager and both provider CLIs
mid-pipeline, and the specification that came out of stage two would then be implemented against
something else at stage six. Recording the image by digest is the right mechanism for that.

What was never true is that the recorded digest is a durable name. Two things must hold for a
digest to be a reference you can return to: it addresses content, and the content is somewhere
you can fetch it from. The first holds. The second does not, because the image is built on the
box and pushed nowhere. Under the containerd image store a locally built image still carries a
manifest digest and still reports a `RepoDigests` entry, so the inspection at provisioning time
hands back something that looks exactly like a registry reference and behaves like one — right up
until the build that produced it is superseded.

The pin is therefore not wrong, it is unbacked. The fix is to stop reading "was immutable when
written" as "is resolvable now".

### Why recover rather than only report

Reporting is the honest minimum: say the pinned image is gone and stop. It is not sufficient,
because the state it leaves cannot be repaired through the product — the pin is a column, and
nothing but SQL can change it. A failure the owner cannot act on ends the task.

Re-pinning costs the thing REQ-802 was written to protect: the task finishes on an image it did
not start on. The trade is worth taking because the alternative is not "the task keeps its image"
— that image does not exist — but "the task dies". Between continuing on what the deployment now
runs and stopping forever, continuing is the weaker guarantee and the better outcome, *provided
the substitution is visible*. That is what makes the recording load-bearing rather than
bookkeeping: a reader of the task thread can see the environment changed under it, and where.

The check is deliberately narrow. It fires only when the pin cannot be resolved, which on a
healthy host is never. It is not a refresh: a resolvable-but-old pin is left exactly as it is,
because that case is still REQ-802's and re-pinning it would be the drift the requirement
forbids.

### Why it survives a registry

Publishing the image would make the pin resolvable by construction and is the better answer to
the root cause. It does not make this path redundant. An image can be absent for reasons a
registry does not fix: a pull that cannot reach the network, an expired registry credential, a
retention policy that dropped an old tag, a host restored from backup. The condition the recovery
rests on — the pin cannot be honoured here and now — is the same in all of them, and so is the
right response. A registry lowers how often this fires; it does not change what should happen
when it does.

### Where the check belongs

Before dispatch, not inside the run. Inside the run it is one more thing that fails after the
container has been asked for, and the diagnosis arrives as a docker error again. Before dispatch
the orchestrator still holds the workspace and the task row, which is what `repinEnvironment`
needs; the runner has neither.

The recovery is the image and nothing else. `resolveEnvironment` also detects toolchains, and it
detects them from the working tree — which at provision time is the base commit and at re-pin
time is the task branch. A task that edits `.tool-versions` is a task whose re-pin would read the
declarations its own unmerged change introduced, and pin itself to them. That is the drift
REQ-802 exists to prevent, so the re-pin carries the task's recorded toolchains across and asks
the backend only to resolve the image and install what the task already has.

Resolution is asked of the backend rather than assumed of docker: the two backends answer it
differently, and the in-process backend has no images at all, so the question has to be one each
backend answers for itself.

### A "no" and an unanswered question

The re-pin drops the guarantee REQ-802 exists for, so it must rest on an answer. "Anything short
of success is no" does not give one: a daemon mid-restart, a socket that refused, a client that
is not installed all look exactly like an image that is gone. Under a deploy — the one moment the
recovery is most likely to fire — they are also the most likely to occur.

So the backend answers three ways, not two: yes, no, and *could not be asked*. Only "no" re-pins.
"Could not be asked" establishes nothing, so the pin is left exactly as it was and the stage
fails with a reason another attempt may still resolve — which is the same distinction the cap
change below rests on, applied one layer earlier.

## A run that never started

`docker run` uses 125 when the client could not start the container, 126 when the entrypoint is
not executable, 127 when it is not there. None of them is the provider's exit code, because the
provider has not run. Today all three land in `provider_error` beside a genuine provider crash,
and the recorded detail reads "provider exited 125", which sends a reader to the provider's logs
for a fault in the runtime.

The separation is a backend concern, so the backend reports it: the exec result says whether the
process that exited was the provider or a client that never reached it. Reading docker's exit
numbering in the stage-run layer would put container semantics into code that also serves a
backend with no containers in it.

The exit code alone cannot make that call, though, and this is the trap the first cut fell into.
`docker run` propagates the container's status and the entrypoint propagates the provider's, so a
provider CLI that shells out to something missing exits 127 through both — and would be recorded
as a runtime fault that spends none of the attempts the disagreement was worth. What separates
them is not the number but whether anything inside the container ran, so the entrypoint says so
before it can fail, and the backend reads that rather than guessing from the status.

This is also the precondition for the cap change below. "The container could not be started" is
the clearest case of a failure that running the same thing again cannot fix, and nothing
downstream can act on that until the failure is named correctly.

## The scope check and a folder that is about to be renamed

`plan-named-change-folder` established the ordering: the workspace scaffolds a provisional folder
named by the task's slug, planning declares what the change is called, and the folder converges on
the declared name when the declaring stage is accepted — before its output is committed, so
nothing is ever committed under the provisional name. That ordering is right and stays.

The write-scope check runs earlier than the convergence, and compares against the folder's
*current* name. So the one stage that is contracted to declare a new name is the one stage whose
correct output can be outside the folder the check knows about. A planner that writes
`openspec/changes/<declared>/proposal.md` — which is what its role file describes — is failed for
modifying product code.

Two fixes were available. Tell the planner to write into the provisional folder and let the
system rename it; or teach the check about the name the result declares. The change does both,
because they answer different halves. The prompt fix removes the invitation: the role file
currently says the change's name "names the folder every artifact of this task is written into"
and never states the provisional path as an instruction, so an agent following it literally is
correct to do what it did. The check fix removes the trap: a role whose contract is to declare a
change name may write under the name it declared, because that is the folder the artifact is
about to live in. Doing only the prompt fix leaves a check that fails correct work whenever an
agent reasons its way back to the same conclusion; doing only the check fix leaves a role file
that describes a folder nobody asked it to create.

The check does not widen further, and the widening is bounded at both ends. The accepted set is
the current change folder plus the one the result declares, only for a role whose contract
declares plans, only while the folder still stands under its provisional name, and never a name
the repository already keeps a change under. The last two are what keep this from re-opening
AC-742: a name declared after the task has converged is not a folder it is about to take, and a
name another change already occupies is a folder convergence will suffix this task away from —
so anything written there would be committed into work that is not this task's.

Convergence had to learn the same thing from the other side. It suffixes when the declared folder
already exists, and after this change the declaring run is allowed to create that folder itself —
so the folder it just wrote its proposal into would read as a collision, the rename would move
the scaffolding somewhere else, and `git add -A` would commit both. The task would then carry on
against the one holding nothing but the schema marker. What separates the two is the same
question as before: a folder the repository already keeps a change under is *tracked*, and a
folder this run created is not. Where the run did create it, the provisional folder is merged
into it rather than moved beside it.

## Telling the retry what happened

REQ-209 already says a retry must not inherit its own failed attempt's conversation, and gives
the reason: a retry reading its own failed reasoning is exactly what the discard exists to
prevent. That reason is sound and this change does not reverse it — it scopes it.

The reason applies when the reasoning is what failed. A run that timed out, produced no result,
wrote an unparseable envelope or reported its own failure has reasoning that should not be
carried forward. A run whose proposal was complete and correct and landed one directory over does
not. Continuing that attempt's session and stating the rejection is not "re-reading failed
reasoning"; it is handing back sound work with a correction, which is what a review round already
does for a different class of defect.

So the split is by rejection, not by convenience:

- **Mechanical rejections** — write-scope violation, an incomplete brief, an approve the report
  does not corroborate, a verdict whose evidence could not be checked. The run completed and
  produced a result; the harness declined it for a named, checkable defect. The retry may continue
  the rejected attempt's session and is told what the defect was.
- **Failures of the run** — timeout, no result, an unparseable result, the agent's own reported
  failure, a backend that could not start. The retry starts cold, as REQ-209 says today.

The fourth mechanical rejection is the one that most nearly went to the wrong side. A corroborated
role's result can clear parsing, scope, self-report and the brief check and still be declined —
no verdict, an approve over an empty scenario inventory, a `verification.md` that is missing or
does not parse. That is a complete result the harness would not accept, which is the definition
above. It cannot share `invalid_result` with an envelope nobody could read, because that member
has to say the run produced nothing; so it is its own member, and the split is visible in the
table rather than decided at the branch.

One thing the retry has to be told besides the defect: the tree was discarded. From inside a
continued session that is invisible — the transcript records writing the artifacts, and they are
gone. An attempt that believes them present writes only the correction and leaves the change
folder half-built, which passes the scope check and gets committed. So the statement says both
what was wrong and that nothing that attempt wrote survives.

The second half — being told at all — is the larger saving and the smaller risk, and it applies to
both classes. The ledger's only feedback channel today is `Previous review round`, which carries a
reviewer's findings. The harness's own rejection has no channel, so a retry after a scope
violation receives a prompt byte-identical to the one that produced it. Adding the rejection makes
the retry directed even where the session is not continued, and it is what turns a coin flip into
a fix.

Where a session cannot be continued the retry still runs cold and still carries the rejection;
degrading to the current behaviour is always available and never silent, which is the same posture
`AC-235` already takes for a session a provider will not fork.

## Not spending the cap on the unfixable

The runner tries twice and the engine dispatches twice, so a node can spend four provider runs.
That budget is for disagreement between an agent and a check — it is well spent on a result that
might parse next time.

It is entirely wasted on a stage whose container could not be started. The second run is the first
run: same image, same host, same missing manifest. Recognising that costs nothing once the failure
is named, and the cap is left alone for everything else — the caps are not the problem, what they
were being spent on was.

This is deliberately limited to failures that are unfixable *by construction*, not to failures
that merely look unlikely to succeed. A timeout might pass on a quieter host; an unparseable
result might parse next time. Those keep their retries. So does a container runtime that did not
answer — which is why the pin check above has to distinguish that from an image that is gone, or
the one member that stops a task early would be reachable from a daemon restart.

The conversation cap reads the same property. It is a separate cap on a separate path, and a turn
run against an image the host does not have goes the same way every time; spending the cap on it
only delays telling the owner.
