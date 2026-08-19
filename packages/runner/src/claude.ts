import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProvider,
  type AgentRole,
  checkReviseHasFindings,
  type ModelId,
  type ProviderStatus,
  parseStageResult,
  type ReasoningEffort,
  ROLE_CONTRACTS,
  type StageActivity,
  type StageJob,
  type StageOutcome,
  type StageTelemetry,
} from '@specmate/core'
import { RESULT_FILE, SCRATCH_DIR } from '@specmate/workspace'
import type { ExecBackend, ExecResult } from './backend.ts'
import type { RunnerConfig } from './config.ts'

export type RunFailure = 'timeout' | 'provider_error' | 'no_result' | 'invalid_result'

/** A run that produced no usable result. The log is the diagnosis, so it travels with the error. */
export class StageRunError extends Error {
  constructor(
    readonly failure: RunFailure,
    readonly log: string,
    readonly exitCode: number,
    readonly durationMs: number,
    detail: string,
  ) {
    super(detail)
    this.name = 'StageRunError'
  }
}

export interface ClaudeProviderDeps {
  readonly config: RunnerConfig
  readonly backend: ExecBackend
}

/**
 * The provider CLI, invoked headless. Two channels come back: `RESULT.json` is
 * the role contract, and the CLI's own JSON envelope is the run's telemetry —
 * separate on purpose, so swapping providers changes how telemetry is read and
 * leaves the role contract alone.
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly id = 'claude-code' as const

  constructor(private readonly deps: ClaudeProviderDeps) {}

  /**
   * `stream-json` is the only format that reports anything before the process
   * exits — `json` buffers the whole run into one object printed at the end.
   * `--verbose` is required alongside it under `-p`/`--print`: the CLI refuses
   * to start without it, regardless of whether per-token deltas are used.
   */
  argv(role: AgentRole, model: ModelId, reasoningEffort: ReasoningEffort): string[] {
    const { config } = this.deps
    const argv = [
      config.cli,
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      model,
      '--effort',
      reasoningEffort,
    ]
    // Nobody is present to answer a permission prompt; the container boundary
    // and the post-run scope check are the safety property, not the prompt.
    argv.push('--permission-mode', 'bypassPermissions')
    const disallowed = disallowedTools(role)
    if (disallowed.length > 0) argv.push('--disallowedTools', disallowed.join(','))

    return argv
  }

  async run(job: StageJob): Promise<StageOutcome> {
    const { config, backend } = this.deps
    const label = stageLabel(job)
    const scratch = join(job.workspacePath, SCRATCH_DIR, label)
    const resultPath = join(job.workspacePath, RESULT_FILE)

    await mkdir(scratch, { recursive: true })
    await writeFile(join(scratch, 'prompt.md'), job.prompt)
    // Scratch is excluded from commits, so a previous attempt's result outlives
    // both a crash and the discard before a retry. Reading it would answer for
    // an attempt that never wrote anything.
    await rm(resultPath, { force: true })

    const run = await backend.run({
      argv: this.argv(job.role, job.model, job.reasoningEffort),
      stdin: job.prompt,
      workspacePath: job.workspacePath,
      env: {},
      timeoutMs: job.timeoutMs || config.stageTimeoutMs,
      limits: { cpus: config.cpus, memory: config.memory },
      containerRuntime: job.needsContainerRuntime ?? false,
      environment: job.environment,
      label,
      labels: stageContainerLabels(job),
      onActivityLine: job.onActivity
        ? (line) => {
            for (const activity of parseActivityLine(line)) job.onActivity?.(activity)
          }
        : undefined,
    })

    const log = `$ ${this.argv(job.role, job.model, job.reasoningEffort).join(' ')}\n\n${run.stdout}\n${run.stderr}`
    await writeFile(join(scratch, 'run.log'), log)

    if (run.timedOut) {
      throw new StageRunError(
        'timeout',
        log,
        run.exitCode,
        run.durationMs,
        `no result within ${job.timeoutMs}ms`,
      )
    }

    const raw = await Bun.file(resultPath)
      .text()
      .catch(() => null)
    if (raw === null) {
      const detail =
        run.exitCode === 0
          ? 'the run left no RESULT.json'
          : `provider exited ${run.exitCode} and left no RESULT.json`
      throw new StageRunError(
        run.exitCode === 0 ? 'no_result' : 'provider_error',
        log,
        run.exitCode,
        run.durationMs,
        detail,
      )
    }

    const parsed = parseStageResult(raw)
    if (!parsed.ok) {
      throw new StageRunError('invalid_result', log, run.exitCode, run.durationMs, parsed.error)
    }

    // A corroborated role's own findings may be empty and still be honest: the
    // executor derives scenario findings after the run and checks the merged
    // set once it knows them (`scope.ts`'s counterpart for verifier evidence).
    if (!ROLE_CONTRACTS[job.role].corroborated) {
      const findingsError = checkReviseHasFindings(parsed.value)
      if (findingsError) {
        throw new StageRunError('invalid_result', log, run.exitCode, run.durationMs, findingsError)
      }
    }

    const telemetry = readStageTelemetry(run.stdout)
    const usage = { ...parsed.value.usage, ...legacyUsage(telemetry) }
    await writeFile(join(scratch, 'telemetry.json'), JSON.stringify(usage, null, 2))

    return {
      result: { ...parsed.value, usage },
      log,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      telemetry,
    }
  }

  async healthcheck(): Promise<ProviderStatus> {
    const { config, backend } = this.deps
    // Never the current directory: a health check must not be able to leave a
    // stray file in whatever tree this process was started from.
    const scratch = await mkdtemp(join(tmpdir(), 'specmate-healthcheck-'))
    let run: ExecResult
    try {
      run = await backend.run({
        argv: [config.cli, '--version'],
        stdin: '',
        workspacePath: scratch,
        env: {},
        timeoutMs: 30_000,
        limits: { cpus: config.cpus, memory: config.memory },
        containerRuntime: false,
        label: 'healthcheck',
      })
    } catch (e) {
      await rm(scratch, { recursive: true, force: true })

      return { provider: this.id, auth: 'unknown', detail: (e as Error).message }
    }

    if (run.exitCode !== 0) {
      await rm(scratch, { recursive: true, force: true })

      return { provider: this.id, auth: 'unknown', detail: 'the provider CLI could not be run' }
    }

    const cliVersion = run.stdout.trim().split('\n')[0] ?? ''
    const auth = await this.checkSession(scratch)
    await rm(scratch, { recursive: true, force: true })

    return { provider: this.id, auth: auth.state, cliVersion, detail: auth.detail }
  }

  /**
   * Asks the CLI itself rather than inspecting files: the answer has to come
   * from the thing that will run the stage. Nothing from the run is echoed
   * back, so a token in the output cannot leak through the status.
   */
  private async checkSession(
    scratch: string,
  ): Promise<{ state: ProviderStatus['auth']; detail: string }> {
    const { config, backend } = this.deps
    const run = await backend
      .run({
        argv: [config.cli, '-p', '--output-format', 'json', '--model', config.model],
        stdin: 'Reply with the single word: ok',
        workspacePath: scratch,
        env: {},
        timeoutMs: 60_000,
        limits: { cpus: config.cpus, memory: config.memory },
        containerRuntime: false,
        label: 'healthcheck-session',
      })
      .catch(() => null)
    if (!run) return { state: 'unknown', detail: 'the session check could not be run' }

    if (run.exitCode === 0) return { state: 'ok', detail: 'the stored session answered' }

    const expired = /login|auth|credential|expired|unauthor/i.test(`${run.stdout}${run.stderr}`)

    return expired
      ? { state: 'expired', detail: 'the stored session was rejected; re-login is needed' }
      : { state: 'unknown', detail: `the session check exited ${run.exitCode}` }
  }
}

