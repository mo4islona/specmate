import { afterAll, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StageActivity, StageJob } from '@specmate/core'
import { SCRATCH_DIR } from '@specmate/workspace'
import {
  CodexProvider,
  codexActivityParser,
  parseActivityLine,
  readSessionId,
  readStageTelemetry,
} from '../src/codex.ts'
import { LocalBackend } from '../src/local-backend.ts'
import { cleanupTempDirs, type Harness, makeHarness, resolveRunnerConfigFor } from './fixtures.ts'

afterAll(cleanupTempDirs)

const STUB = join(import.meta.dir, 'stub-codex.ts')
const STUB_ENV = [
  'SPECMATE_CODEX_STUB_SESSION',
  'SPECMATE_CODEX_STUB_RECORD',
  'SPECMATE_CODEX_STUB_ROLE',
  'SPECMATE_CODEX_STUB_REFUSE_FORK',
  'SPECMATE_CODEX_STUB_LOGIN',
]

function setStubEnv(values: Record<string, string>): void {
  for (const name of STUB_ENV) delete process.env[name]
  Object.assign(process.env, values)
}

function provider(env: Record<string, string> = {}): CodexProvider {
  const config = resolveRunnerConfigFor({
    codex: { cli: STUB, authVolume: 'specmate_codex-auth', forwardEnv: STUB_ENV },
  })
  setStubEnv(env)

  return new CodexProvider({ config, backend: new LocalBackend(config) })
}

function job(harness: Harness, overrides: Partial<StageJob> = {}): StageJob {
  return {
    taskId: '11111111-1111-4111-8111-111111111111',
    stageId: '22222222-2222-4222-8222-222222222222',
    role: 'researcher',
    provider: 'codex',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    workspacePath: harness.workspace.path,
    changeDir: harness.workspace.changeDir,
    prompt: 'PROMPT-BODY-MARKER',
    environment: { image: 'local://host', toolchains: [] },
    timeoutMs: 20_000,
    attempt: 0,
    resume: null,
    ...overrides,
  }
}

describe('provider invocation', () => {
  it('runs the model and reasoning effort the job carries', async () => {
    const harness = await makeHarness('codex-argv')
    const argv = provider().argv(job(harness, { model: 'gpt-5.4', reasoningEffort: 'xhigh' }))

    expect(argv[1]).toBe('exec')
    expect(argv).toContain('--json')
    // The worktree's `.git` points into a mirror the container does not mount,
    // so the CLI's repository check would refuse to start every stage.
    expect(argv).toContain('--skip-git-repo-check')
    expect(argv[argv.indexOf('--model') + 1]).toBe('gpt-5.4')
    expect(argv[argv.indexOf('--config') + 1]).toBe('model_reasoning_effort="xhigh"')
  })

  it('reads the prompt from stdin rather than the command line', async () => {
    const harness = await makeHarness('codex-stdin')
    const record = join(harness.workspace.path, SCRATCH_DIR, 'record.json')

    await provider({ SPECMATE_CODEX_STUB_RECORD: record }).run(job(harness))

    const recorded = JSON.parse(await readFile(record, 'utf8')) as {
      argv: string[]
      prompt: string
    }
    expect(recorded.prompt).toContain('PROMPT-BODY-MARKER')
    expect(recorded.argv.at(-1)).toBe('-')
    expect(recorded.argv.join(' ')).not.toContain('PROMPT-BODY-MARKER')
  })

  // REQ-209, AC-236: forked, never continued in place.
  it('forks the session it resumes instead of appending to it', async () => {
    const harness = await makeHarness('codex-fork')
    const argv = provider().argv(job(harness), 'thread-abc')

    expect(argv.slice(1, 4)).toEqual(['exec', 'fork', 'thread-abc'])
  })

  // `exec fork` takes a narrower flag set than `exec`, and a flag it rejects
  // makes the CLI exit before it starts — which reads as a stage failure rather
  // than as a session it would not continue.
  it('names only flags the fork subcommand accepts', async () => {
    const harness = await makeHarness('codex-fork-flags')
    const FORK_FLAGS = new Set([
      '-c',
      '--config',
      '-i',
      '--image',
      '--enable',
      '--disable',
      '--strict-config',
      '-m',
      '--model',
      '--dangerously-bypass-approvals-and-sandbox',
      '--dangerously-bypass-hook-trust',
      '--thread-source',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--output-schema',
      '--json',
      '-o',
      '--output-last-message',
    ])

    const named = provider()
      .argv(job(harness), 'thread-abc')
      .filter((argument) => argument.startsWith('-') && argument !== '-')

    expect(named.filter((flag) => !FORK_FLAGS.has(flag))).toEqual([])
  })

  it('names no session when the job resumes nothing', async () => {
    const harness = await makeHarness('codex-cold')

    expect(provider().argv(job(harness))).not.toContain('fork')
  })
})

