## 1. Confirm the CLI streaming contract

- [x] 1.1 Against the runner image's pinned Claude Code CLI version, confirm the exact flags
      needed for incremental NDJSON output under `-p`/`--print` (expect `--output-format
      stream-json`, verify whether `--verbose` or another flag is still required).
- [x] 1.2 Capture a sample NDJSON transcript from a real run and enumerate the line shapes that
      represent a tool use versus everything else (assistant text deltas, system/init, the
      terminal result line).

## 2. Streaming plumbing in the runner backend

- [x] 2.1 Add `onActivityLine?: (line: string) => void` to `ExecSpec`/`SpawnOptions`
      (`packages/runner/src/backend.ts`).
- [x] 2.2 In `spawnBoundedHandle`'s `child.stdout.on('data', ...)`, add a line-buffering
      consumer (tail buffer across chunks, split on `\n`, invoke `onActivityLine` once per
      complete line) alongside the existing `capture` accumulator — `ExecResult`'s shape is
      unchanged.
- [x] 2.3 Unit test the line-buffer against a stdout stream split across chunk boundaries
      mid-line, confirming no line is dropped or double-parsed.

## 3. Claude Code provider changes

- [x] 3.1 Switch `packages/runner/src/claude.ts`'s argv from `--output-format json` to the
      streaming flag set confirmed in 1.1, for stage runs (not for the CLI-version preflight
      check at claude.ts:194, which only needs the version line).
- [x] 3.2 Implement the NDJSON line parser: recognized tool-use lines produce an activity
      payload (`{ tool, target }`); everything else is parsed and discarded per REQ-212/AC-227.
- [x] 3.3 Wire the parser as the `onActivityLine` callback, emitting an event through the same
      event-append path the orchestrator uses for other `stage.*` events, attributed to the
      running stage's id and current attempt (REQ-212/AC-226, AC-229).
- [x] 3.4 Update `parseEnvelope` (and therefore `readStageTelemetry`) to parse the buffered
      stdout as newline-delimited: split on `\n`, parse each line, take the last line matching
      the terminal-result shape — replacing today's single `JSON.parse(stdout.trim())` over the
      whole buffer.
- [x] 3.5 Regression-test `readStageTelemetry`/`readTelemetry` against a captured stream-json
      transcript, confirming model/tokens/cost extraction is unchanged in outcome from before
      the format switch.
- [x] 3.6 Test the no-streaming-support fallback: if streaming output can't be parsed, the stage
      still completes and reports its result without activity events (REQ-212/AC-228).

## 4. Task view rendering

- [x] 4.1 Render `stage.activity` events in the task view timeline (`apps/web`), visibly marked
      as in-progress (REQ-915/AC-940).
- [x] 4.2 Demote (collapse or remove) an attempt's activity events once its stage result is
      accepted, so they don't linger beside the accepted outcome (AC-941).
- [x] 4.3 Confirm a running stage with zero activity events still reads as running, not stalled
      or errored (AC-942).

## 5. Verification

- [x] 5.1 `bun run spec:lint` and `openspec validate live-run-activity --strict` pass.
- [x] 5.2 `bun run spec:validate` (repo-wide) still passes with this change alongside any other
      in-flight changes.
- [ ] 5.3 Manually run a real task through a Claude Code stage and confirm activity events
      appear live in the timeline, then disappear/demote once the stage's result is accepted.
