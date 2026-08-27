## Context

See proposal.md — Why. What matters for the approach is the shape of what exists: a repository is
an aggregate over `tasks.repo_url`, its files live under `mirrorKey(repoUrl)`, and two of its facts
live in a JSON map inside `app_settings` keyed on `normalizeRemote(repoUrl)`. The two functions
disagree — `normalizeRemote` folds spellings, `mirrorKey` digests the raw URL — and every call site
recomputes both from whatever string it happens to hold.

`coverage_waivers` already shows the pattern this change generalises: a real column and a partial
unique index (`coverage_waivers_in_force_idx`) enforcing "at most one in force per repository" in
the database rather than in the writer.

## Goals / Non-Goals

**Goals:**

- One row per repository, one identity, and the database enforcing both.
- Every existing on-disk path keeps working, untouched, on the day this deploys.
- The whole migration runs as SQL in one transaction — no boot-time backfill, no window where the
  application must cope with half-migrated data.

**Non-Goals:**

- `skill_sources` also carries a `repo_url`. The table is declared and nothing reads or writes it;
  wiring a dead table to the new identity would be inventing a caller.
- Making `mirrorKey` collision-proof or reversible. It stays exactly what it is; this change only
  stops recomputing it.

## Decisions

### D1 — Identity is the normalised remote; the mirror key is recorded, not derived

`normalized` (the `normalizeRemote` form) is unique and is what the row is found by. `mirror_key` is
an ordinary column written once at insert.

That second half is the substantive change, not bookkeeping. If `mirrorKey(repoUrl)` stays a
per-call computation, then the moment two spellings share a row the same repository resolves to two
different key values depending on which string the caller had — which is the bug, moved rather than
fixed. So `mirrorKey` keeps exactly one job: minting a key for a row that does not exist yet. Every
other caller reads `repositories.mirror_key`.

*Alternative considered:* make `mirrorKey` digest the normalised form instead, so it becomes stable
without a column. Rejected — it changes the digest for every repository that already exists, which
means moving every mirror and every memory store on disk on deploy day, for no gain over storing
the value.

### D2 — `tasks.repo_url` stays beside the foreign key

The key carries identity; the column carries history. A task ran against a remote spelled a
particular way, and that is a fact about that run — if the repository is later respelled, the task
should still say what it actually used. Keeping it also makes the backfill checkable after the fact:
the invariant `normalize(tasks.repo_url) = repositories.normalized` is greppable in SQL forever.

*Alternative considered:* drop the column and read through the key. Rejected — it destroys the
evidence the backfill would be audited with, in the same migration that creates the need for it.

### D3 — The default is a flag with a partial unique index

`is_default boolean`, with `unique … where is_default` — the same device
`coverage_waivers_in_force_idx` already uses. REQ-316 asks for "at most one, enforced by the
database", and a flag is the only shape that lets the database say it.

*Alternative considered:* keep `default-repository` in `app_settings` pointing at a repository id.
Rejected — "at most one" would go back to being a property of a JSON blob, and the pointer would be
a foreign key the settings table cannot declare.

### D4 — One writer mints rows, and it is atomic

Two paths create a repository: intake, when a task names one, and settings, when the owner names a
default or a convention for one. Both go through a single find-or-create keyed on `normalized`,
implemented as `INSERT … ON CONFLICT (normalized) DO UPDATE … RETURNING`, which is atomic and
returns the row whether it inserted or not. Two concurrent launches against one repository cannot
mint two rows, and neither needs a read-then-write under a lock — which is precisely what
`setSpecConvention` has to do today.

### D5 — The migration transcribes the normalisation once, and a test pins the transcription

The backfill has to group existing rows by normalised remote, and it runs in SQL, where
`normalizeRemote` does not exist. Writing it as a permanent SQL function would leave the rules
stated in two places forever.

So the migration carries a transcription of the rules used exactly once, in that migration, and the
change adds a test that runs both the TypeScript function and the SQL expression over one shared
table of spellings and asserts they agree. After the migration runs, the transcription is inert and
cannot drift — every subsequent `normalized` value is written by the application.

*Alternative considered:* backfill from application code on first boot. Rejected — it puts the
schema and the data in different deploy steps, and every later reader has to tolerate a null key.

### D6 — Colliding spellings: the row keeps the mirror whose files exist

Where two spellings fold into one row, the surviving `mirror_key` is the one belonging to the most
recently used task. The other mirror directory is left on disk untouched and unreferenced; deleting
files during a schema migration is not something to do quietly, and a sweep can take it later with
the rest of the orphans `repo-memory` already sweeps.

### D7 — Colliding coverage acceptances are revoked, not deleted

REQ-315 says revoking marks a record rather than removing it, and that a revoked record stays
readable. So where two spellings each have an acceptance in force, the most recent one stays in
force and the others are stamped revoked at the migration's timestamp. Nothing is erased, the
partial unique index is satisfiable, and the history reads honestly — someone accepted that gap, and
it stopped being the one in force.

## Risks / Trade-offs

- **The SQL transcription is wrong for a spelling nobody thought of, and two repositories merge that
  should not have** → The fixture table the test in D5 runs over is the same one `normalizeRemote`'s
  own tests use, extended with the spellings actually present in the deployment. The migration is
  reversible in the sense that matters: `tasks.repo_url` (D2) still holds every original string, so
  a wrong grouping can be recomputed rather than reconstructed.
- **A repository is respelled upstream and the row's `repo_url` goes stale** → It is a display
  string; identity is `normalized`, and the tasks keep what they used. Nothing breaks, and the
  rename this makes possible is deliberately not built here.
- **The mirror key becomes a stored value that can disagree with the directory that exists** → It
  can, and today's recomputation has exactly the same failure mode with no record of what it once
  was. Stored is strictly better: the value is inspectable.
- **Two changes touching `packages/db/src/schema.ts` at once** → `repo-memory` follows this change
  rather than running beside it, and its `repository_links` is written against the new table from
  the start rather than migrated onto it.

## Migration Plan

One migration, one transaction, in this order:

1. Create `repositories`, with `normalized` unique and the partial unique index on `is_default`.
2. Insert one row per distinct normalised remote drawn from `tasks.repo_url`, `coverage_waivers.repo_url`
   and both `app_settings` keys, taking `repo_url` and `mirror_key` from the most recently used task
   for that group (D6) and falling back to the settings key's own spelling where no task exists.
3. Fold the settings in: the spec convention from the `spec-conventions` map onto its row's column,
   the `default-repository` value onto its row's flag. Delete both `app_settings` rows.
4. Add `repository_id` to `tasks` and `coverage_waivers`, nullable; update from `normalized`; set
   `NOT NULL`.
5. Revoke the colliding coverage acceptances (D7).

Rollback is the inverse and is not scripted: the settings rows can be rebuilt from the columns, but
the case this would exist for — a wrong grouping — is repaired forward from `tasks.repo_url` rather
than by restoring a JSON blob.

## Open Questions

- Whether the repository list should later show a repository the owner configured but no task has
  used. It is deliberately unchanged here (proposal.md — Non-goals); answering it needs REQ-1017 in
  the main spec first, and neither the schema nor the tasks below depend on the answer.
