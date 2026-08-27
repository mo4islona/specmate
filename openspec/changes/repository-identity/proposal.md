## Why

The repository is the thing this system keys almost everything on, and it is the one thing with no
record. A repository exists because a task named it: the list is `GROUP BY tasks.repo_url`
(`apps/api/src/routes/known-repositories.ts:6`, REQ-1017), and its identity is whatever string that
task happened to carry.

Four things key on that string, and no two of them spell it the same way. `tasks.repo_url` and
`coverage_waivers.repo_url` hold it raw. The spec convention keys on `normalizeRemote`
(`packages/db/src/settings-store.ts:152`), which folds the SSH and HTTPS spellings together. The
mirror and the memory store key on `mirrorKey`, whose digest is taken over the **raw** URL
(`packages/workspace/src/paths.ts:27`), which does not. So `git@github.com:owner/repo.git` and
`https://github.com/owner/repo` are one repository to the convention and two to everything else:
two rows in the list, two mirrors on disk, two memory stores, one shared setting between them.

The second consequence is that nothing about a repository can exist before a task does. That is why
the two facts an owner wants to state *in advance* — which repository is the default, and what
specification governs it — are both wedged into `app_settings`, a key/value table whose value is a
JSON map from normalised remote to setting, written back under `SELECT … FOR UPDATE` because two
edits from one screen would otherwise clobber each other.

`repo-memory` is about to make it worse. Its migration adds `repository_links(repo_url,
linked_repo_url)` — a fifth spelling, a table about repositories with no repository to point at, and
a pair of strings where a pair of foreign keys belongs. That change waits on this one.

**Roadmap.** Groundwork for Phase 4 (§14, "The wiki & incident investigation"), which moves
knowledge about the target system to the front and needs somewhere to hang it. It diverges from the
plan's §7 data model, where `repo_url` is a column on `tasks` and no repositories table appears;
§7 predates the mirror, the coverage waiver, the spec convention and the memory store all keying on
the same string.

## What Changes

- **A repository is a row.** A `repositories` table carries the identity (`normalized`, unique — the
  `normalizeRemote` form, so the spellings collapse), the URL as the owner wrote it for display, the
  `mirror_key` its files already live under, the default branch, the spec convention setting, and
  whether it is the default. A row may exist with no task against it: that is the point.
- **BREAKING** — REQ-315's "per repository" now means the row. Two acceptances written under two
  spellings of one remote were two records in force; they become one, and which one survives is a
  migration decision rather than an accident of spelling.
- **`tasks` and `coverage_waivers` gain `repository_id`**, a foreign key. `tasks.repo_url` stays
  beside it: a task records the remote it actually ran against, which is a fact about that run and
  not a duplicate of the repository's current spelling.
- **`app_settings` loses both repository keys.** `spec-conventions` becomes a column on the row it was
  always about, and `default-repository` becomes a flag with a partial unique index behind it — at
  most one default, enforced by the database rather than by the writer. The read-modify-write under a
  row lock goes with them.
- **Existing data is folded, not dropped.** Rows are created from every distinct normalised remote
  across `tasks`, `coverage_waivers` and both settings keys. Where two spellings collide, one row
  takes both sets of tasks; the `mirror_key` recorded is the one whose files exist.

## Non-goals

- **The memory store itself.** It stays on disk, under the `mirrorKey` path it already uses, and the
  table records that key rather than moving anything. `repo-memory` lands next, on top of this.
- **Renaming or merging a repository from the UI.** A row with a stable id is what makes both
  possible; neither is built here.
- **Deleting a repository.** Nothing removes a row in this change, because what should happen to the
  tasks that point at it is a question this change does not need to answer.
- **Re-keying anything on disk.** Mirrors, worktrees and memory stores keep their paths. A change
  that moves them can key on `repositories.id` once there is one.
- **Broadening what the repository list shows.** REQ-1017 lists the repositories tasks have run
  against, plus the default; the table may hold more rows than that — one the owner gave a
  specification convention and nothing else — and the list keeps its current contents. Whether a
  configured repository with no task belongs in it is a separate question, and REQ-1017 cannot be
  amended from here: it lives in the `single-field-intake` delta, implemented but not yet synced
  into `openspec/specs/task-surface/spec.md`, and a MODIFIED cannot target what the main spec does
  not hold.

## Capabilities

### New Capabilities

None. A repository's durability is `persistence`'s subject, and its readability is `task-surface`'s.

### Modified Capabilities

- `persistence`: adds a requirement making the repository a durable record with one identity, and
  amends REQ-315 so the acceptance it keeps in force is per that record rather than per URL string.

## Impact

- **Schema.** New `repositories` table; `repository_id` on `tasks` and `coverage_waivers`; two keys
  deleted from `app_settings`. One migration, with a backfill that must run before the foreign keys
  are made `NOT NULL`.
- **Code.** `packages/db/src/settings-store.ts` loses its two repository sections and gains a
  repository store; `apps/api/src/routes/known-repositories.ts` reads the table; `repositories.ts`,
  `settings.ts` and `tasks.ts` resolve a repository rather than a string; `packages/workspace`
  resolves the mirror key from the row instead of recomputing it per call.
- **Blocks.** `repo-memory`, whose `repository_links` becomes `repository_id` +
  `linked_repository_id`, and whose requirement IDs re-band from 1700 (taken by `spec-conventions`
  on main) to 2000.
