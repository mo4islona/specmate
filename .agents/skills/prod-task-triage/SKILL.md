---
name: prod-task-triage
description: Diagnose a SpecMate task that looks stuck or hung in production — the UI polls forever with no progress. Use when a live prod task isn't moving, or someone reports a task "hung"/"frozen"/"zависла".
license: MIT
metadata:
  author: specmate
  version: "1.0"
---

Go straight to the database and the event log. The UI polling forever tells you nothing about
*why* — the task row and its events tell you everything in two queries.

## 0. Connect

Server facts (host, app dir, port layout) live in `deploy/RUNBOOK.md` — gitignored, local-only,
never in this file. Read it first, then use it for the rest of this skill:

```bash
SERVER="root@<host from deploy/RUNBOOK.md>"
APP_DIR="/data/specmate"   # or whatever RUNBOOK.md names
```

## 1. Are the containers even healthy?

```bash
ssh "$SERVER" "cd $APP_DIR && docker compose ps"
```

All four services (`web`, `api`, `orchestrator`, `postgres`) should show `Up ... (healthy)`. If
one is restarting, that's the whole story — read its log (`docker compose logs <service> --tail
50`) and stop here.

## 2. Is the orchestrator doing anything at all?

```bash
ssh "$SERVER" "cd $APP_DIR && docker compose logs orchestrator --tail 100"
```

The orchestrator only logs at startup and on bookkeeping errors — silence is normal *if* work is
in flight. Silence plus "the task hasn't moved in N minutes" is the signal to go to step 3.

## 3. Read the task row directly — this is the fastest signal, always start here

```bash
ssh "$SERVER" "cd $APP_DIR && docker compose exec -T postgres psql -U specmate -d specmate -c \"
  SELECT id, status, resume_status, updated_at, now() - updated_at AS since_update
  FROM tasks ORDER BY created_at DESC LIMIT 5;\""
```

Then pull its full event history in one shot — this is the audit trail, read it before guessing:

```bash
ssh "$SERVER" "cd $APP_DIR && docker compose exec -T postgres psql -U specmate -d specmate -c \"
  SELECT seq, type, payload FROM events WHERE task_id = '<task-id>' ORDER BY seq;\""
```

## 4. Known causes, by status

**`status = 'draft'` and no rows in `stages` for the task.**
Not a hang — the task never started. `draft` is a reserved engine state
(`packages/core/src/pipeline.ts` `RESERVED_STATES`) that the orchestrator's poll explicitly
excludes from dispatch (`apps/orchestrator/src/engine.ts`, `NOT_RUNNABLE`). As of 2026-08-22
there is **no intake step** wired up: `POST /api/v1/tasks` and the "New task" web screen both
leave a task in `draft` forever with nothing to advance it — see the `CreateTaskInput.at` comment
in `apps/orchestrator/src/store.ts` ("Dev-only ... until intake exists"). Check whether that
comment is still true before assuming this is still the cause — the real fix is implementing
intake, tracked as an openspec change.

Until intake exists, unblock a specific task with a manual transition (mirrors exactly what
`Engine`'s own `applyTransition` does — status update plus a matching event, in one transaction):

```sql
BEGIN;
UPDATE tasks SET status = 'planning', resume_status = NULL, updated_at = now()
WHERE id = '<task-id>' AND status = 'draft';
INSERT INTO events (task_id, type, payload) VALUES (
  '<task-id>', 'task.transitioned',
  '{"from":"draft","to":"planning","cause":"manual_intake","actor":"<you>"}'::jsonb
);
COMMIT;
```

No admin CLI command reaches a `draft` task — `approve`/`redirect`/`rework`/`resume`/`restart`/
`cancel` all require the task to already be at a gate, paused, or failed state. This SQL block is
currently the only way in.

**`status = 'failed'`.**
Read the `stage.failed` event's `detail`/`reason` from the query above — it's almost always
enough by itself. If `reason: "provider_error"` and `detail` mentions no `RESULT.json`, check the
stage's raw log on the host (kept even after the runner container is removed):

```bash
ssh "$SERVER" "tail -c 3000 /var/lib/specmate/workspaces/tasks/<task-slug>/.specmate/<stage-id>-<attempt>/run.log"
```

`"Not logged in · Please run /login"` means the Claude Code provider session in the
`specmate_claude-auth` docker volume expired or was never created. Fix (interactive, cannot be
scripted — hand this back to a human):

```bash
ssh -t "$SERVER" "cd $APP_DIR && docker compose run --rm runner claude"
# log in, then /exit
```

Then restart the task from its failed stage:

```bash
ssh "$SERVER" "cd $APP_DIR && docker compose exec orchestrator bun apps/orchestrator/src/admin.ts restart --task <task-id>"
```

**`status = 'waiting_human'`.**
Not stuck — it's parked on an open decision or gate. Check `GET /api/v1/attention` or the
`decisions` table (`status = 'open'`) for what's being asked. This is expected behavior, not an
incident.

**A `docker compose` command itself hangs.**
Per `deploy/RUNBOOK.md`'s troubleshooting section: usually a slow build/pull on a cold layer
cache, not a deadlock — `--profile tools build` alone can take several minutes.

## Why this beats reading the UI

The UI only shows what the API exposes, and a `draft`/`waiting_human`/mid-retry task all look
identical from there — "still working". The `tasks` + `events` tables show the actual state
machine transitions and failure reasons in two queries, so start there instead of reproducing the
symptom in a browser.
