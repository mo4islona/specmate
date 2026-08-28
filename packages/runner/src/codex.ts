import { realpathSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  AgentProvider,
  ProviderStatus,
  StageJob,
  StageOutcome,
  StageTelemetry,
} from '@specmate/core'
import type { ExecBackend, ExecResult } from './backend.ts'
import { providerRuntime, type RunnerConfig } from './config.ts'
import { isRecord, type ProviderCli, runProviderStage } from './provider-run.ts'
import type { ToolUse } from './tool-edit.ts'

export interface CodexProviderDeps {
  readonly config: RunnerConfig
  readonly backend: ExecBackend
}

/**
 * The Codex CLI, invoked headless. Same two channels as every provider —
 * `RESULT.json` is the role contract, the CLI's own JSONL stream is telemetry
 * and activity — read here in that CLI's own vocabulary and nowhere else.
 */
export class CodexProvider implements AgentProvider, ProviderCli {
  readonly id = 'codex' as const

  constructor(private readonly deps: CodexProviderDeps) {}

  /**
   * The trailing `-` is what makes the CLI read its prompt from stdin, which is
   * how a prompt of any size reaches it without going on a command line.
   *
   * `fork` rather than `resume`: a retry of this stage has to start from the
   * base session as the node that opened it left it, and resuming in place would
   * append this attempt's turns to that base (REQ-209, AC-236). The subcommand
   * accepts a narrower flag set than `exec` and exits before it starts on one it
   * does not, so everything below is a flag both take.
   *
   * `--skip-git-repo-check` is not a convenience. A stage runs in a git worktree
   * whose `.git` is a file pointing into the repository's mirror, and the
   * container mounts the worktree alone — so every git command inside it fails,
   * and a CLI that refuses to start outside a repository would refuse every
   * stage. That check protects a human's untracked files; what protects these is
   * the container and the post-run scope check, which is the same reason nobody
   * is left to answer an approval prompt either (D9).
   */
  argv(job: StageJob, resumeSessionId?: string): string[] {
    const argv = [this.cli, 'exec']
    if (resumeSessionId) argv.push('fork', resumeSessionId)

    argv.push(
      '--json',
      '--skip-git-repo-check',
      '--model',
      job.model,
      '--config',
      `model_reasoning_effort="${job.reasoningEffort}"`,
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    )

    return argv
  }

  private get cli(): string {
    return providerRuntime(this.deps.config, this.id).cli
  }

  run(job: StageJob): Promise<StageOutcome> {
    return runProviderStage(this.deps, job, this)
  }

  activityParser(job: StageJob): (line: string) => ToolUse[] {
    return codexActivityParser(workspaceRoots(job.workspacePath))
  }

  refusedSession(run: ExecResult): boolean {
    return refusedTheSession(run)
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
    const probe = (argv: string[], timeoutMs: number) =>
      backend.run({
        argv,
        stdin: '',
        workspacePath: scratch,
        env: {},
        provider: this.id,
        timeoutMs,
        limits: { cpus: config.cpus, memory: config.memory },
        containerRuntime: false,
        label: 'healthcheck',
      })

    let version: ExecResult
    try {
      version = await probe([this.cli, '--version'], 30_000)
    } catch (e) {
      await rm(scratch, { recursive: true, force: true })

      return { provider: this.id, auth: 'unknown', detail: (e as Error).message }
    }

    if (version.exitCode !== 0) {
      await rm(scratch, { recursive: true, force: true })

      return { provider: this.id, auth: 'unknown', detail: 'the provider CLI could not be run' }
    }

    const cliVersion = version.stdout.trim().split('\n')[0] ?? ''
    const login = await probe([this.cli, 'login', 'status'], 30_000).catch(() => null)
    await rm(scratch, { recursive: true, force: true })

    return { provider: this.id, cliVersion, ...authFrom(login) }
  }
}

/**
 * The CLI answers this without running a turn, so nothing is spent to learn it.
 * Only the state and a fixed sentence travel back: the output names the account
 * that is signed in, and a status must not carry credential material (AC-221).
 */
function authFrom(login: ExecResult | null): { auth: ProviderStatus['auth']; detail: string } {
  if (!login) return { auth: 'unknown', detail: 'the session check could not be run' }

  if (login.exitCode === 0) return { auth: 'ok', detail: 'the stored session answered' }

  const said = `${login.stdout}${login.stderr}`
  const expired = /not logged in|login|auth|credential|expired|unauthor/i.test(said)

  return expired
    ? { auth: 'expired', detail: 'the stored session was rejected; re-login is needed' }
    : { auth: 'unknown', detail: `the session check exited ${login.exitCode}` }
}

/** The session identifier the CLI reports, on the line it opens the thread with. */
export function readSessionId(stdout: string): string | null {
  for (const event of parseEvents(stdout)) {
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      return event.thread_id
    }
  }

  return null
}

/**
 * Tokens under the CLI's own keys, and nothing else it does not report. There is
 * no cost in this envelope and no model: null is the honest answer for both, and
 * `costComplete` is what turns the missing cost into "this sum is a floor"
 * rather than into a free run.
 */
