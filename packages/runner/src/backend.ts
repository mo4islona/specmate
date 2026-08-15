import { spawn } from 'node:child_process'
import type { ExecutionEnvironment } from '@specmate/core'
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
  readonly timeoutMs: number
  readonly limits: ExecLimits
  /** Whether the stage's role needs to start containers of its own. */
  readonly containerRuntime: boolean
  /** Overrides the configured runner with the task's immutable execution pin. */
  readonly environment?: ExecutionEnvironment
  /** Names the container so a deadline has something to kill. */
  readonly label: string
}

export interface ExecResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly timedOut: boolean
}

export interface ExecBackend {
  readonly id: BackendId
  run(spec: ExecSpec): Promise<ExecResult>
  resolveEnvironment(workspacePath: string, image: string): Promise<ExecutionEnvironment>
  /**
   * Asserts at startup that this backend can actually execute a stage. A
   * process that cannot run one can only fail every task it picks up.
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
}

/**
 * One process, one deadline, bounded buffers. `detached` puts the child in its
 * own process group so the deadline kills whatever it spawned too — an agent
 * that started a test suite is the normal case, not the exception.
 */
export async function spawnBounded(options: SpawnOptions): Promise<ExecResult> {
  const [command, ...args] = options.argv
  if (!command) throw new Error('argv is empty')

  const started = Date.now()

  return await new Promise<ExecResult>((settle, fail) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...options.env },
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let done = false

    const capture = (current: string, chunk: Buffer): string =>
      current.length >= options.outputLimitBytes
        ? current
        : (current + chunk.toString('utf8')).slice(0, options.outputLimitBytes)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = capture(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = capture(stderr, chunk)
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
