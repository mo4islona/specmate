## Context

See `proposal.md` — Why. The drawing is `docs/design/task-screen-pass-3.md` §Files, written
during pass 3 and deliberately left unbuilt by `task-screen-redesign` task 8.7.

Three constraints shape everything below.

**The API serves one path at a time.** `GET /tasks/:id/diff/files` lists the comparison and
`GET /tasks/:id/diff/file?path=…` returns one file's patch. Stacking every file means N reads
where the old surface made one at a time, on demand.

**The comparison moves under the reader.** A task is still running while its diff is being read;
an accepted stage commits and the branch tip moves. Any per-file mark a reader leaves is a claim
about a specific diff, and has to know which one.

**`artifact-diff-view` owned the current text of both requirements this change modifies.** It was
implemented but unarchived, so everything here is written against its wording; it was synced and
archived before these deltas were written, and `openspec/specs/` now says what they assume.

## Goals / Non-Goals

**Goals:**

- One pass over everything the task changed, with the surface — not the reader — holding the count.
- A `Viewed` mark that is honest: it means "I read *this* diff", and it goes when that diff does.
- Widening a hunk and switching unified/split without leaving the file or refetching the surface.
- The existing `FileDiffDrawer` keeps working, unchanged, for the job it has.

**Non-Goals:**

- No new rendering dependency. The kit's `Diff` already parses hunks and numbers lines; split view
  is a second arrangement of that parse, not a second parser.
- No change to the diff's own definition — merge-base to tip, `--no-renames` — beyond how much
  context is returned.

## Decisions

### Cards are collapsed past the first few, and each fetches its own diff

Every file gets a card, but only the first few are expanded on arrival; the rest fetch when
expanded. This is what GitHub does, and it falls out of the API we have: the read is already
per-path, so react-query caches it per path and an expand is a cache hit the second time.

*Alternative — a batch endpoint returning every file's patch in one response.* Rejected. It turns
a bounded read into an unbounded one for the one case that most needs bounding: the review of a
large task. It would also duplicate a read that already exists and is already correct.

*Alternative — expand everything and accept N parallel requests.* Rejected for the same reason
from the other side; a fifty-file task would open fifty reads to draw a screen showing three.

### `Viewed` is browser-local, keyed to the comparison's tip

The owner's decision, taken against the drawing, which says in as many words: "`Viewed` needs a
home, and it is not `localStorage`."

The substance of that objection survives here. Its argument is not really about where the bytes
live — it is the invalidation rule, "storing it against the task's current `HEAD`, so a newly
accepted commit resets the ticks on the files it touched", and its conclusion, "a counter that
survives the diff changing is worse than no counter". That rule is kept exactly: the marks are
stored under the comparison's tip, so a tip that moves is a set of marks that no longer applies
and a counter that starts again. Ticks are never carried across a commit.

What is actually given up by staying in the browser is durability across browsers and devices:
a second browser opens the same task at `0 / N`. For a single-owner, self-hosted service that is
a small loss, and it is the same trade the theme picker and the API secret already take
(`theme/themes.ts`, `lib/secret-store.ts`).

*Alternative — Postgres, per task, per path, per tip.* It survives the browser and would be the
project's default reading of "Postgres is the durable source of truth". Rejected by the owner
for what it costs: a migration, two endpoints and deltas on `persistence` and `task-surface`, for
state that no other reader and no stage ever reads.

The reader's unified/split choice is browser-local for the same reason and needs no key: it is a
preference, not a claim about a diff.

### The comparison's identity comes back with the file list

The client cannot key marks to a commit it cannot see, so `GET /tasks/:id/diff/files` returns the
tip it compared against beside the files.

*Alternative — key the marks on each file's own `+N −N` and status.* Rejected. Two different
edits can land on identical counts — a revert and a redo is the obvious one — so the mark would
occasionally survive the change it was a claim about. That is precisely the failure the rule
exists to prevent, and a rare wrong tick is worse than a visible reset.