export function readStageTelemetry(stdout: string): StageTelemetry | null {
  let completed: Record<string, unknown> | null = null
  for (const event of parseEvents(stdout)) {
    if (event.type === 'turn.completed') completed = event
  }
  if (!completed) return null

  const usage = isRecord(completed.usage) ? completed.usage : {}
  const tokens: Record<string, number> = {}
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === 'number') tokens[key] = value
  }

  return {
    model: null,
    tokens: Object.keys(tokens).length > 0 ? tokens : null,
    costUsd: null,
    raw: completed,
  }
}

/**
 * A fork the CLI would not make looks like a failed start, not like a turn that
 * disagreed: it exits before opening a thread, saying so on stderr. The wording
 * today is `thread/fork failed: no rollout found for thread id <id>`, and this
 * matches the shape of that rather than the sentence — a message the CLI is free
 * to reword must not be able to turn a cold start into a stage failure.
 */
function refusedTheSession(run: ExecResult): boolean {
  if (run.exitCode === 0) return false

  const said = `${run.stdout}\n${run.stderr}`.toLowerCase()
  const aboutASession = said.includes('thread') || said.includes('session')
  const absent = /not found|no such|no rollout|does not exist|unknown/.test(said)

  return aboutASession && absent
}

/**
 * Item types that are a tool being used, and the tool name each is reported as.
 * Everything else the CLI emits — the model's own messages, its reasoning, its
 * plan — is read and discarded, per AC-227.
 */
const ACTIVITY_ITEMS: Readonly<Record<string, string>> = {
  command_execution: 'Bash',
  file_change: 'Edit',
  mcp_tool_call: 'Mcp',
  web_search: 'WebSearch',
}

/**
 * One JSONL line, parsed for recognized tool use (REQ-212).
 *
 * A `file_change` names each path it touched and neither the text replaced nor
 * the text replacing it, so its uses carry no input and the event carries no
 * edit — which is what AC-239 provides for. One use per path, because the target
 * of an activity is one thing.
 *
 * Deduplication is the caller's: this reports what the line says, and the same
 * item arrives twice, once started and once completed.
 */
export function parseActivityLine(line: string, roots: readonly string[] = []): ToolUse[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!isRecord(parsed)) return []
  if (parsed.type !== 'item.started' && parsed.type !== 'item.completed') return []

  const item = parsed.item
  if (!isRecord(item) || typeof item.type !== 'string') return []

  const tool = ACTIVITY_ITEMS[item.type]
  if (!tool) return []

  if (item.type === 'file_change') {
    const changes = Array.isArray(item.changes) ? item.changes : []

    return changes
      .filter(isRecord)
      .filter((change) => typeof change.path === 'string' && change.path.length > 0)
      .map((change) => ({
        tool,
        target: repoRelative(change.path as string, roots),
        input: {},
      }))
  }

  return [{ tool, target: itemTarget(item), input: {} }]
}

/** Fields carrying what an item acted on, in the order the item types define them. */
function itemTarget(item: Record<string, unknown>): string {
  for (const key of ['command', 'query', 'tool', 'server', 'path'] as const) {
    const value = item[key]
    if (typeof value === 'string' && value.length > 0) return value
  }

  return ''
}

/**
 * Deduplicates by item id, because the CLI reports a tool item twice — once as
 * it starts and once as it ends — and relaying both would double every line of
 * the timeline (D8). The first sighting wins, which is also the earliest signal.
 */
export function codexActivityParser(roots: readonly string[] = []): (line: string) => ToolUse[] {
  const seen = new Set<string>()

  return (line) => {
    const id = itemId(line)
    if (id !== null) {
      if (seen.has(id)) return []
      seen.add(id)
    }

    return parseActivityLine(line, roots)
  }
}

/**
 * The working tree as the orchestrator names it and as the filesystem resolves
 * it. The CLI reports the resolved form, and the two differ wherever the root is
 * reached through a symlink — `/tmp` on macOS is the everyday case.
 */
function workspaceRoots(workspacePath: string): string[] {
  const resolved = ((): string | null => {
    try {
      return realpathSync(workspacePath)
    } catch {
      return null
    }
  })()

  return resolved && resolved !== workspacePath ? [workspacePath, resolved] : [workspacePath]
}

/**
 * The CLI reports an absolute path, and an activity's target is all a file
 * change carries — there is no edit behind it to hold the relative form the way
 * one does under the other provider. A path under no known root is left as it came.
 */
function repoRelative(path: string, roots: readonly string[]): string {
  for (const root of roots) {
    const within = relative(root, resolve(root, path))
    if (within === '' || within.startsWith('..') || isAbsolute(within)) continue

    return within
  }

  return path
}

function itemId(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed) || !isRecord(parsed.item)) return null

    return typeof parsed.item.id === 'string' ? parsed.item.id : null
  } catch {
    return null
  }
}

/** Every JSONL line the CLI emitted, in order; anything unparseable is skipped. */
function* parseEvents(stdout: string): Generator<Record<string, unknown>> {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (isRecord(parsed)) yield parsed
  }
}
