# Design — when the folder gets its name

## The ordering problem

Planning cannot name the folder before the folder exists, because planning writes the proposal
*into* it. The brief is the first artifact of the task and it lands in the change folder; the
declaration that would name that folder comes out of the same run that wrote it.

So there are two names, and the question is only where the seam between them falls.

Provision scaffolds the folder under the task's slug — the provisional name, and the same thing
every task does today. Planning runs, writes its proposal into it, and returns a result declaring
what the change is called. The rename happens **on accepting that stage, before its commit**.

That seam is the one that costs nothing. At that moment the folder is untracked — nothing on the
task branch has been committed yet — so the rename is a directory rename and git never learns
there was another name. The first commit of the task's history has the folder named correctly.
Every alternative seam is worse: renaming after the commit produces a rename commit and leaves
artifact rows pointing at paths that no longer exist; renaming at the next stage's provisioning
leaves the declaring stage's own commit under the wrong name permanently.

The stage that declares the plan is a stage that may not write outside the change folder, and
the rename moves the change folder — so the write-scope check (REQ-208) runs against the folder
the run actually wrote to, before the rename, not after it. The rename is the system's own act,
not the role's.

## When there is no declaration

The name is optional in the plan, and a plan without one is complete. Two reasons: a planning
run that got everything else right should not fail the attempt over a name, and every task that
predates this change has no declaration and must keep working.

Absent a declared name, the name is derived from the title planning did declare — which is the
title written after reading the repository, so it is already a description of the work rather
than the first line of the request. `Keep the Y-axis edge fade and gutter off pie charts` becomes
`keep-the-y-axis-edge-fade-and-gutter-off-pie-charts`. Longer than a name a person would pick,
which is why the field exists for planning to pick one; still an enormous improvement on
`https-github-com-owner-repo-01a0337f`.

If neither is available — no plan at all, which is every task before planning completes — the
provisional slug stands. That is today's behaviour, unchanged.

## Collisions

The repository may already have `openspec/changes/<name>`: another SpecMate task's, or one a
person wrote by hand. Two tasks converging on one folder would have them writing over each other,
and the second would silently adopt the first's artifacts.

The rule is that the *folder creation* is where a collision is observable, and it resolves it
there: if the target name is taken by anything that is not this task's own folder, the task's
short identity is appended — the same eight characters already on the end of its slug. Names stay
readable in the ordinary case and stay unique in every case, without a uniqueness constraint on a
column that could not enforce it anyway (the truth is the repository's filesystem, not our
database).

## Where the name is read from afterwards

The declared name lands on the task row with the rest of the plan outcome. Every consumer already
reads the folder from the workspace it was handed (`Workspace.changeDir`), so the only code that
needs to know about the column is the provisioning that builds that workspace. This is what keeps
the change small: the folder's name has exactly one source, and it already flows everywhere from
there.
