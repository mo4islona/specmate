## Context

See proposal.md — Why. What exists, and the seams this change has to fit:

- `FEATURE_BUGFIX_PIPELINE` already declares `planning` → `kickoff_brief` →
  `human_kickoff_gate`, the gate's `approve: 'research'` and its
  `redirect: { target: 'planning', cap: 'max_kickoff_regenerations' }` (default 2, enforced by
  `countRedirects`). None of it is reachable: `assemblePrompt` throws
  `RolePromptMissingError` for the missing `roles/planner.md`, which fails the stage.
- The planner's role contract writes `['proposal']` and reads `[]`. Prompt assembly injects
  exactly the kinds a role declares it reads, so today the brief stage would receive the role
  prompt, an empty change folder, and the ledger.
- The change folder is scaffolded by the workspace manager on provision (`.openspec.yaml` with
  the schema marker), so no stage has to create it.
- `tasks` has `title` (text) and no description; `CreateTask` accepts title, type, repoUrl,
  baseBranch. The ledger renders title, slug, type, repo, branch, status, harness status, caps,
  and the last review round.
- `Engine.redirect` records the comment as `feedback` of kind `redirect` and transitions to
  `planning`; nothing reads that feedback back.
- The executor already runs a post-run check before committing — `checkWriteScope` — and fails
  the attempt when it trips, which is the shape the brief check reuses.
- `decision-records` (in flight) supplies the non-blocking decision, the dismissal outcome, and
  the generated decision log; REQ-1304 here is written against that text.

## Goals / Non-Goals

**Goals:**

- A task can be launched and reach its first human gate without anyone touching the admin CLI.
- The owner's words — the request at launch and the comment at a gate — become first-class task
  state that every later stage receives, instead of dying in the `feedback` table.
- What the brief must contain is enforced where it cannot be forgotten, and nothing about
  whether the brief is *good* is enforced anywhere but at the gate.

**Non-Goals:**

- Making the planner smart about scope. Deciding a task is too large is the owner's call on the
  card; the split-into-two-tasks machinery is the harness-probe change.
- Reworking the gate mechanics. Approve, redirect, rework, and their caps already exist and are
  specified; this change only supplies what the redirect carries and what approval resolves.

## Decisions

### IDs stay within capability bands

Per the `openspec-standard` skill: the new `kickoff-brief` capability claims band 1300
(REQ-1301–REQ-1305, AC-1301–AC-1314) in `openspec/id-bands.yaml`; modified requirements keep
their IDs (REQ-202, REQ-303, REQ-903, REQ-1001) and their new scenarios take the next free
numbers in their own band — AC-224/AC-225 in agent-execution, AC-326 in persistence, AC-925 in
operator-ui, AC-1026 in task-surface. The new operator-ui requirement is REQ-913 with
AC-926–AC-928.

### Two planner nodes: one grounds, one presents

The definition ships two stage nodes bound to the same role, and the temptation is to collapse
them. Kept, with the jobs made distinct: `planning` reads the repository and produces the
brief's substance — what the request means here, where the work lands, what is risky, and the
blocking question when the request cannot be placed at all. `kickoff_brief` does not re-read
the repository; it reads the draft and the ledger and produces the page: trimmed to the
ceiling, key points sharpened, questions finalized as decision requests, size and expected
iterations stated.

Merging them would mean editing archived, implemented text — `task-lifecycle` REQ-602 walks a
task "through planning, kickoff brief, research", and REQ-605 sends a redirect back to
planning — and removing a `task_status` enum value for no behavioural gain. Keeping them also
gives the harness probe its home: probing a repository is repository work, so it belongs to
`planning`, and doing it in the same run that writes the owner-facing page would muddle both.
The cost is one extra planner run per task and per regeneration, which is the cheapest stage in
the pipeline.

### The brief is `proposal.md`, and both planner nodes leave a complete one

No new artifact kind: the plan says the brief is OpenSpec's `proposal.md` in its earliest draft
form, and `artifactKindForPath` already maps it. Because both nodes write that one file, the
completeness check is stated over the artifact rather than over the node — *a planner run that
wrote the proposal leaves a complete brief*. `planning`'s output is therefore complete but
rough, and `kickoff_brief`'s is the page. That has a mechanical payoff below.

### The completeness check is role-declared and runs before the commit

