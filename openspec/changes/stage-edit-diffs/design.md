# Design — the edit is the event

## Where the diff comes from

Three sources could produce it, and only one of them survives contact with a stopped run.

**Git, at accept time.** The obvious one, and wrong. A stage's work reaches git only when the
stage is accepted (`workspace-lifecycle` REQ-706); an attempt that fails, is retried, or is
stopped has its tree reset and leaves nothing behind (REQ-209). The screen this change exists
for is a stopped stage's record, so a source that has nothing to say about a stopped stage
answers a different question. Git also cannot separate one tool call from the next: a stage that
edits one file eleven times commits one diff.

**The tool result.** The provider CLI reports each tool's result as well as its use, and for an
edit the result is a prose confirmation plus a snippet — written for the model that called it,
not for a diff. Parsing it would bind us to wording no contract holds stable.

**The tool input.** What the model asked for: for an edit, the exact text being replaced and the
text replacing it; for a write, the whole new content. This is a diff already — it only needs
formatting — it is present for every file-editing call whether or not the call succeeds, and it
is the same structure across every provider whose CLI streams structured tool uses at all.

So: the input. The consequence to state plainly is that this records **what the stage asked to
do**, not what the filesystem ended up holding. An edit that failed to apply still produces an
event. That is the honest reading of a step's record — it records a run, not a tree — and
it is the only reading available for an attempt whose tree is gone.

## Line numbers

The input alone gives no line numbers: `old_string` says what text is being replaced, not where
it sits. The file does, and the runner is holding the worktree the CLI is editing, so the
starting line is a lookup — find the replaced text in the file, count the newlines before it.

Two things make that lookup unreliable, and both degrade the same way. The text may not be found
(the edit has already been superseded by a later one in the same run), and the file may not be
readable (a path outside the worktree, a race with the CLI's own write). In either case the diff
is still rendered, without absolute line numbers. Numbers are a convenience; the diff is the
content.

The lookup happens once per file-editing call, against a file the process just watched being
written, so it is a warm read. It is not on the run's critical path either way: activity is
already handed to the orchestrator through a chain that swallows its own errors, precisely so a
failure to record cannot take down the run it describes.

## What is stored, and how much

The event payload carries a **unified diff** — `@@` hunk headers and `+`/`-`/context lines,
exactly what `git diff` emits — rather than a bespoke line-number structure. One format, one
renderer, and the Files view's existing diff already speaks it.

Two bounds, because two consumers want different amounts:

- `preview` — the diff clamped to a line budget, carried in every timeline read. This is what
  the record draws.
- `patch` — the whole diff, up to a hard ceiling, projected **out** of the timeline read and
  served by a read of its own.

The split is what keeps a sixty-edit stage from making the timeline unusable: the timeline
returns two hundred events at a time, and a payload that carried whole patches would put
megabytes on that wire for a screen that draws a few dozen lines of them. Past the hard ceiling
the patch is truncated and says so — a stage that rewrites a ten-thousand-line file has told the
owner everything useful in the first page of it.

The counts (`additions`, `deletions`) are computed once, at capture, from the whole diff — not
from the preview, which would make a truncated edit understate itself.

## Degradation

Every step here can fail against a provider that does not do what this one does, and none of the
failures may cost an event. No structured stream, an unrecognised tool, an input without the
fields, an unreadable file, a diff over the ceiling: each drops one field and keeps the rest.
The floor is today's behaviour — an event naming a tool and its target — and REQ-212 already
requires the run to survive having no activity at all.
