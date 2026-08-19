import { afterAll, describe, expect, test } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StageActivity, StageJob } from '@specmate/core'
import { RESULT_FILE, SCRATCH_DIR } from '@specmate/workspace'
import {
  ClaudeCodeProvider,
  parseActivityLine,
  readStageTelemetry,
  readTelemetry,
  type StageRunError,
  stageContainerLabels,
} from '../src/claude.ts'
import { LocalBackend } from '../src/local-backend.ts'
import {
  cleanupTempDirs,
  type Harness,
  makeConfig,
  makeHarness,
  STUB_ENV,
  setStubEnv,
} from './fixtures.ts'

afterAll(cleanupTempDirs)

function provider(mode: string, harness: Harness, extra: Record<string, string> = {}) {
  const config = makeConfig({ forwardEnv: STUB_ENV })
  setStubEnv({
    SPECMATE_STUB_MODE: mode,
    SPECMATE_STUB_SLUG: harness.workspace.slug,
    ...extra,
  })

  return new ClaudeCodeProvider({ config, backend: new LocalBackend(config) })
}

function job(harness: Harness, overrides: Partial<StageJob> = {}): StageJob {
  return {
    taskId: '11111111-1111-4111-8111-111111111111',
    stageId: '22222222-2222-4222-8222-222222222222',
    role: 'researcher',
    provider: 'claude-code',
    model: 'claude-opus-5',
    reasoningEffort: 'high',
    workspacePath: harness.workspace.path,
    changeDir: harness.workspace.changeDir,
    prompt: 'PROMPT-BODY-MARKER',
    environment: { image: 'local://host', toolchains: [] },
    timeoutMs: 20_000,
    attempt: 0,
    ...overrides,
  }
}

