## Context

See proposal.md — Why. What shapes the approach is where the folder is written from today, and who
reads it afterwards.

Provisioning scaffolds `openspec/changes/<name>/` into the working tree and writes the schema
marker; the change-name convergence renames it once planning declares a name; `commitStage` runs
`git add -A`, so the folder enters the first commit that happens; `indexChangeFolder` then reads the
commit with `ls-tree` and records each artifact with its git object and a display snapshot bounded
by `snapshotLimitBytes`. Everything else reads one of those two: prompt assembly and the validating
stage's inventory read the folder from the workspace, the API serves the stored snapshot as artifact
content, and publication reads `summary.md` out of the branch.

Three constraints follow. A stage container mounts the task's worktree and nothing else, so anything
a role reads or writes has to be inside it. `git status` never reports an excluded path, so a folder
kept out of commits is invisible to every check that asks "what did this run change". And the
profile is re-read at every node by design (REQ-1706), so it cannot also be what decides where
artifacts live.

## Goals / Non-Goals

**Goals:**

- One object states what a profile implies, and callers read it instead of testing the profile.
- One value per task decides where its change folder is, and every path derives from it.
- The checks that keep a stage honest — write scope, brief completeness, the declared name — read
  the same thing they read today, whether or not git reports it.
- An out-of-tree folder is reconstructible: the store holds it, and a rebuilt working tree gets it
  back before the next stage.

**Non-Goals:**

- A second store. The database already carries artifact rows; this change makes them complete for
  the half git no longer holds, and adds no new place to look.
- Changing anything for a repository whose profile is an OpenSpec suite. Same folder, same commits,
  same index, same PR.
- Making the change folder's location configurable. Two layouts, decided by the profile, and nothing
  in between.

## Decisions

### D1 — A profile has an implementation, and callers read it

`SpecImplementation` states, for the profile in force: which layout the task's artifacts take,
whether the repository keeps them, whether the specification segment runs, where the living suite is
and what convention governs it, and which standard a spec-touching role is given — the house one,
the sentence the owner wrote, or none. It is derived from `SpecConvention`, holds no I/O, and lives
beside it in `core`.

The alternative is what the code does today: each caller tests `profile === 'openspec'` for its own
purpose. That is how the pipeline's condition, the ledger's rendering and the folder's location came
to be three separate readings of one fact, and adding a fourth for the layout would have set the
pattern in stone. `specSuiteInForce` stays as the null-tolerant reading the engine needs, and
delegates rather than repeating the rule.

### D2 — Where a task's artifacts live is pinned on the task, not derived per stage

`tasks.change_layout` holds `repository` or `internal`, written once at first provisioning, guarded
on the column still being null the way `base_branch` already is.

Deriving it from the profile at each provisioning was the obvious alternative and is wrong: REQ-1706
deliberately re-reads the profile when the task reaches each node, so an owner answering mid-task
would move a folder that already holds artifacts, and the index would end up carrying one task's
work under two paths. Deriving it from what the index already records fails for the opposite reason
— the index is empty exactly in the window where the folder is first scaffolded.

The column holds the layout rather than the path it maps to: a path is data that a later change
would have to migrate, a layout is the decision that outlives it.

### D3 — Out of tree means inside the worktree, under the scratch exclusion

The internal layout puts the folder at `.specmate/changes/<name>/`, inside the working tree. A stage
container mounts the worktree alone, so a host directory beside `memory/` — which is where a store
of this shape would otherwise go — is unreachable from the run that has to write it. `/.specmate/`
is already in the mirror's `info/exclude` under REQ-707, so nothing new keeps it out of commits, and
the exclusion needs no per-profile branch.

A parallel git ref in the mirror was considered and dropped: it buys durable history for artifacts
the database already stores, and costs a ref to write, prune, and reconcile with the index.

`changeDir` takes the layout rather than a root, so a call site names the decision and the mapping
lives in one table. The convergence logic, the scope check, and the diff's spec/code split all read
the folder path they are given, and keep working unchanged under either layout.

### D4 — The store is authoritative; the working tree is a cache of it

Provisioning restores an out-of-tree folder from the artifact index before any stage or conversation
response runs, and the scaffolding step re-creates the schema marker as it does today. The decision
log already works exactly this way — it is rewritten from the store before every dispatch precisely
so a rebuilt tree cannot lose it — and this generalises that to the rest of the folder.

