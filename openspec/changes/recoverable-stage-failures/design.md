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
needs — it re-resolves toolchains against the workspace, so it cannot be called from the runner,
which has neither.

Resolution is asked of the backend rather than assumed of docker: the two backends answer it
differently, and the in-process backend has no images at all, so the question has to be one each
backend answers for itself.

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

The check does not widen further. The accepted set is the current change folder plus the one the
result declares, and only for a role whose contract declares plans. Everything else outside the
folder is still a violation.

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
  does not corroborate. The run completed and produced a result; the harness declined it for a
  named, checkable defect. The retry may continue the rejected attempt's session and is told what
  the defect was.
- **Failures of the run** — timeout, no result, an unparseable result, the agent's own reported
  failure, a backend that could not start. The retry starts cold, as REQ-209 says today.

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
result might parse next time. Those keep their retries.