export function stageLabel(job: StageJob): string {
  return `${job.stageId}-${job.attempt}`
}

/** Label prefix for stage containers; the restart sweep filters on these keys. */
export const CONTAINER_LABELS = {
  task: 'specmate.task',
  node: 'specmate.node',
  attempt: 'specmate.attempt',
} as const

export function stageContainerLabels(job: StageJob): Record<string, string> {
  return {
    [CONTAINER_LABELS.task]: job.taskId,
    [CONTAINER_LABELS.node]: job.node ?? job.role,
    [CONTAINER_LABELS.attempt]: String(job.attempt),
  }
}

/**
 * Defence in depth only. A role that may not touch product code keeps its file
 * tools — its artifacts are files — but loses the shell, which is the tool that
 * turns "edit an artifact" into "run the build".
 */
export function disallowedTools(role: AgentRole): string[] {
  return ROLE_CONTRACTS[role].writesCode ? [] : ['Bash']
}

/**
 * Telemetry is best-effort: a garbled envelope must not fail a good stage.
 * The CLI's own usage keys, projected from `readStageTelemetry`'s generic
 * token map — one parse of the envelope, one place that knows its shape.
 */
export function readTelemetry(stdout: string): Record<string, number> {
  return legacyUsage(readStageTelemetry(stdout))
}

