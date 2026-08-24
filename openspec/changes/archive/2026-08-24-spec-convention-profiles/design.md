## Context

See proposal.md — Why. What matters for the approach is where the seams already are.

`changeSchema` in `WorkspaceConfig` is a global constant, `'spec-driven'`, written once into the
change folder's `.openspec.yaml` marker and read by nothing. It is the only place the codebase
already admits that a repository might follow a convention, and it is inert.

Provisioning runs before **every** stage, not once per task: `run-stage.ts` calls
`workspaces.provision(...)` and then re-reads the task row, because provisioning already writes
task columns. It is the one place that holds both the checked-out tree and the database.

The ledger is rendered from the database alone — `renderLedgerForTask(db, config, taskId)`, closed
over a task id with no workspace in hand. Anything the ledger says about the tree has to have been
recorded by something that could see the tree.

`harness_status` on `tasks` plus a repository-scoped waiver table is the shape this codebase
already uses for "a property of the repository, assessed once, shown to every stage, overridable by
the owner". This change follows it rather than inventing a second shape.

## Goals / Non-Goals

**Goals:**

- One resolved answer per task, computed where both the tree and the settings are visible.
- The owner's setting takes effect without a redeploy and without touching a running task's
  guarantees.
- Grounding costs the prompt nothing: the ledger gains one line, not a spec suite.

**Non-Goals:**

- Parsing the repository's specification. SpecMate locates it and names its convention; reading it
  is the agent's job, with the tools it already reads code with.
- Making the profile available to roles other than the planner. Nothing stops a later change from
  widening it — the ledger line is visible to every stage already — but no other role's prompt
  changes here.

## Decisions

### The profile is resolved during provisioning and stored on the task

`override ?? detected` is computed in the provisioning path and written to a `tasks` column, the
way `harness_status` is. Provisioning is the only code that sees the working tree and the database
at once, and it runs before every stage, so a setting the owner changes between two stages is
picked up by the next one without any cache to invalidate.

*Alternative — resolve at ledger-render time.* Rejected: the renderer has only a task id and a
database handle. AC-1702 requires knowing whether a configured suite location is actually present
in the tree, which the renderer cannot see. Passing a workspace into the renderer would widen a
signature that four call sites share, to serve one line of output.

*Alternative — store only the detected value and resolve on read.* Rejected for the same reason:
the "configured but absent" case is a fact about the tree, and splitting resolution across two
places means neither one can state it.

### The setting is one `app_settings` row, keyed by repository URL inside it

A single `spec-conventions` row holding a map from normalised repository URL to
`{ profile, suitePath?, conventionNote? }`, updated with the same read-`for update`-then-write
transaction `updateModelDefaults` uses.

*Alternative — a table, like `coverage_waivers`.* That table exists because a waiver has a
lifecycle: who accepted it, on which task, when it was revoked, and a partial unique index keeping
one in force. A convention setting has no lifecycle — it is a current value the owner edits. The
`app_settings` row is the cheaper shape and matches `default-repository`, which is also a
repository-scoped scalar.

Normalising the key with the existing `normalizeRemote` matters: `git@host:org/repo.git` and
`https://host/org/repo` are one repository, and a setting that missed on spelling would be a
silent no-op.

### Detection recognises an OpenSpec root and nothing else

An `openspec/specs/` directory in the checked-out tree. That is the marker that distinguishes a
repository with a living suite from one that merely received a change folder from SpecMate — the
change folder alone creates `openspec/changes/`, so keying on `openspec/` would make every
repository detect as OpenSpec after its first task.

The other-shaped suite is never detected. Guessing where an arbitrary document set lives, and what
its identifiers mean, is a research problem; the owner points at it and describes it in a sentence.

### The profile reaches the agent through the ledger, not a new prompt section

One line in `## Task`, beside `Harness coverage`. REQ-102 fixes the prompt's sources at the role
prompt, the change folder's artifacts, and the ledger; a ledger line adds context without
reopening that. REQ-202 lists what the ledger carries with "including", and `Harness coverage` is
the standing precedent that a repository-scoped assessed property belongs there.

*Alternative — a fifth prompt section holding the suite's text.* Rejected on two counts. It would
change REQ-102, which exists to keep stage inputs enumerable. And a living suite can be far larger
than the change folder — this repository's own is sixteen capabilities — so pasting it would spend
the context window on text the agent can read selectively for itself.

### The planner's instructions branch on the profile, and only the planner's

`roles/planner.md` gains a short section: under an OpenSpec suite, locate the requirements the
request touches and name them by ID in the brief, then write `specs/` as a delta against those IDs;
under a configured suite, do the same under the owner's convention note; under none, behave exactly
as today. No other role prompt changes.

## Risks / Trade-offs

**A planner grounds in a suite that is stale or wrong, and inherits its errors** → The brief already
has to name what it read (`roles/planner.md`, "Grounding the draft"), so a claim resting on the
suite is attributable and the owner sees it at the kickoff gate. The suite is evidence, not
authority.

**ID allocation collides.** Two SpecMate tasks running against the same repository at the same time
can allocate the same fresh requirement ID, because neither sees the other's change folder →
Accepted, and out of scope to fix here. It is the same collision two humans have, and this
repository's own answer is a lint that trips on the duplicate. Named in the specs as a convention
the planner follows, not a guarantee SpecMate enforces.

**The convention note becomes a second prompt nobody reviews.** An owner can put anything in it →
It is bounded and owner-authored, and it reaches only the planner. If it grows into something that
needs review, that is the signal it should have been a role-prompt change instead.

**Detection is wrong for a repository that keeps specs elsewhere but also has an `openspec/specs/`
directory** → The override exists for exactly this, and the ledger line makes the mistake visible
on the first brief rather than at the end.

## Migration Plan

One additive column on `tasks` with a default meaning "not yet determined", and one new
`app_settings` key. Existing tasks keep walking: an in-flight task re-provisions before its next
stage and picks up a resolved profile then; until it does, the ledger line reads as undetermined,
which is what a task pinned before this change honestly is.

No behaviour changes for a repository with no suite — the profile it resolves to is `none`, and
`none` is today's behaviour by construction.

Rollback is dropping the ledger line; the column and the setting are inert without it.
