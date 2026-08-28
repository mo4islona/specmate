import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProvider,
  type AgentRole,
  defaultModelFor,
  type ModelId,
  type ProviderStatus,
  type ReasoningEffort,
  ROLE_CONTRACTS,
  type StageJob,
  type StageOutcome,
  type StageTelemetry,
} from '@specmate/core'
import type { ExecBackend, ExecResult } from './backend.ts'
import { providerRuntime, type RunnerConfig } from './config.ts'
import {
  activityTarget,
  isRecord,
  type ProviderCli,
  runProviderStage,
  tokenUsage,
} from './provider-run.ts'
import type { ToolUse } from './tool-edit.ts'

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
export class ClaudeCodeProvider implements AgentProvider, ProviderCli {
  readonly id = 'claude-code' as const

  constructor(private readonly deps: ClaudeProviderDeps) {}

  /**
   * `stream-json` is the only format that reports anything before the process
   * exits — `json` buffers the whole run into one object printed at the end.
   * `--verbose` is required alongside it under `-p`/`--print`: the CLI refuses
   * to start without it, regardless of whether per-token deltas are used.
   */
  argv(job: StageJob, resumeSessionId?: string): string[] {
    return this.commandLine(job.role, job.model, job.reasoningEffort, resumeSessionId)
  }

  private commandLine(
    role: AgentRole,
    model: ModelId,
    reasoningEffort: ReasoningEffort,
    resumeSessionId?: string,
  ): string[] {
    const argv = [
      this.cli,
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      model,
      '--effort',
      reasoningEffort,
    ]
    // Forked, never continued in place: a retry of this stage has to start from
    // the base session as the node that opened it left it, and `--resume` alone
    // would append this attempt's turns to that base (REQ-209, AC-236).
    if (resumeSessionId) argv.push('--resume', resumeSessionId, '--fork-session')
    // Nobody is present to answer a permission prompt; the container boundary
    // and the post-run scope check are the safety property, not the prompt.
    argv.push('--permission-mode', 'bypassPermissions')
    const disallowed = disallowedTools(role)
    if (disallowed.length > 0) argv.push('--disallowedTools', disallowed.join(','))

    return argv
  }

  private get cli(): string {
    return providerRuntime(this.deps.config, this.id).cli
  }

  run(job: StageJob): Promise<StageOutcome> {
    return runProviderStage(this.deps, job, this)
  }

  activityParser(): (line: string) => ToolUse[] {
    return parseActivityLine
  }

  refusedSession(run: ExecResult): boolean {
    return rejectedTheSession(run)
  }

  sessionId(run: ExecResult): string | null {
    return readSessionId(run.stdout)
  }

  telemetry(run: ExecResult): StageTelemetry | null {
    return readStageTelemetry(run.stdout)
  }

  async healthcheck(): Promise<ProviderStatus> {
    const { config, backend } = this.deps
    // Never the current directory: a health check must not be able to leave a
    // stray file in whatever tree this process was started from.
    const scratch = await mkdtemp(join(tmpdir(), 'specmate-healthcheck-'))
    let run: ExecResult
    try {
      run = await backend.run({
        argv: [this.cli, '--version'],
        stdin: '',
        workspacePath: scratch,
        env: {},
        provider: this.id,
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
        argv: [
          this.cli,
          '-p',
          '--output-format',
          'json',
          '--model',
          defaultModelFor(this.id) ?? 'claude-opus-5',
        ],
        stdin: 'Reply with the single word: ok',
        workspacePath: scratch,
        env: {},
        provider: this.id,
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
  return tokenUsage(readStageTelemetry(stdout))
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
    const model = servingModel(envelope.modelUsage)
    if (model) return model
  }
  if (typeof envelope.model === 'string' && envelope.model.length > 0) return envelope.model

  return null
}

/**
 * The CLI bills its own auxiliary calls to a small model alongside the stage's
 * own, so `modelUsage` routinely carries more than one entry and key order says
 * nothing about which of them did the work. Rank by one field across every
 * entry — never a cost against a token count — and the largest is the model the
 * stage actually ran on.
 */
function servingModel(modelUsage: Record<string, unknown>): string | null {
  const entries = Object.entries(modelUsage)
  const reportsCost = entries.some(([, usage]) => isRecord(usage) && 'costUSD' in usage)
  const field = reportsCost ? 'costUSD' : 'outputTokens'

  let served: string | null = null
  let largest = Number.NEGATIVE_INFINITY

  for (const [model, usage] of entries) {
    const reported = isRecord(usage) ? usage[field] : undefined
    const share = typeof reported === 'number' ? reported : 0
    if (share <= largest) continue

    served = model
    largest = share
  }

  return served
}

/**
 * The session identifier the CLI reports, from whichever streamed line carries it —
 * the init line has it before any work happens, so a run that dies mid-way still
 * leaves something a later node could continue.
 */
export function readSessionId(stdout: string): string | null {
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
    if (isRecord(candidate) && typeof candidate.session_id === 'string') return candidate.session_id
  }

  return null
}

/** A refused resume looks like a failed start, not like a stage that ran and disagreed. */
function rejectedTheSession(run: ExecResult): boolean {
  if (run.exitCode === 0) return false

  const said = `${run.stdout}\n${run.stderr}`.toLowerCase()

  return (
    said.includes('session') && (said.includes('not found') || said.includes('no conversation'))
  )
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

/**
 * One `stream-json` line, parsed for recognized tool use. Everything else —
 * text/thinking deltas, system/init, tool results, the terminal result line —
 * is read and discarded, per REQ-212/AC-227. A single assistant turn can
 * report more than one tool call, so this returns every one found on the line.
 *
 * The tool's own input travels with it: for a file-editing tool that input is
 * the edit, which is what `editFor` turns into the event's diff (REQ-212).
 */
export function parseActivityLine(line: string): ToolUse[] {
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

  const uses: ToolUse[] = []
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== 'tool_use') continue
    if (typeof block.name !== 'string' || block.name.length === 0) continue

    uses.push({
      tool: block.name,
      target: activityTarget(block.input),
      input: isRecord(block.input) ? block.input : {},
    })
  }

  return uses
}