function legacyUsage(telemetry: StageTelemetry | null): Record<string, number> {
  const usage: Record<string, number> = {}

  const inputTokens = telemetry?.tokens?.input_tokens
  if (typeof inputTokens === 'number') {
    usage.input_tokens = inputTokens
  }

  const outputTokens = telemetry?.tokens?.output_tokens
  if (typeof outputTokens === 'number') {
    usage.output_tokens = outputTokens
  }

  if (typeof telemetry?.costUsd === 'number') {
    usage.cost_usd = telemetry.costUsd
  }

  return usage
}

/**
 * The full execution record the loop persists per attempt: the model that
 * actually answered, token counts under the CLI's own keys, the reported cost,
 * and the raw envelope. Null — not zero — when the envelope is unreadable.
 */
export function readStageTelemetry(stdout: string): StageTelemetry | null {
  const envelope = parseEnvelope(stdout)
  if (!envelope) return null

  const usage = isRecord(envelope.usage) ? envelope.usage : {}
  const tokens: Record<string, number> = {}
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number') tokens[key] = value
  }

  return {
    model: readModel(envelope),
    tokens: Object.keys(tokens).length > 0 ? tokens : null,
    costUsd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : null,
    raw: envelope,
  }
}

/** Recent CLIs report per-model usage keyed by the model that served the run. */
function readModel(envelope: Record<string, unknown>): string | null {
  if (isRecord(envelope.modelUsage)) {
    const [model] = Object.keys(envelope.modelUsage)
    if (model) return model
  }
  if (typeof envelope.model === 'string' && envelope.model.length > 0) return envelope.model

  return null
}

/**
 * `stream-json` output is many lines, not one document: parse each
 * independently and keep the last one shaped like the CLI's terminal result.
 * The "array whose last entry is the result" tolerance some CLI versions need
 * still applies per line, one level down from where it used to apply to the
 * whole buffer.
 */
function parseEnvelope(stdout: string): Record<string, unknown> | null {
  let result: Record<string, unknown> | null = null

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }

    const candidate = Array.isArray(parsed) ? parsed.at(-1) : parsed
    if (isRecord(candidate) && candidate.type === 'result') result = candidate
  }

  return result
}

/** Tool-use targets, tried in priority order — the first present string wins. */
const ACTIVITY_TARGET_KEYS = [
  'file_path',
  'notebook_path',
  'pattern',
  'path',
  'command',
  'url',
  'query',
  'description',
] as const

/**
 * One `stream-json` line, parsed for recognized tool use. Everything else —
 * text/thinking deltas, system/init, tool results, the terminal result line —
 * is read and discarded, per REQ-212/AC-227. A single assistant turn can
 * report more than one tool call, so this returns every one found on the line.
 */
export function parseActivityLine(line: string): StageActivity[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!isRecord(parsed) || parsed.type !== 'assistant') return []

  const message = parsed.message
  if (!isRecord(message) || !Array.isArray(message.content)) return []

  const activities: StageActivity[] = []
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== 'tool_use') continue
    if (typeof block.name !== 'string' || block.name.length === 0) continue

    activities.push({ tool: block.name, target: activityTarget(block.input) })
  }

  return activities
}

function activityTarget(input: unknown): string {
  if (!isRecord(input)) return ''

  for (const key of ACTIVITY_TARGET_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }

  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