describe('run', () => {
  // REQ-214, AC-232.
  it('records the thread the run opened', async () => {
    const harness = await makeHarness('codex-session')
    const outcome = await provider({ SPECMATE_CODEX_STUB_SESSION: 'thread-42' }).run(job(harness))

    expect(outcome.sessionId).toBe('thread-42')
    expect(outcome.result.status).toBe('ok')
  })

  // AC-235: a session the CLI will not fork degrades the run rather than failing it.
  it('runs cold and says why when the fork is refused', async () => {
    const harness = await makeHarness('codex-refused')
    const outcome = await provider({
      SPECMATE_CODEX_STUB_REFUSE_FORK: 'gone',
      SPECMATE_CODEX_STUB_SESSION: 'thread-fresh',
    }).run(job(harness, { resume: { node: 'plan', sessionId: 'gone' } }))

    expect(outcome.result.status).toBe('ok')
    expect(outcome.coldStartReason).toContain('gone')
    expect(outcome.sessionId).toBe('thread-fresh')
  })

  // REQ-206, AC-214 — and D10: no cost is reported, and null is not zero.
  it('reports the tokens the CLI gives and no cost', async () => {
    const harness = await makeHarness('codex-telemetry')
    const outcome = await provider().run(job(harness))

    expect(outcome.telemetry).toMatchObject({
      model: null,
      costUsd: null,
      tokens: { input_tokens: 1200, output_tokens: 340, reasoning_output_tokens: 42 },
    })
    expect(outcome.result.usage).not.toHaveProperty('cost_usd')
  })

  // REQ-212, AC-226 — one event per tool item, never two.
  it('emits one activity per tool use and none for the model talking', async () => {
    const harness = await makeHarness('codex-activity')
    const seen: StageActivity[] = []

    await provider().run(job(harness, { onActivity: (activity) => seen.push(activity) }))

    expect(seen.map((a) => a.tool)).toEqual(['Bash', 'Edit'])
    expect(seen[0]?.target).toBe('ls')
    expect(seen[1]?.target).toBe('openspec/changes/x/proposal.md')
  })
})

describe('healthcheck', () => {
  it('reports the CLI version and a usable session', async () => {
    const status = await provider().healthcheck()

    expect(status).toMatchObject({ provider: 'codex', auth: 'ok' })
    expect(status.cliVersion).toContain('codex-cli')
  })

  // REQ-210, AC-220.
  it('distinguishes a rejected session from an indeterminate one', async () => {
    expect(await provider({ SPECMATE_CODEX_STUB_LOGIN: 'expired' }).healthcheck()).toMatchObject({
      auth: 'expired',
    })
    expect(await provider({ SPECMATE_CODEX_STUB_LOGIN: 'broken' }).healthcheck()).toMatchObject({
      auth: 'unknown',
    })
  })

  // AC-221: the CLI names the signed-in account, and none of it travels back.
  it('echoes nothing the CLI printed', async () => {
    const status = await provider().healthcheck()

    expect(status.detail).not.toContain('ChatGPT')
  })
})

describe('event parsing', () => {
  it('takes the session from the line that opens the thread', () => {
    const stdout = ['{"type":"thread.started","thread_id":"t-1"}', '{"type":"turn.started"}'].join(
      '\n',
    )

    expect(readSessionId(stdout)).toBe('t-1')
    expect(readSessionId('{"type":"turn.started"}')).toBeNull()
  })

  it('reads no telemetry from a run that never completed its turn', () => {
    expect(readStageTelemetry('{"type":"turn.started"}')).toBeNull()
    expect(readStageTelemetry('not json at all')).toBeNull()
  })

  // AC-227.
  it('produces nothing for an item that is not a tool use', () => {
    const messages = [
      '{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"hi"}}',
      '{"type":"item.completed","item":{"id":"i1","type":"reasoning","text":"thinking"}}',
      '{"type":"item.completed","item":{"id":"i2","type":"todo_list","items":[]}}',
      '{"type":"turn.completed","usage":{}}',
      'not json',
      '',
    ]

    for (const line of messages) expect(parseActivityLine(line)).toEqual([])
  })

  // D8: one file-change item can touch several paths, and a target is one thing.
  it('reports one use per path a file change touched, carrying no edit', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'i1',
        type: 'file_change',
        changes: [
          { path: 'a.ts', kind: 'update' },
          { path: 'b.ts', kind: 'add' },
        ],
      },
    })

    expect(parseActivityLine(line)).toEqual([
      { tool: 'Edit', target: 'a.ts', input: {} },
      { tool: 'Edit', target: 'b.ts', input: {} },
    ])
  })

  // The CLI reports the resolved path; the orchestrator names the tree by the
  // path it mounted, which on macOS reaches /tmp through a symlink.
  it('reports a file change relative to the tree, however the root was reached', () => {
    const line = JSON.stringify({
      type: 'item.completed',
      item: { id: 'i1', type: 'file_change', changes: [{ path: '/private/tmp/w/a.ts' }] },
    })

    expect(parseActivityLine(line, ['/tmp/w', '/private/tmp/w'])[0]?.target).toBe('a.ts')
  })

  // D8: the CLI reports a tool item twice, once started and once completed.
  it('reports an item once however many times the stream names it', () => {
    const parse = codexActivityParser()
    const started =
      '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"ls"}}'
    const completed =
      '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"ls"}}'

    expect(parse(started)).toEqual([{ tool: 'Bash', target: 'ls', input: {} }])
    expect(parse(completed)).toEqual([])
  })

  it('keeps a second attempt from being deduplicated against the first', () => {
    const line =
      '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"ls"}}'

    expect(codexActivityParser()(line)).toHaveLength(1)
    expect(codexActivityParser()(line)).toHaveLength(1)
  })
})
