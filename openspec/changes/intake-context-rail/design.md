## Context

See proposal.md — Why. The constraints are all pre-existing:

- **Resolution is mechanical and already written.** `resolveRepository` in `apps/api/src/intake.ts`
  decides the repository in a fixed order with no model in the path (REQ-1016). It is a pure
  function over the request text, the known repositories, and the default setting.
- **The API boots without the orchestrator** (AC-501), and the orchestrator is where the GitHub
  credential module lives today.
- **The credential is already written for concurrent callers.** `githubToken` takes a per-key
  advisory lock and re-checks freshness inside it, because GitHub invalidates a refresh token when
  it is redeemed. A second service reading the same row is the case it was written for.
- **A repository has no row of its own.** The repository list is derived from the tasks that name
  one, keyed by `mirrorKey` — the same digest the workspace layer names a mirror by.
- **The API can see the workspace root.** It mounts the same path the orchestrator does, which is
  where a repository's memory store lives.

## Goals / Non-Goals

**Goals:**

- Everything the system holds about the repository a request names, visible while the request is
  being written.
- A rail that provably names the same repository the launch will use.
- Enrichment that fails softly: the network is never between the owner and the button.

**Non-Goals:**

- Anything in proposal.md — Non-goals.
- A second place that decides which repository a request means.

## Decisions

### The preview runs intake's own resolver, on the server

The rail is fed by one read that takes the request text and returns what a launch of that text
would resolve to: the repository, the rule that resolved it, and the candidates when it did not.
It calls `resolveRepository` — the function `POST /tasks` calls — so agreement between the rail
and the launch is structural rather than tested into existence.

*Alternative — parse the request in the browser.* Rejected. `apps/web/src/lib/repo-link.ts`
already parses remotes for display, and it would have been half an hour's work to grow it into a
resolver. It would also have been a second answer to a question that already has one, drifting the
first time either side changed: the known-repository list and the default setting live on the
server, so the client's copy would be a guess dressed as a fact. The one thing the rail must never
do is name a repository the launch will not use.

*Alternative — return the preview from a failed create.* Rejected: it only answers after a
submission, which is the problem.

### A read with a body

The preview is a POST that creates nothing. The request text is capped at 20,000 bytes — it does
not belong in a query string, and truncating it to fit would make the preview answer a different
question than the launch. The alternative shape, a resource that is created and then read, would
put rows in the database for every pause in someone's typing.

The read is idempotent and the response carries no identity, so nothing downstream treats it as a
write. What keeps this honest is a stated property rather than a verb: a preview leaves no task,
no event, and no row behind (AC-1064).

### Two reads, because one of them is on someone else's network

The preview answers from the database. The issue enrichment answers from GitHub. Putting both
behind one call would make every rail wait for the slower half, and the slower half is the one
that can hang, rate-limit, or be unauthorised.

So the rail paints in two passes: the repository, its convention, its memory and its history land
immediately; the issue's title and state fill in when they arrive. This is also what makes the
appearance smooth rather than staged — the panel is already the right shape and one line inside it
resolves, instead of the whole panel arriving late.

The enrichment read is keyed on host, owner, repository and number — nothing else — and is cached
briefly per reference on the server as well as by the client. Typing another sentence about the
same issue must not spend another unit of a rate limit.

### The credential module moves to a shared package, and the API does not proxy the orchestrator

`github-auth.ts` moves from `apps/orchestrator/src` into a new `packages/github`, and both services
import it. The API reads the same `app_settings` row under the same advisory lock. The package is
new rather than the obvious `packages/connections`, because the parked `wip/connections` branch
already defines a package by that name holding a plugin registry and an encrypted secret store;
reusing the name would guarantee a conflict with a branch nobody has decided about yet.

*Alternative — the API asks the orchestrator to fetch the issue.* Rejected: AC-501 requires the API
to serve without the orchestrator, and an intake screen that goes blank whenever the orchestrator
is restarting would be a worse property than a missing issue title. It would also put a
service-to-service hop in front of a read that is already one hop too many.

`GITHUB_APP_CLIENT_ID` becomes an optional variable on the API service. Absent, the token cannot be
refreshed and enrichment degrades — which is the same path as no credential at all, already
required by AC-1070.

### One repository read, not four panels' worth of calls

`GET /repositories/:id` answers everything the system holds about one repository. The rail needs
the counts and the default flag (from the list), the specification convention setting, the
coverage gap in force, the recent tasks, and an excerpt of what the repository remembers. Four
reads would arrive in four waves, and the panel would visibly assemble itself.

