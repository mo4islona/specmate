## Context

Today's Claude Code invocation (`packages/runner/src/claude.ts:53`) runs
`claude -p --output-format json --model <model>` — the `json` format buffers everything
internally and prints one combined result object only at exit. Nothing is observable mid-run
under this flag, regardless of how the process is piped.

`packages/runner/src/backend.ts`'s `spawnBoundedHandle` already streams stdout at the OS-pipe
level — `child.stdout.on('data', (chunk) => { stdout = capture(stdout, chunk) })` — but only to
concatenate it into one buffer for a single post-hoc parse once the process closes.
`readStageTelemetry`/`parseEnvelope` then do exactly one `JSON.parse(stdout.trim())` over that
whole buffer (tolerating, per an existing comment, "a transcript array whose last entry is the
result" from some CLI versions).

`agent-execution` REQ-206 already captures a run's full output to the workspace log after the
fact; `events.type`/`payload` (`persistence`) are free-form text/jsonb, so a new event type
needs no schema change; `task-surface`'s event stream (REQ-1003) already forwards every event
type to connected clients without a per-type allowlist.

## Goals / Non-Goals

**Goals:**
- Emit a structured activity event, live, for each recognized tool use while a Claude Code
  stage attempt runs.
- Keep the existing batch result contract (`ExecResult`, `readStageTelemetry`) intact for every
  caller that isn't asking for activity.
- Render activity in the task view timeline, demoted once the attempt's result is accepted.

**Non-Goals:**
- No raw stdout/stderr relay (decided explicitly — see proposal's Non-goals).
- No Codex/Copilot parsing — those runners don't exist yet.
- No live diff of uncommitted edits — that's `code-diff-view`, and only ever for accepted
  commits.
- No change to `spawnBounded`'s existing batching/timeout/kill-group semantics.

## Decisions

**Switch the Claude Code invocation to `--output-format stream-json`.** The `json` format
cannot produce anything mid-run by construction — it is a single object written at exit — so
observing activity requires the CLI's incremental NDJSON mode. Claude Code CLI's streaming JSON
output has historically required pairing with `--verbose` under `-p`/`--print`; verify the exact
requirement against the runner image's pinned CLI version during implementation rather than
assuming today's flag set carries over unchanged (tasks.md item).

**Parse incrementally inside the existing `data` listener, as a side channel — don't
restructure `spawnBounded`.** `backend.ts` already receives stdout as it streams; add a second,
line-buffering NDJSON consumer alongside the existing `capture` accumulator, exposed as a new
optional `onActivityLine?: (line: string) => void` on `ExecSpec`/`SpawnOptions`, invoked once per
complete line (buffering partial lines split across chunk boundaries — pipe chunking is not
line-aligned, so this buffering is genuinely new, not something `capture`'s raw byte
concatenation already gives us). `ExecResult`'s shape is unchanged; activity is additive.

**`parseEnvelope`/`readStageTelemetry` must learn NDJSON.** Today's one
`JSON.parse(stdout.trim())` over the whole buffer is correct for the `json` format's single
blob; under `stream-json` the buffer is many lines, not one parseable document. `parseEnvelope`
changes to: split on newlines, parse each line independently, and take the last line whose
shape marks it as the CLI's terminal result (the existing "transcript array, last entry wins"
tolerance is the same idea one level up — this generalizes it to line-delimited input instead of
a top-level array). This is the one place existing behavior's *shape* changes, not just gains a
new call site — flagged because it is the part most likely to regress telemetry if done
carelessly.

**Only recognized tool-use lines become activity events; everything else is parsed and
discarded.** Assistant text deltas, system/init lines, and anything not matching a recognized
tool-use shape are read (to keep the line-buffer's parse position correct) but produce no event
— per REQ-212/AC-227. Recognized lines become an event of a new type (e.g. `stage.activity`,
payload `{ tool, target }`), written through the same event-append path the orchestrator already
uses elsewhere for `stage.*`/`gate.*`/etc. events, attributed to the running stage's id and
current attempt.

**Claude Code only for v1.** `PROVIDERS` (`packages/core/src/roles.ts`) already lists `codex` and
`copilot`, but `packages/runner/src` has no runner for either — writing a "cross-provider"
parser now would be designing against CLIs that don't execute here. The `onActivityLine` hook is
provider-agnostic; each future provider's runner supplies its own line parser behind it.

## Risks / Trade-offs

- **Streaming-mode flag requirements drift across CLI versions** → pin against the runner
  image's actual CLI version and verify before relying on it; if streaming output turns out
  unparseable, the stage still runs without activity events (REQ-212/AC-228) rather than
  failing.
- **A line can split across two `data` chunks** → the new line-buffer holds a partial tail and
  only parses complete lines; this is new logic, not a reuse of `capture`'s raw concatenation.
- **Event volume during a tool-heavy stage** → no throttling or batching in v1; if the timeline
  proves noisy in practice, that is a follow-up tuning question, not a spec or scope change.

## Migration Plan

None — additive runner behavior (a new optional callback, a new event type) and a new
operator-ui requirement; no data migration. The CLI flag change is scoped to the Claude Code
provider's own invocation and does not affect any other provider, since none exist yet.
