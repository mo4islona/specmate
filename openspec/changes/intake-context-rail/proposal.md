## Why

`single-field-intake` reduced launching to one field and made intake resolve the repository
itself (REQ-1016). It works, and it is silent. The owner writes a request, presses Launch, and
learns which repository the system picked by looking at the task that now exists — or, when
resolution was ambiguous, by reading a rejection. The one thing that must be right before any
agent runs is the one thing the screen never shows before it runs.

That silence costs more than a moment of doubt:

- **Ambiguity is discovered by pressing the button.** Two known repositories named in one request
  is a rejection (AC-1050). The owner finds out after committing to the text, not while writing it.
- **The most concrete thing in the request is ignored.** People paste a link — a repository, or an
  issue that *is* the ask. The screen treats that link as prose. Intake reads a repository out of
  it and drops everything else on the floor.
- **What the system already knows is a screen away, and arrives too late to matter.** By launch
  time the system holds a good deal about most repositories: what its stages have learned working
  there, the specification convention its tasks run under, the coverage gap the owner accepted for
  it, the tasks that already ran. All of it is real, none of it is visible at the one moment it
  would change what the owner writes. Launching a fourth task against a repository that already
  remembers the answer is how work gets duplicated.

The parts are built. `repo-memory` gives each repository a durable store its stages write and
later stages read. `spec-convention-profiles` resolves which specification governs a repository.
`decision-floors` keeps an accepted coverage gap alive past the task that accepted it. Each was
built so the *pipeline* would stop asking twice. None of it is shown to the person doing the
asking.

This is Phase 6-era polish of the launch surface: it changes what the owner can see before a task
exists, not what kinds of work exist or how they run.

## What Changes

- **The launch screen grows a context rail beside the request.** It names the repository the text
  resolves to and the rule that resolved it, the GitHub references the text carries, and what the
  system already holds about that repository — its specification convention, what it remembers,
  the coverage gap accepted for it, the tasks that ran against it.
- **The rail cannot disagree with the launch.** It is fed by a preview read that runs intake's own
  resolver over the same text (REQ-1016). The screen implements no second resolution of its own;
  what the rail names is what Launch creates the task against, and that is a stated property, not
  a hope.
- **Ambiguity becomes something to settle while writing, not after submitting.** When more than
  one known repository matches, the rail offers them, and choosing one pins it onto the launch.
  The rejection path in AC-972 stays exactly as it is — it is now the fallback rather than the
  first time the owner hears about the problem.
- **A GitHub issue in the request is read and shown.** Number, title, state, labels, author,
  linking out. It is a separate read from the preview so a slow or unavailable GitHub never delays
  the part the system can answer from its own database.
- **Missing GitHub credentials degrade, they do not fail.** No credential, a private repository, a
  deleted issue, a rate limit: the reference stays on the rail as a link, with one line saying why
  it could not be read. Nothing about the launch depends on it.
- **A repository becomes readable on its own.** One read answers "what does this system hold about
  this repository" — the counts and the default flag `/repositories` already returns, plus the
  specification convention in force, a bounded excerpt of what it remembers, the accepted coverage
  gap, and the tasks that ran against it. Five reads to paint one panel is how a panel ends up
  painting in five stages.
- **The rail keeps its shape when it is empty and settles rather than jumps.** Before anything is
  written it renders the slots it will fill, so the first fact does not resize the screen; a
  refresh in flight leaves what is shown in place rather than blanking it; nothing it does moves
  the request field or the caret while someone is typing.

## Capabilities

### New Capabilities

- `launch-screen`: what exists before a task does — what the owner is asked for, what the system
  settles for them, and what it shows them about where the work is about to go. Split out of
  `operator-ui`, which had grown to five screens in one document and had filled its ID band.
  REQ-903 moves file and keeps its number; nothing is renumbered.

### Modified Capabilities

- `operator-ui`: keeps every screen that presupposes a task, and stops covering the launch of one.
- `task-surface`: three reads — what a request would resolve to, what the system holds about one
  repository, and what a GitHub reference points at.

## Impact

- `apps/api`: the preview read, the single-repository read, and the GitHub reference read.
- `packages/github`: `github-auth.ts` moves out of `apps/orchestrator` so both services can read
  the stored credential, and the issue read joins it. The move is a lift, not a rewrite — the
  advisory lock that serialises token refresh was already written for concurrent callers. A new
  package rather than `packages/connections`, which the parked `wip/connections` branch already
  defines as something else.
- `apps/web`: the rail, and the launch screen's second column.
- `openspec/id-bands.yaml`, `scripts/lint-spec-ids.ts`: a capability may hold more than one band,
  allocating from the newest, which is what lets `launch-screen` own its existing IDs in band 900
  and its new ones in 1900.
- `openspec/changes/single-field-intake`: its `operator-ui` delta splits in two along the same
  line — REQ-903 to `launch-screen`, REQ-922 stays. Text unchanged.

## Non-goals

- **No model reads the request at intake.** The preview is exactly as mechanical as REQ-1016
  requires resolution to be. A rail that guessed differently from the launch would be worse than
  no rail.
- **No creating a task from an issue.** Pulling an issue's body in as the request is a separate
  question — it decides what the ask *is*, and the ask is the owner's own words (REQ-1001).
- **No writing memory from this screen.** Memory is written by stages that earned it, admitted
  under the rules `repo-memory` sets. The rail reads.
- **Not the connections framework.** `wip/connections` holds a parked plugin registry with an
  encrypted secret store and its own GitHub flow. This change moves the existing credential module
  into a shared package and stops there; unparking that framework is its own change.
- **No enrichment beyond GitHub.** Both hosts are parsed, because the client already parses both;
  only GitHub is fetched. GitLab references show as links.
- **No pre-task conversation surface.** Ruled out by `single-field-intake` for the same reason it
  is ruled out here: the workspace a conversation would need is cut from the repository the task
  does not yet have.

## Dependencies

This change reads what `repo-memory` stores and reuses that change's memory reads. It is written
against that branch and should land after it.

`repo-memory` allocated its IDs before `spec-convention-profiles` was archived and now collides
with it in three places: the whole of band 1700, which belongs to `spec-conventions`; operator-ui
REQ-923; and operator-ui AC-975..980. It has to renumber those before it syncs, which is the
ordinary outcome the standard describes for two changes drafted in parallel. Its operator-ui delta
is about Settings and so stays in `operator-ui` after this change's split, where two free
acceptance numbers remain and it needs six — so `operator-ui` will claim a second band the moment
that change lands, which is the mechanism this one puts in place. This change cites none of
`repo-memory`'s IDs, so nothing here moves when that renumbering happens.
