Design decisions are referenced as D1–D7 and requirements by ID; neither is restated here.

## 1. The table and its migration

- [x] 1.1 Declare `repositories` in `packages/db/src/schema.ts` — the identity unique, the mirror key
      an ordinary column, the spec convention a jsonb column, and the default a flag behind a partial
      unique index in the shape `coverage_waivers_in_force_idx` already uses — REQ-316, D1, D3.
      Verify: `bun run db:generate`; the migration names the table and both indexes.
- [x] 1.2 Add a nullable `repository_id` to `tasks` and to `coverage_waivers`, leaving
      `tasks.repo_url` in place — D2. Verify: same command.
- [x] 1.3 Write the backfill into the generated migration in the order design.md gives, ending with
      both `app_settings` rows deleted — D5, D6, D7. Verify: `bun run db:migrate` against a database
      seeded with two spellings of one remote, a convention and a default naming a third, and an
      acceptance in force under each spelling; afterwards one row holds both spellings' tasks, one
      acceptance is in force, the third repository exists with no task, and neither settings key
      remains.
- [x] 1.4 Pin the migration's transcription of the normalisation against `normalizeRemote` over one
      shared table of spellings — D5. Verify: `bun test packages/db`; the two agree on every row,
      and a spelling added to the table fails the test until both handle it.
- [x] 1.5 Make `repository_id` `NOT NULL` at the end of the same migration — D2. Verify: covered by
      1.3; the migration is one transaction and fails as a whole if any row is left unmatched.

## 2. The store

- [x] 2.1 A repository store in `packages/db`: find-or-create keyed on the identity through
      `INSERT … ON CONFLICT … RETURNING`, plus reading one and listing them — REQ-316, D4. Verify:
      `bun test packages/db`; two concurrent creations of one remote return one row and mint one.
- [x] 2.2 Move the default onto the row — reading and writing it is the flag, and the database is
      what holds it to one — AC-348, D3. Verify: same command; making a second row the default
      leaves exactly one.
- [x] 2.3 Move the spec convention onto the row, and drop the read-modify-write under `for update`
      that the JSON map needed — REQ-1702, D4. Verify: same command; a convention set under one
      spelling is read back under another.
- [x] 2.4 Delete both repository sections from `packages/db/src/settings-store.ts`, leaving the model
      defaults alone. Verify: no occurrence of either settings key remains in the tree, and
      `bun run typecheck` passes.

## 3. Where a row is minted

- [x] 3.1 Intake resolves a repository record rather than a string, creating one where the remote is
      new — AC-346. Verify: `bun test apps/api`; a task created against the SSH spelling of a remote
      an existing row holds in HTTPS attaches to that row rather than minting a second.
- [x] 3.2 Settings mints a record for a repository no task has named, so a default or a convention
      can be stated in advance — AC-347. Verify: same command.
- [x] 3.3 Task creation writes `repository_id`, and deleting every task against a repository leaves
      the record standing — AC-349. Verify: same command.

## 4. The mirror key stops being recomputed

- [x] 4.1 Every caller reads the recorded mirror key; `mirrorKey` keeps one caller, the mint — D1.
      Verify: a search for the function across `apps` and `packages` names only the store and its
      own test.
- [x] 4.2 Workspace provisioning takes the record rather than a URL — D1. Verify:
      `bun test packages/workspace`; provisioning two tasks against two spellings of one remote uses
      one mirror.
- [x] 4.3 Keep the recorded mirror key as the repository's addressable id, so existing links still
      resolve. Where two spellings folded into one row, the surviving id is the one 1.3 kept and the
      other is gone — D6. Verify: `bun test apps/api`; the id in the list is the one the detail route
      answers to.

## 5. The coverage acceptance

- [x] 5.1 Write and read the acceptance by record, and move the in-force index onto the key —
      REQ-315, AC-350. Verify: `bun test apps/api`; an acceptance written under one spelling is in
      force for a task launched under another, and a second acceptance leaves one.

## 6. Closing out

- [x] 6.1 Full suite green — `bun run test`, `bun run typecheck`, `bun run check`.
- [x] 6.2 `bun run spec:validate` and `bun run spec:lint` pass over the change.
- [ ] 6.3 Still to do against a copy of the real database: run the migration and read the result —
      one row per repository, one acceptance in force apiece, no settings row for either key, and
      every mirror the surviving rows name present on disk.
