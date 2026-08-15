import type { ExecutionEnvironment } from '@specmate/core'
import { type ExecBackend, type ExecResult, type ExecSpec, spawnBounded } from './backend.ts'
import type { RunnerConfig } from './config.ts'

/**
 * Development only: the provider runs as a child of the orchestrator. It gets
 * an explicit environment and a deadline, but it shares the machine — which is
 * why configuring it in production is a startup failure, not a warning.
 */
export class LocalBackend implements ExecBackend {
  readonly id = 'local' as const

  constructor(private readonly config: RunnerConfig) {}

  async preflight(_workspaceRoot: string): Promise<string> {
    const found = Bun.which(this.config.cli)
    if (!found) throw new Error(`provider CLI "${this.config.cli}" is not on PATH`)

    return `local backend: ${found}`
  }

  async resolveEnvironment(_workspacePath: string, _image: string): Promise<ExecutionEnvironment> {
    return { image: 'local://host', toolchains: [] }
  }

  run(spec: ExecSpec): Promise<ExecResult> {
    return spawnBounded({
      argv: spec.argv,
      stdin: spec.stdin,
      cwd: spec.workspacePath,
      env: this.env(spec),
      timeoutMs: spec.timeoutMs,
      outputLimitBytes: this.config.logBytesLimit,
    })
  }

  /**
   * Explicit rather than inherited: the developer's session lives in their own
   * HOME, but nothing else of the orchestrator's environment — the database URL
   * above all — reaches the provider.
   */
  private env(spec: ExecSpec): Record<string, string> {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '',
    }
    for (const name of this.config.forwardEnv) {
      const value = process.env[name]
      if (value !== undefined) env[name] = value
    }

    return { ...env, ...spec.env }
  }
}
