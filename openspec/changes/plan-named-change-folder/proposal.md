## Why

Roadmap phase: the tail of Phase 3, alongside `stage-edit-diffs` and `artifact-diff-view`.

A task's OpenSpec change folder is named after the task's slug, and the slug is cut from a title
intake derived before anyone had opened the repository — the first line of the request. When the
request opens with the repository's own URL, which is what the single-field launch form invites,
the folder a whole task's specification work lands in is called
`openspec/changes/https-github-com-owner-repo-01a0337f`. That is not a name. It is in every path
in the run log, every artifact path, every file in the Files view, and eventually in the pull
request the task publishes, where it is the first thing a reviewer reads.

Planning already fixes the half of this that is visible in the UI: it reads the repository and
renames the task (REQ-1306). The slug is deliberately left alone, and REQ-1306 says why — "the
branch and change folder already exist". The branch is internal and can stay ugly forever. The
change folder is published.

This is also the OpenSpec-shaped thing to do independently of the bug. A change's folder name is
supposed to say what the change is; deriving it from a task identifier was always an accident of
which name happened to exist first.

## What Changes

- `kickoff-brief`: planning declares, alongside the title, type, size and prerequisites it
  already declares, the name of the change it is proposing — kebab-case, saying what the change
  is. It is optional: a plan that omits it is complete, and the name is then derived from the
  title planning did declare.
- `workspace-lifecycle`: the change folder is named by that declaration rather than by the task's
  slug. Until planning has declared one, the slug is the provisional name; once it has, the
  folder converges on the declared name — before the declaring stage's own output is committed,
  so what lands in git is named correctly from its first commit rather than renamed in a second.
  A name already taken in the repository does not collide: the task's own short identity
  disambiguates it.
- `persistence`: the task carries the change name its planning declared, so every later stage,
  the publish job, and a re-provisioned workspace all resolve the same folder.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `kickoff-brief`: the plan declaration gains the change's name.
- `workspace-lifecycle`: the change folder's name comes from the plan, and converges when the plan
  declares one.
- `persistence`: the task row carries the declared change name.

## Impact

- `packages/core`: the plan schema gains an optional name with a kebab-case shape, and the
  derivation from the title for when it is absent.
- `packages/db`: one nullable column on `tasks`, one migration.
- `packages/workspace`: the change folder's path takes the name rather than deriving it from the
  slug; provisioning converges on it, including renaming a folder provisioned under the
  provisional name.
- `apps/orchestrator`: the rename happens on accepting the stage that declared the plan, before
  that stage's commit; the declared name lands on the task with the rest of the plan.
- Existing tasks are untouched: a task with no declared name keeps the folder it has, which is
  what "the slug is the provisional name" already means for every task created before this.

## Non-goals

- The task branch is not renamed. It is internal, renaming it would break every stored commit
  reference and the mirror's own refs, and nobody reads it. The ugly slug survives there and that
  is the intended outcome.
- The task's slug is not re-derived. It is the task's identity in URLs and in the filesystem
  layout of workspaces; REQ-1306's reason for leaving it alone still holds.
- No repair of a folder already committed under the old name on a task that is past planning.
  Converging mid-pipeline would rewrite paths that stage results and artifact rows already point
  at, for a task whose folder the owner has already been reading under its current name.
- Intake's title derivation is not changed here. Whether a request opening with a URL should
  yield a better provisional title is a real question and a separate one; this change makes the
  answer stop mattering for the artifact that gets published.
- No uniqueness constraint on the change name across tasks. Disambiguation is per repository and
  happens when the folder is created, which is the only place a collision can be observed.
