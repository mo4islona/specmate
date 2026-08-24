## Why

Roadmap phase: the tail of Phase 3 — the same pass over the task view that `task-screen-redesign`
and `pipeline-compression` belong to, prompted by the owner reading a real stopped task.

An activity event names a tool and a target and nothing else (REQ-212), so a step's record reads
`Wrote(openspec/changes/…/spec.md)` sixteen times and says nothing about what any of it did.
The owner's only route to the substance is to wait for the stage to be accepted and open the
Files view — and for a run that was stopped, that route does not exist at all: the uncommitted
work is discarded, so the one record of what the stage did is a list of paths with no content
behind them.

The information is already in hand and thrown away. The provider CLI's streaming output carries
each tool use with its full input, and for the file-editing tools that input *is* the edit —
the exact text replaced and the text replacing it. Parsing keeps the tool name and the path out
of that and drops the rest.

## What Changes

- `agent-execution`: an activity event for a file-editing tool carries the edit itself — the
  path relative to the repository root, added and removed line counts, and a unified diff — in
  addition to today's tool name and target. The diff is bounded; an edit that cannot be
  reconstructed degrades to today's tool-and-target event rather than failing the run.
- `task-surface`: timeline reads carry the bounded preview, not the whole patch, so a stage with
  sixty edits does not make the timeline unreadable over the wire; one event's full patch is a
  read of its own.
- `operator-ui`: the step's record renders a file-editing activity as the edit — the line counts
  and the diff itself, with line numbers and added/removed colouring, under the line that already
  names the file — clamped to a readable height, with the rest one click away.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `agent-execution`: activity events for file-editing tools carry the edit.
- `task-surface`: adds a read for one activity event's full patch, and bounds what the timeline
  itself carries.
- `operator-ui`: the record renders a changing activity as its diff, not as a line of text.

## Impact

- `packages/runner`: the stream parser gains diff reconstruction from the tool input, and the
  activity it hands the orchestrator gains the fields to carry it.
- `apps/orchestrator`: the activity event payload gains those fields; no schema change — the
  payload is already `jsonb`.
- `apps/api`: the timeline read projects the patch out of the payload it returns; a new read
  returns it for one event.
- `apps/web`: a record line that changed a file grows a diff beneath it; the existing
  `DiffViewer` grows line numbers so it can serve both this and the Files view.
- Nothing is backfilled: activity recorded before this change keeps rendering as it does today,
  which is what the degraded path already has to render anyway.

## Non-goals

- No attribution of a *committed* diff back to the tool call that produced it. This change
  records what each tool call did at the moment it did it; reconciling that against the commit
  the stage was accepted with is a different question and is not asked here.
- No rendering of non-file tool uses as anything richer than they are today — a `Bash` or a
  `Grep` keeps its one line. Only tools whose input carries the edit gain a diff.
- No side-by-side diff rendering, and no syntax highlighting inside a diff. Unified, coloured by
  line kind, line-numbered.
- No replay of a discarded attempt's files. The diff of an edit survives its own attempt being
  thrown away, because it is an event; the files do not come back with it.
- What earns a permanent line does not change (REQ-915 stands): a read is still a live line that
  leaves nothing behind, and only an activity that changed something is recorded. This changes
  what such a line shows, not which ones there are.