The check cannot live in the engine: REQ-612 forbids the engine branching on role or node
identity beyond what the pinned graph declares, and "if the node is `kickoff_brief`, parse the
proposal" is exactly that branch. Nor does it want to live after the commit — a rejected brief
would become the committed state the retry starts from.

So it goes where the write-scope check already is: in the executor, after the run and before
the commit, declared by the role catalog the same way `verifier-stage` declares its
corroboration. Stating it over the artifact rather than the node is what makes a role-level
declaration sufficient — no node key has to reach the runner, and the runner stays
graph-agnostic.

The check is textual and dumb on purpose: the required parts are present, each carries content,
the questions section either lists questions or says there are none, and the document is within
the ceiling (default ~6 000 characters, configured with the runner's other limits). Anything
about merit is the gate's.

### Open questions are non-blocking, and approving the gate resolves them

A blocking question parks the task at the stage that asked, short of the gate — which for the
brief is the wrong shape: the owner would answer a question with no brief to read it against,
and the stage would re-run to produce one. So the brief's questions are raised non-blocking
(`decision-records` REQ-1202): the task reaches the gate carrying them, the card shows brief
and questions together, and each question's REQ-1207 discussion lets the owner clarify it in
the context of that brief before answering what they care to. Creating those discussions starts
no model run until the owner writes.

Approval then resolves the rest as dismissals, so research never starts against an open
question. The implementation is gate-generic — approving *any* gate resolves what the task has
open, and it can only ever find non-blocking decisions there, since a blocking one would have
parked the task before the gate. The requirement here is deliberately narrower than the
implementation: it speaks for the kickoff gate only, and the general rule gets lifted into the
`decisions` capability when a later change needs it.

### The redirect comment travels through the ledger, not through a decision

The regenerating planner has to know why the last brief was rejected. Two channels were
available: mint a decision carrying the comment (a record with an answer and no question), or
put the owner's words in the ledger, which §2 of the plan already describes as holding
"decisions made, iterations count, open questions". The ledger wins — it is task state, not a
question, and the same rendering fixes the latent gap that a reworked implementer cannot see
the rework comment either. REQ-202 is widened to say the owner's own words are ledger content
and are not the agent transcript it still forbids.

### The ask is optional and the title is the fallback

Requiring request text would break the intake contract for a one-line bugfix and force the
owner to write prose to launch "fix the typo in the readme". So the column is nullable, the
form makes it the primary input, and the ledger renders the title as the ask when it is absent.
The brief quality that results from a title-only launch is the owner's trade to make.

## Risks / Trade-offs

- **The split is thin until the harness probe lands.** Two planner runs where one would do, for
  one change's duration. Accepted deliberately: the alternative is churning archived lifecycle
  text now and re-adding a node in the next change.
- **A headings check is satisfiable by an empty-ish brief.** Requiring content under each part
  raises the floor a little; past that the check is honest about what it is, and the gate is
  where a hollow brief gets rejected. The failure mode this actually prevents is the silent
  omission — a brief with no key-points block reads as "nothing risky".
- **The length ceiling can reject a legitimately complex task's brief.** It fails the attempt
  rather than truncating, and the retry has to defer detail to research — which is the intended
  pressure, but a genuinely sprawling task will feel it as friction until the harness-probe
  change gives the owner a split option.
- **Non-blocking questions can be ignored into the pipeline.** Dismissal makes that visible to
  the researcher rather than silent, but an owner who approves everything unread gets research
  guessing. That is the same trade the gate itself makes.

## Migration Plan

One migration: a nullable `description` text column on `tasks`. Nothing backfills; existing
tasks read as launched without a request and their title stands as the ask.

The planner prompt and the role contract's new reads are pure additions — no task in flight is
at a planning node today, because no task has ever been able to enter one.

Ordering: `decision-records` must archive first — and therefore `task-qa` before it — because
REQ-1304 depends on non-blocking discussable decisions and on dismissal being a recorded
outcome. Against the other in-flight changes there is no contention: this change's `persistence`
delta touches REQ-303 (versus REQ-307 and REQ-302/REQ-309/REQ-310/REQ-312), its `task-surface`
delta REQ-1001 (versus REQ-1009/REQ-1011/REQ-1012), and its `operator-ui` delta REQ-903 plus
REQ-913 (versus REQ-912/REQ-914).