The memory excerpt is bounded and most-recent-first, with the total alongside it. The full,
paginated, removable list stays where `repo-memory` put it: one canonical read per question, and
this one is "what does this repository look like at a glance".

The id is `mirrorKey`, which no query can invert. A repository the system has never run against
therefore cannot be addressed by id — the preview returns its URL, and the rail shows what it can
say about a repository with no history, which is honest and is most of what a first launch needs.

### Pinning is the same field the rejection already fills

Choosing a candidate in the rail writes the repository into the create request, exactly as choosing
one after a rejection does today (AC-972). There is no new state and no new endpoint: the rail
resolves the ambiguity earlier, into the same field, and the rejection path stays as the backstop
for everything the rail did not catch.

A pinned choice is shown as pinned and can be released back to inference. Without that, a stale pin
from three edits ago would quietly outrank a link the owner has since pasted — a launch going
somewhere the rail is no longer pointing.

### The rail keeps its shape, and a refresh does not blank it

Two properties, both about not punishing someone for typing:

- **Silence before a false wait.** The rail shows nothing until it has an answer. Drawn slots were
  the first attempt at this and they said the wrong thing: a skeleton means *this is arriving*, and
  on an untouched screen nothing is arriving — the rail is short of the owner's text, not of a
  response, so the bars sit there until somebody types and read as a panel that has hung. Waits are
  kept for the reads that genuinely are in flight, which are the ones a resolved repository starts:
  the forge probe, and what the system already holds. Where a default repository is set there is no
  empty state to design at all — an empty request genuinely resolves to the default, so the rail
  says so.
- **Stale beats blank.** A preview in flight leaves the previous answer on screen, marked as being
  refreshed. Replacing a correct answer with a spinner on every keystroke is how a live panel
  becomes something to ignore.

Motion is a settle, not an entrance, and it honours `prefers-reduced-motion` — a panel that
re-animates on every keystroke is worse than one that does not animate at all.

### The launch screen becomes its own capability

`operator-ui` had grown to five screens and twenty-three requirements in one file, and band 900 is
full — AC-901..AC-997 allocated, two numbers left, which does not fit this change or the next one.
Both are the same fact: one capability doing too much. The evidence is already in the tree, where
`repo-memory` and the archived `spec-convention-profiles` both allocated `operator-ui` REQ-923 in
parallel, about two unrelated screens.

So `launch-screen` splits out, holding what exists before a task does. REQ-903 moves file and
keeps its number, because an ID is immutable and its scenarios are cited from tests and from three
other changes. New requirements come from the capability's own band, 1900.

That needs the registry to hold more than one band per capability, since `launch-screen` owns IDs
in 900 and allocates from 1900. Allocation comes from the newest block only: backfilling the eight
numbers left in 900 would split one requirement's scenarios across two bands, and "the lowest free
number" produces that outcome every time a band runs low. "The newest block" stays mechanical and
reads properly. Band 900 stays shared as a closed, legacy block — uniqueness across the suite is
checked separately, so two capabilities holding IDs in it is safe.

*Alternative — split `operator-ui` all the way, into shell, task view, settings and artifacts.*
That is the real fix and this is not the change to do it in: it would rewrite the `operator-ui`
delta directory of three in-flight changes, one of them on a branch this change already depends
on, turning a merge into a conflict for no benefit to the feature. The one screen this change is
about is carved out; the rest is a change of its own once those have landed.

*Alternative — leave `operator-ui` whole and give it a second band.* Rejected: it buys room without
addressing why the room ran out, and leaves the next parallel allocation to collide the same way.

## Risks

**The rail says more than the owner wants to read.** Five sections beside a text field is a lot,
and the failure mode is a panel that gets ignored. Mitigated by ordering — what the launch will do
first, what the system knows second — and by each section collapsing to one line when it has
nothing to report. If it still reads as clutter, the memory excerpt is the first thing to cut.

**A rate limit reached during ordinary typing.** Debounce, server-side caching keyed on the
reference, and a client cache make the common case one lookup per issue mentioned. A rate limit
that is nonetheless reached degrades to a link, which is the same path as every other failure.

**The preview and the launch could still drift** if someone later adds a resolution rule to one and
not the other. The shared function is the structural defence; AC-1065 is the tripwire.

**Memory read from a store a stage is writing.** Admission is serialised per repository and the
rail's read is a plain listing, so the worst case is an excerpt one entry out of date for as long
as an admission takes. Not worth a lock on a read that repaints on the next keystroke.