describe('provider invocation', () => {
  test('withholds the shell from a role that may not modify product code', () => {
    const harness = { workspace: { slug: 'x' } } as Harness
    const claude = provider('ok', harness)

    expect(claude.argv('researcher', 'claude-opus-5', 'high')).toContain('--disallowedTools')
    expect(claude.argv('researcher', 'claude-opus-5', 'high')).toContain('Bash')
    expect(claude.argv('implementer', 'claude-opus-5', 'high')).not.toContain('--disallowedTools')
  })

  test('runs the model and reasoning effort it is given, not the process-level config', () => {
    const harness = { workspace: { slug: 'x' } } as Harness
    // The provider's config defaults to claude-opus-5; passing a different
    // model here and seeing it win is what proves argv() isn't reading config.
    const argv = provider('ok', harness).argv('researcher', 'claude-sonnet-5', 'xhigh')

    expect(argv).toContain('-p')
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-sonnet-5')
    expect(argv[argv.indexOf('--effort') + 1]).toBe('xhigh')
    expect(argv[argv.indexOf('--output-format') + 1]).toBe('stream-json')
  })

  test('pairs --output-format stream-json with --verbose, which the CLI requires under -p', () => {
    const harness = { workspace: { slug: 'x' } } as Harness
    const argv = provider('ok', harness).argv('researcher', 'claude-opus-5', 'high')

    expect(argv).toContain('--verbose')
  })

  test('delivers the prompt on stdin and keeps it in the scratch directory', async () => {
    const harness = await makeHarness('stdin')
    const record = join(harness.workspace.path, SCRATCH_DIR, 'record.json')
    const claude = provider('ok', harness, { SPECMATE_STUB_RECORD: record })

    await claude.run(job(harness))

    const seen = (await Bun.file(record).json()) as { prompt: string }
    expect(seen.prompt).toBe('PROMPT-BODY-MARKER')
    const kept = join(harness.workspace.path, SCRATCH_DIR, '22222222-2222-4222-8222-222222222222-0')
    expect(await readFile(join(kept, 'prompt.md'), 'utf8')).toBe('PROMPT-BODY-MARKER')
  })

  test('parses the result and folds in the provider’s telemetry', async () => {
    const harness = await makeHarness('telemetry')
    const claude = provider('ok', harness)

    const outcome = await claude.run(job(harness))

    expect(outcome.result.status).toBe('ok')
    expect(outcome.result.usage.input_tokens).toBe(1200)
    expect(outcome.result.usage.cost_usd).toBe(0.42)
  })

  test('does not fail a good stage on a garbled telemetry envelope', async () => {
    const harness = await makeHarness('garbled')
    const claude = provider('garbled-telemetry', harness)

    const outcome = await claude.run(job(harness))

    expect(outcome.result.status).toBe('ok')
    expect(outcome.result.usage.input_tokens).toBeUndefined()
  })

  test('retains the log of a failed run', async () => {
    const harness = await makeHarness('failed-log')
    const claude = provider('nonzero-exit', harness)

    const error = (await claude.run(job(harness)).catch((e) => e)) as StageRunError

    expect(error.failure).toBe('provider_error')
    const log = join(
      harness.workspace.path,
      SCRATCH_DIR,
      '22222222-2222-4222-8222-222222222222-0',
      'run.log',
    )
    expect(await readFile(log, 'utf8')).toContain('stub failed on purpose')
  })

  test('reports a run that left no result', async () => {
    const harness = await makeHarness('no-result')
    const claude = provider('no-result', harness)

    const error = (await claude.run(job(harness)).catch((e) => e)) as StageRunError

    expect(error.failure).toBe('no_result')
  })

  test('reports a malformed result by naming the problem', async () => {
    const harness = await makeHarness('malformed')
    const claude = provider('invalid-result', harness)

    const error = (await claude.run(job(harness)).catch((e) => e)) as StageRunError

    expect(error.failure).toBe('invalid_result')
    expect(error.message).toMatch(/JSON|invalid/i)
  })

  test('does not accept an earlier attempt’s result as this attempt’s', async () => {
    const harness = await makeHarness('stale')
    const stale = JSON.stringify({ schema_version: 1, role: 'researcher', status: 'ok' })
    await writeFile(join(harness.workspace.path, RESULT_FILE), stale)
    const claude = provider('no-result', harness)

    const error = (await claude.run(job(harness)).catch((e) => e)) as StageRunError

    expect(error.failure).toBe('no_result')
  })

  test('reports a run killed by its deadline as timed out', async () => {
    const harness = await makeHarness('timeout')
    const claude = provider('hang', harness)

    const error = (await claude
      .run(job(harness, { timeoutMs: 300 }))
      .catch((e) => e)) as StageRunError

    expect(error.failure).toBe('timeout')
  })
})

describe('telemetry parsing', () => {
  test('reads a transcript array whose last entry is the result', () => {
    const stdout = JSON.stringify([
      { type: 'assistant' },
      { type: 'result', total_cost_usd: 1.5, usage: { input_tokens: 10, output_tokens: 20 } },
    ])

    expect(readTelemetry(stdout)).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      cost_usd: 1.5,
    })
  })

  test('returns nothing for output that is not JSON', () => {
    expect(readTelemetry('welcome to the CLI')).toEqual({})
    expect(readTelemetry('')).toEqual({})
  })

  test('reads a stream-json transcript, taking the last result-shaped line and ignoring the rest', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({
        type: 'result',
        total_cost_usd: 1.5,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      '',
    ].join('\n')

    expect(readTelemetry(stdout)).toEqual({
      input_tokens: 10,
      output_tokens: 20,
      cost_usd: 1.5,
    })
  })

  test('the stage record carries the served model, token kinds, cost, and the raw envelope', () => {
    const envelope = {
      type: 'result',
      total_cost_usd: 1.5,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
      modelUsage: { 'claude-opus-9': { inputTokens: 10 } },
    }

    expect(readStageTelemetry(JSON.stringify(envelope))).toEqual({
      model: 'claude-opus-9',
      tokens: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
      costUsd: 1.5,
      raw: envelope,
    })
  })

  test('an unreadable envelope reads as absent, never as zero', () => {
    expect(readStageTelemetry('not json at all')).toBeNull()
    expect(readStageTelemetry(JSON.stringify({ type: 'result' }))).toEqual({
      model: null,
      tokens: null,
      costUsd: null,
      raw: { type: 'result' },
    })
  })

  test('a successful run surfaces its telemetry on the outcome', async () => {
    const harness = await makeHarness('outcome-telemetry')
    const claude = provider('ok', harness)

    const outcome = await claude.run(job(harness))

    expect(outcome.telemetry?.model).toBe('stub-model-1')
    expect(outcome.telemetry?.tokens).toEqual({ input_tokens: 1200, output_tokens: 340 })
    expect(outcome.telemetry?.costUsd).toBe(0.42)
  })

  test('a garbled envelope leaves the outcome telemetry null and the stage standing', async () => {
    const harness = await makeHarness('null-telemetry')
    const claude = provider('garbled-telemetry', harness)

    const outcome = await claude.run(job(harness))

    expect(outcome.result.status).toBe('ok')
    expect(outcome.telemetry).toBeNull()
  })

  test('labels every stage container with task, node, and attempt', () => {
    const labels = stageContainerLabels(
      job({ workspace: { slug: 'x' } } as Harness, { node: 'research', attempt: 2 }),
    )

    expect(labels).toEqual({
      'specmate.task': '11111111-1111-4111-8111-111111111111',
      'specmate.node': 'research',
      'specmate.attempt': '2',
    })
  })
})

