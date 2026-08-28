import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  checkReviseHasFindings,
  type FailureReason,
  parseStageResult,
  ROLE_CONTRACTS,
  type StageActivity,
  type StageJob,
  type StageOutcome,
  type StageTelemetry,
} from '@specmate/core'
import { RESULT_FILE, SCRATCH_DIR } from '@specmate/workspace'
import type { ExecBackend, ExecResult } from './backend.ts'
import type { RunnerConfig } from './config.ts'
import { editFor, type ToolUse } from './tool-edit.ts'

/**
 * How a provider run itself can end badly — the members of `FAILURE_KINDS` a
 * run can reach, rather than a second list of them.
 */
export const RUN_FAILURES = [
  'timeout',
  'backend_error',
  'provider_error',
  'no_result',
  'invalid_result',
] as const satisfies readonly FailureReason[]

export type RunFailure = (typeof RUN_FAILURES)[number]

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
 * Everything about a run that is the CLI's own: how it is invoked, how its
 * output is read. What is left — the scratch protocol, `RESULT.json`, the log,
 * the cold-start retry — is the same for every provider and lives below.
 */
export interface ProviderCli {
  /** The command line for one attempt; a session id forks that session (REQ-209, AC-236). */
  argv(job: StageJob, resumeSessionId?: string): string[]
  /**
   * A parser for one attempt's structured stream, made fresh per attempt: a CLI
   * that reports an item more than once has to remember which it has already
   * reported, and that memory must not outlive the attempt whose ids it holds.
   */
  activityParser(job: StageJob): (line: string) => ToolUse[]
  /** True when the run failed because the CLI would not continue the session it was given. */
  refusedSession(run: ExecResult): boolean
  /** The session this run left behind, for a later node to continue (REQ-214). */
  sessionId(run: ExecResult): string | null
  /** Best-effort: null when the CLI's own envelope could not be read (REQ-206). */
  telemetry(run: ExecResult): StageTelemetry | null
}

export interface ProviderRunDeps {
  readonly config: RunnerConfig
  readonly backend: ExecBackend
}

/**
 * One stage attempt, from prompt to parsed result. The order is what the
 * contract rests on: the previous attempt's `RESULT.json` is removed before the
 * run so a crashed attempt cannot answer for this one, and nothing is returned
 * that has not been parsed.
 */
