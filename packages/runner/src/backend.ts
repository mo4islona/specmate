import { spawn } from 'node:child_process'
import type { ExecutionEnvironment, ProviderId, ResolvedToolchain } from '@specmate/core'
import type { BackendId } from './config.ts'

export interface ExecLimits {
  readonly cpus: string
  readonly memory: string
}

export interface ExecSpec {
  /** The provider invocation. Identical in both backends. */
  readonly argv: readonly string[]
  readonly stdin: string
  /** Absolute working tree path. It must mean the same thing on the host. */
  readonly workspacePath: string
  /** The only environment the process gets; the caller's is never inherited. */
  readonly env: Readonly<Record<string, string>>
  /**
   * Whose CLI this is. It selects the stored session the run is given and the
   * names forwarded into it, so a stage reaches one provider's credential and no
   * other (REQ-203, AC-520).
   */
  readonly provider: ProviderId
  readonly timeoutMs: number
  readonly limits: ExecLimits
  /** Whether the stage's role needs to start containers of its own. */
  readonly containerRuntime: boolean
  /** Overrides the configured runner with the task's immutable execution pin. */
  readonly environment?: ExecutionEnvironment
  /** Names the container so a deadline has something to kill. */
  readonly label: string
  /**
   * Container labels (task, node, attempt) so the restart sweep can find what
   * a dead orchestrator left running. Ignored by the in-process backend.
   */
  readonly labels?: Readonly<Record<string, string>>
  /** Fired once per complete stdout line, as the process produces it. */
  readonly onActivityLine?: (line: string) => void
}

export interface ExecResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly timedOut: boolean
  /**
   * What the backend reported when it could not start the run at all. Present
   * means the process that exited was a client that never reached the provider,
   * so the exit code above is the runtime's and none of it is the provider's
   * (REQ-216).
   */
  readonly startFailure?: string
}

export interface ExecHandle {
  /** Settles exactly once when the execution exits or is cancelled. */
  readonly result: Promise<ExecResult>
  /** Idempotently terminates only this execution and waits for settlement. */
  cancel(): Promise<void>
}

/**
 * The runtime could not be asked, which is not the same fact as an answer of no.
 * A missing image is settled and re-running changes nothing; a daemon that is
 * restarting is neither, and treating the two alike ends a healthy task for a
 * deploy that happened to overlap it.
 */
export class ContainerRuntimeUnavailableError extends Error {
  constructor(detail: string) {
    super(`the container runtime could not be reached: ${detail}`)
    this.name = 'ContainerRuntimeUnavailableError'
  }
}

export interface ExecBackend {
  readonly id: BackendId
  start(spec: ExecSpec): ExecHandle
  run(spec: ExecSpec): Promise<ExecResult>
  resolveEnvironment(workspacePath: string, image: string): Promise<ExecutionEnvironment>
  /**
   * The image half of `resolveEnvironment`, for a task whose toolchains are
   * already pinned. Re-detecting them would read the working tree as the task's
   * own committed change has left it, so a task that bumps `.tool-versions`
   * would rewrite its own pin from the file it is in the middle of changing —
   * the drift REQ-802 exists to prevent.
   */
  repinImage(image: string, toolchains: readonly ResolvedToolchain[]): Promise<ExecutionEnvironment>
  /**
   * Whether this image reference can be resolved on the host that would run it.
   * A reference that was immutable when it was written is not a reference that
   * still resolves, and only the backend knows what resolving means for it.
   *
   * `false` is an answer. A runtime that could not be asked at all raises
   * `ContainerRuntimeUnavailableError` instead, because the caller's response to
   * the two differs: one re-pins the task, the other waits.
   */
  resolvesImage(image: string): Promise<boolean>
  /**
   * Asserts at startup that this backend can actually execute a stage, under
   * every configured provider. A process that cannot run one can only fail
   * every task it picks up.
   */
  preflight(workspaceRoot: string): Promise<string>
}

export interface SpawnOptions {
  readonly argv: readonly string[]
  readonly stdin: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly outputLimitBytes: number
  /** Runs when the deadline expires, before the child is signalled. */
  readonly onTimeout?: () => void
  /** Runs synchronously once the child exists, with its pid. */
  readonly onSpawn?: (pid: number) => void
  /** Fired once per complete stdout line, as the process produces it. */
  readonly onActivityLine?: (line: string) => void
}

/**
 * Turns a stream of raw chunks into complete lines. Pipe chunking is not
 * line-aligned, so a line can arrive split across two `data` events — the
 * tail from the previous push is what makes the next one whole.
 */
export class LineBuffer {
  private tail = ''

  push(chunk: string, onLine: (line: string) => void): void {
    const combined = this.tail + chunk
    const lines = combined.split('\n')
    this.tail = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  }

  /** Call once the stream has ended; a final line with no trailing newline is still a line. */
  flush(onLine: (line: string) => void): void {
    if (this.tail.length > 0) onLine(this.tail)
    this.tail = ''
  }
}

/**
 * One process, one deadline, bounded buffers. `detached` puts the child in its
 * own process group so the deadline kills whatever it spawned too — an agent
 * that started a test suite is the normal case, not the exception.
 */
export async function spawnBounded(options: SpawnOptions): Promise<ExecResult> {
  return spawnBoundedHandle(options).result
}

export function spawnBoundedHandle(options: SpawnOptions): ExecHandle {
  const [command, ...args] = options.argv
  if (!command) throw new Error('argv is empty')

  const started = Date.now()

  let done = false
  let childPid: number | undefined
  const result = new Promise<ExecResult>((settle, fail) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...options.env },
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    childPid = child.pid
    if (childPid !== undefined) options.onSpawn?.(childPid)

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const capture = (current: string, text: string): string =>
      current.length >= options.outputLimitBytes
        ? current
        : (current + text).slice(0, options.outputLimitBytes)

    // Stateful decoders: a multi-byte UTF-8 character can land split across
    // two `data` chunks, and decoding each chunk in isolation would corrupt
    // it on both sides. `{ stream: true }` holds the dangling bytes over to
    // the next chunk instead.
    const stdoutDecoder = new TextDecoder('utf-8')
    const stderrDecoder = new TextDecoder('utf-8')

    const activityLines = options.onActivityLine ? new LineBuffer() : undefined
    child.stdout.on('data', (chunk: Buffer) => {
      const text = stdoutDecoder.decode(chunk, { stream: true })
      stdout = capture(stdout, text)
      activityLines?.push(text, options.onActivityLine as (line: string) => void)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = capture(stderr, stderrDecoder.decode(chunk, { stream: true }))
    })

    const deadline = setTimeout(() => {
      timedOut = true
      options.onTimeout?.()
      killGroup(child.pid)
    }, options.timeoutMs)

    const finish = (exitCode: number) => {
      if (done) return

      done = true
      clearTimeout(deadline)
      activityLines?.flush(options.onActivityLine as (line: string) => void)
      settle({ exitCode, stdout, stderr, durationMs: Date.now() - started, timedOut })
    }

    child.on('error', (error) => {
      if (done) return

      done = true
      clearTimeout(deadline)
      fail(error)
    })
    child.on('close', (code, signal) => finish(code ?? (signal ? 124 : 1)))

    child.stdin.on('error', () => {
      // A provider that exits before reading its prompt closes the pipe; the
      // exit code is the diagnosis, not EPIPE.
    })
    child.stdin.end(options.stdin)
  })

  return {
    result,
    async cancel() {
      if (!done) killGroup(childPid)
      await result.then(
        () => undefined,
        () => undefined,
      )
    },
  }
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}