Two consequences are deliberate. The display ceiling on stored content applies only where git holds
the truth; an out-of-tree artifact is stored whole, because a truncated only-copy is not a store. And
a file in the folder whose kind is outside the artifact catalog has no store and does not survive a
rebuilt tree: the catalog is what decides what an artifact is, which is already true of the index.

### D5 — Indexing follows the stage, not the commit

`commitStage` returns early today when nothing was committed, and indexing hangs off that. It moves
out: the stage's artifacts are indexed either way, and the commit — where there is one — supplies
the git object. In-tree artifacts are still read from the commit with `ls-tree`, so a commit's
contents remain what is indexed for them; out-of-tree artifacts are walked from the folder. The
deletion sweep runs in both, so an artifact a stage removed leaves the index under either layout.

A `none` task's planning stage therefore produces no commit at all, and that is the point: its
branch carries product code or nothing.

### D6 — What a run changed includes the out-of-tree folder, compared against the store

`changedPaths()` is `git status --porcelain -uall`, and three readers depend on it: the write-scope
check (REQ-208), the brief-completeness check (REQ-1303), and the declared-name convergence. An
excluded folder is invisible to all three, and the failure is silent in the worst direction — a
planner run that wrote only the brief reports nothing changed, so the completeness check reads as
not applicable and the brief reaches the gate unchecked.

So the path list gains the out-of-tree change folder, and only that folder — never the rest of
`.specmate/`, or every stage would fail its own scope check on its logs. A file is reported when its
content differs from what the store holds for it, or when the store holds nothing for it. Reporting
the whole folder would be simpler and wrong: the folder is restored before the run, so every
restored file would read as this run's work.

### D7 — Publication reads the summary from the store

`readSummary` runs `git show <branch>:openspec/changes/<slug>/summary.md`; out of tree there is
nothing to show. It reads the summary artifact from the index instead, which serves both layouts and
drops a path that was already wrong for any task whose folder converged on a declared name — the
path interpolates the slug, not the name the folder took.

### D8 — A workspace a caller cannot name is not discarded

`discard` resets and cleans a working tree, and it takes the path from the workspace it is handed.
Handed something that is not a workspace, it ran `git reset --hard` and `git clean -fd` in whatever
directory the process happened to be in. The signature that carries the task through it is new in
this change, which is exactly the kind of edit that leaves an old caller passing the wrong shape, so
the guard is part of the change: a discard whose workspace names no absolute path, or a path that is
not a checkout, fails instead of running.

### D9 — Nothing moves for a task that already has a folder

The migration backfills the layout of every task that has already left `draft` — which is what
provisioning follows — to `repository`. A draft has no working tree yet, so it keeps a null layout
and picks up the rule on its first provisioning. No file is moved, no branch is rewritten, and a
task in flight keeps the folder it has.

## Risks / Trade-offs

- **A `custom` or `none` task's pull request no longer carries the brief, the decision log, or the
  summary as files.** → The summary is still the pull request's body, and the artifacts stay
  readable in SpecMate for as long as the task exists. An owner who wants them in the repository
  says so by setting the profile to `openspec`, which is what that profile now means.
- **The database becomes the only copy of an out-of-tree artifact.** → They are markdown documents
  of a few tens of kilobytes, the brief is already bounded by REQ-1302, and a restore is a `SELECT`
  over one task's rows. The exposure is a database loss, which loses the task itself anyway.
- **Two layouts to keep in step.** → One pinned value decides it and every path derives from it;
  after this change no code builds a change path from a literal.
- **A task can reach implementation with an empty branch.** → Already handled: the diff answers
  "this task has not committed any changes yet" (AC-1035), and the files surface renders that.
- **A restore could overwrite what a role wrote.** → It runs at provisioning, before the stage, on
  the same ordering the decision log already depends on.

## Migration Plan

1. One migration adds `tasks.change_layout` and backfills every already-provisioned task to
   `repository`.
2. Deploy. Tasks already provisioned keep their folder and their commits; tasks provisioned
   afterwards against a `custom` or `none` repository write nothing into the tree.
3. Rollback is the code, not the data: reverting makes every task in-tree again, and an out-of-tree
   task's artifacts stay in the database — its branch simply never carried them. The column can be
   left in place.