describe('activity line parsing', () => {
  test('a file-editing tool use names the tool and the file (AC-226)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: 'a.ts' } }],
      },
    })

    expect(parseActivityLine(line)).toEqual([{ tool: 'Edit', target: 'a.ts' }])
  })

  test('one assistant turn can report more than one tool use', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Two things.' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
          { type: 'tool_use', name: 'Bash', input: { command: 'bun test' } },
        ],
      },
    })

    expect(parseActivityLine(line)).toEqual([
      { tool: 'Read', target: 'a.ts' },
      { tool: 'Bash', target: 'bun test' },
    ])
  })

  test('a tool use with no known target field reads as the tool alone', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'TodoWrite', input: {} }] },
    })

    expect(parseActivityLine(line)).toEqual([{ tool: 'TodoWrite', target: '' }])
  })

  test('unrecognized CLI output produces no activity (AC-227)', () => {
    const shapes = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] },
      }),
      JSON.stringify({ type: 'result', total_cost_usd: 1 }),
      'not json at all',
      '{ this is not valid json',
      '',
    ]

    for (const shape of shapes) {
      expect(parseActivityLine(shape)).toEqual([])
    }
  })
})

describe('live activity', () => {
  test('collects each recognized tool use, attributed via the job callback, in order', async () => {
    const harness = await makeHarness('activity')
    const claude = provider('activity', harness)
    const seen: StageActivity[] = []

    const outcome = await claude.run(
      job(harness, { onActivity: (activity) => seen.push(activity) }),
    )

    expect(outcome.result.status).toBe('ok')
    expect(seen).toEqual([
      { tool: 'Read', target: 'a.ts' },
      { tool: 'Edit', target: 'a.ts' },
    ])
  })

  test('a run with no onActivity callback runs exactly as before', async () => {
    const harness = await makeHarness('activity-no-callback')
    const claude = provider('activity', harness)

    const outcome = await claude.run(job(harness))

    expect(outcome.result.status).toBe('ok')
  })

  test('unparseable streaming output leaves the stage standing, without activity (AC-228)', async () => {
    const harness = await makeHarness('activity-garbled')
    const claude = provider('activity-garbled', harness)
    const seen: StageActivity[] = []

    const outcome = await claude.run(
      job(harness, { onActivity: (activity) => seen.push(activity) }),
    )

    expect(outcome.result.status).toBe('ok')
    // The stub's noise precedes a valid trailing transcript; only that part parses.
    expect(seen).toEqual([
      { tool: 'Read', target: 'a.ts' },
      { tool: 'Edit', target: 'a.ts' },
    ])
  })
})