export async function runProviderStage(
  { config, backend }: ProviderRunDeps,
  job: StageJob,
  cli: ProviderCli,
): Promise<StageOutcome> {
  const label = stageLabel(job)
  const scratch = join(job.workspacePath, SCRATCH_DIR, label)
  const resultPath = join(job.workspacePath, RESULT_FILE)

  await mkdir(scratch, { recursive: true })
  await writeFile(join(scratch, 'prompt.md'), job.prompt)
  // Scratch is excluded from commits, so a previous attempt's result outlives
  // both a crash and the discard before a retry. Reading it would answer for
  // an attempt that never wrote anything.
  await rm(resultPath, { force: true })

  // Per attempt, not per run: a cold start after a refused fork is a second
  // stream, whose item ids start over from the first one's.
  const attempt = (resumeSessionId?: string) => {
    const argv = cli.argv(job, resumeSessionId)
    const activity = activityRelay(job, cli.activityParser(job))

    return {
      argv,
      drain: () => activity?.drain() ?? Promise.resolve(),
      run: backend.run({
        argv,
        stdin: job.prompt,
        workspacePath: job.workspacePath,
        env: {},
        provider: job.provider,
        timeoutMs: job.timeoutMs || config.stageTimeoutMs,
        limits: { cpus: config.cpus, memory: config.memory },
        containerRuntime: job.needsContainerRuntime ?? false,
        environment: job.environment,
        label,
        labels: stageContainerLabels(job),
        onActivityLine: activity?.onLine,
      }),
    }
  }

  // Only the session id decides whether there is anything to fork; whether this
  // run is a continuation at all is `job.resume`, and the two part company when
  // the resumed node recorded no session.
  //
  // A declined attempt's own session wins over the node's: it is that session
  // plus the turns that produced the work being corrected (REQ-209). The node's
  // own resumption stands behind it rather than being replaced by it — deduped,
  // because a first attempt that was never declined has the same id in both.
  const forks = [
    ...new Set([job.continueSession, job.resume?.sessionId].filter(Boolean)),
  ] as string[]

  let index = 0
  let started = attempt(forks[index])
  let argv = started.argv
  let run = await started.run
  await started.drain()

  // AC-235: the artifacts are the contract and the session is grounding, so a
  // session the provider will not give back degrades the run rather than failing
  // it. One step at a time: a refused fork of the declined attempt's session
  // still leaves the node's own resumption worth asking for, and dropping
  // straight to cold would throw away grounding nobody refused.
  const refused: string[] = []
  while (forks[index] !== undefined && cli.refusedSession(run)) {
    refused.push(forks[index] as string)
    index += 1
    await rm(resultPath, { force: true })

    started = attempt(forks[index])
    argv = started.argv
    run = await started.run
    await started.drain()
  }

  const continued = forks[index]
  const coldStartReason =
    refused.length === 0
      ? null
      : continued
        ? `the provider would not continue session ${refused.join(', ')}; continued ${continued} instead`
        : `the provider would not continue session ${refused.join(', ')}`

  // The command line that produced `run`, which after a cold start is not the
  // one this call started with — the log is read to find out what actually ran.
  const log = `$ ${argv.join(' ')}\n\n${run.stdout}\n${run.stderr}`
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

  // The exit code belongs to the client, not to the provider, which never ran:
  // attributing it to the provider sends a reader to the wrong logs (REQ-216).
  if (run.startFailure) {
    throw new StageRunError('backend_error', log, run.exitCode, run.durationMs, run.startFailure)
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

  // The graph's fact, not the session's: a continuation is asked for neither a
  // plan nor a coverage classification, and that stays true when the provider
  // refused the session and this run started cold. A job carrying no resumption
  // at all is held to both — the obligation is what a missing field falls back to.
  const parsed = parseStageResult(raw, Boolean(job.resume))
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

  const telemetry = cli.telemetry(run)
  const usage = { ...parsed.value.usage, ...tokenUsage(telemetry) }
  await writeFile(join(scratch, 'telemetry.json'), JSON.stringify(usage, null, 2))

  return {
    result: { ...parsed.value, usage },
    log,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    telemetry,
    sessionId: cli.sessionId(run),
    coldStartReason,
  }
}

/**
 * The usage keys the ledger and the budgets read, projected from the generic
 * token map — one parse of the envelope, one place that knows its shape. Absent
 * stays absent: a provider that reports no cost must not read as a free run.
 */
export function tokenUsage(telemetry: StageTelemetry | null): Record<string, number> {
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
 * The activity one tool use becomes. Reconstructing an edit reads the file the
 * CLI is editing, so this is where activity stops being pure — and where every
 * failure of that read is absorbed, leaving the tool and its target standing.
 */
export async function activityFor(use: ToolUse, workspacePath: string): Promise<StageActivity> {
  const edit = await editFor(use, workspacePath).catch(() => null)

  return edit
    ? { tool: use.tool, target: use.target, edit }
    : { tool: use.tool, target: use.target }
}

/**
 * Lines arrive synchronously and the edit behind one takes a file read, so the
 * work is queued rather than raced: `events.seq` is trusted to be the order the
 * tool uses happened in. `drain` is what keeps a run's last activity from
 * landing after the outcome it preceded.
 */
export function activityRelay(
  job: StageJob,
  parseLine: (line: string) => ToolUse[],
): { onLine: (line: string) => void; drain: () => Promise<void> } | undefined {
  const onActivity = job.onActivity
  if (!onActivity) return undefined

  let queue: Promise<unknown> = Promise.resolve()

  return {
    onLine: (line) => {
      for (const use of parseLine(line)) {
        queue = queue
          .then(() => activityFor(use, job.workspacePath).then(onActivity))
          .catch(() => {})
      }
    },
    drain: () => queue.then(() => undefined),
  }
}

/** Tool-use targets, tried in priority order — the first present string wins. */
export const ACTIVITY_TARGET_KEYS = [
  'file_path',
  'notebook_path',
  'pattern',
  'path',
  'command',
  'url',
  'query',
  'description',
] as const

export function activityTarget(input: unknown): string {
  if (!isRecord(input)) return ''

  for (const key of ACTIVITY_TARGET_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) return value
  }

  return ''
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