### A hunk expander is a wider re-read, not a file read

`GET /tasks/:id/diff/file` takes how much surrounding context to include, bounded server-side, and
the expander re-asks for the same file with more. A width past the file's length is the whole
file, so "expand everything" needs no separate concept.

*Alternative — a file-content endpoint, splicing the missing lines client-side.* Rejected. It
introduces a second source for what the file says, which then has to agree exactly with the patch
the diff came from, including at the ends of the file and for a file that only one side has.

The trade is that widening refetches the whole file's diff rather than the missing lines. That is
one file, and it buys a single code path where git already does the work correctly.

### The tree's roots are the two groups

`artifact-diff-view` made the list carry which half of the work a file is — the specification the
task wrote, or the code it changed — and grouped by it. The tree keeps that: the two groups are
its top-level nodes and paths nest beneath them. The grouping is what makes a spec-only task
legible, and a plain path tree would bury it under `openspec/`.

The filter narrows what the tree shows and what the stack renders. It does not touch `n / N`:
`N` is the whole comparison, so the progress claim does not change as the reader types.

### The drawer stays exactly as it is

`FileDiffDrawer` is not the Files surface's mechanism any more, but it is still the answer to a
file named in a step's record, which is a diff opened from a surface that is not this one. It
keeps its requirement and its tests, and this change does not touch it.

### `operator-ui` claims a second ID band

Its AC band, 900–999, had two numbers left and this change needs more. `openspec/id-bands.yaml`
now lists more than one band start per capability; `scripts/lint-spec-ids.ts` accepts membership
in any of them and rolls `--next` into the following band when the current one fills. No living
requirement describes the registry, so this carries no delta.

The alternative — compressing the change into two scenarios — was rejected as writing the spec
around the tooling. Every capability reaches this eventually; `operator-ui` is simply first.

*Alternative — splitting `operator-ui` into several capabilities, each with its own band.* Worth
doing on its own merits: nineteen live requirements covering the shell, the inbox, the task view
and Settings is a lot for one capability. It does not, however, avoid this decision. IDs are
never renumbered when a capability is split (openspec-standard rule 5), so every capability split
off would carry REQ-916 and its scenarios out of the 900 band and would need to own that band
alongside a fresh one — the same multi-band registry. And four unarchived changes still carry
`specs/operator-ui/` deltas that would have to move in step. Deferred to a change of its own.

## Risks / Trade-offs

- **A large task opens many reads while the reader scrolls.** → Cards past the first few are
  collapsed and fetch on expand; each path is cached for the session, so re-expanding is free.
- **One enormous file can still swamp the surface.** → A card whose diff is past a line ceiling
  renders clamped with a control to draw the rest, the same shape a clamped stage edit already
  uses.
- **Ticks are lost on a new browser, and two browsers disagree.** → Accepted, above. The counter
  is a reading aid within one pass, not a record; nothing downstream reads it.
- **A tip that moves mid-review wipes the pass.** → It is the intended behaviour, but it must be
  legible rather than look like a bug: the surface says the comparison moved rather than silently
  showing `0 / N` again.
- **A third change modifying REQ-916 or REQ-1013 while this one waits would silently revert it
  at sync time.** → `openspec validate` does not catch two deltas rewriting one requirement; only
  `spec:lint`'s parallel-allocation check does, and only for the scenarios they both name. Anything
  landing on those requirements before this one has to be written against this change's wording,
  or synced after it.
- **Split view on a narrow screen is two columns where there is room for one.** → Below the
  breakpoint the choice is unavailable and the diff renders unified; the toggle is not offered
  rather than offered and ignored.

## Migration Plan

Nothing to migrate. `Viewed` is browser-local and starts empty; there is no stored state with an
old shape.

Both API changes are additive and backward compatible — a tip added to a response, an optional
context width on a read — so the API can ship before or with the client.

Rollback is the previous web bundle: the API additions are unused by it, and `taskFilesChanged`
and `taskFileDiff` keep their current behaviour when the width is not given.
