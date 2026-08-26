import type { ExecutionEnvironment } from '@specmate/core'
import {
  ClaudeCodeProvider,
  DockerBackend,
  type ExecBackend,
  LocalBackend,
  type RunnerConfig,
  resolveRunnerConfig,
} from '@specmate/runner'
import { z } from 'zod'

/** Docker and `.env` supply unset variables as empty strings; treat those as absent. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional())

export const RunnerEnv = z.object({
  RUNNER_BACKEND: z.enum(['docker', 'local']).default('local'),
  RUNNER_IMAGE: optionalString,
  RUNNER_CLI: optionalString,
  RUNNER_MODEL: optionalString,
  RUNNER_AUTH_VOLUME: optionalString,
  RUNNER_TOOLCHAINS_VOLUME: optionalString,
  RUNNER_CPUS: optionalString,
  RUNNER_MEMORY: optionalString,
  ROLES_DIR: z.string().min(1).default('roles'),
  STAGE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3 * 60 * 60_000),
  /** Comma-separated names forwarded into a stage, e.g. an API key. */
  RUNNER_FORWARD_ENV: optionalString,
})

export type RunnerEnv = z.infer<typeof RunnerEnv>

export class UnsafeBackendError extends Error {
  constructor() {
    super(
      'RUNNER_BACKEND=local runs agents inside this process, without isolation; it is for development only. Set RUNNER_BACKEND=docker.',
    )
    this.name = 'UnsafeBackendError'
  }
}

export class TaskEnvironmentMissingError extends Error {
  constructor() {
    super('task has no pinned execution environment after workspace provisioning')
    this.name = 'TaskEnvironmentMissingError'
  }
}

const FORBIDDEN_RUNNER_ENV_PREFIXES = ['GITHUB_'] as const

export function runnerConfigFrom(env: RunnerEnv, nodeEnv: string, pidDir?: string): RunnerConfig {
  // The in-process backend shares this process's filesystem and machine with an
  // agent that runs a foreign repository's code. In production that is not a
  // warning, it is a refusal.
  if (env.RUNNER_BACKEND === 'local' && nodeEnv === 'production') throw new UnsafeBackendError()

  const forwardEnv = env.RUNNER_FORWARD_ENV?.split(',').map((name) => name.trim()) ?? []
  const forbidden = forwardEnv.find((name) =>
    FORBIDDEN_RUNNER_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)),
  )
  if (forbidden) {
    throw new Error(`${forbidden} must not be forwarded into a runner`)
  }

  return resolveRunnerConfig({
    backend: env.RUNNER_BACKEND,
    image: env.RUNNER_IMAGE,
    cli: env.RUNNER_CLI,
    model: env.RUNNER_MODEL,
    authVolume: env.RUNNER_AUTH_VOLUME,
    toolchainsVolume: env.RUNNER_TOOLCHAINS_VOLUME,
    cpus: env.RUNNER_CPUS,
    memory: env.RUNNER_MEMORY,
    rolesDir: env.ROLES_DIR,
    stageTimeoutMs: env.STAGE_TIMEOUT_MS,
    forwardEnv,
    pidDir,
  })
}

export function backendFor(config: RunnerConfig): ExecBackend {
  return config.backend === 'docker' ? new DockerBackend(config) : new LocalBackend(config)
}

export function providerFor(
  config: RunnerConfig,
  backend: ExecBackend = backendFor(config),
): ClaudeCodeProvider {
  return new ClaudeCodeProvider({ config, backend })
}

export function taskRunnerEnvironment(
  environment: ExecutionEnvironment | null,
): ExecutionEnvironment {
  if (!environment) throw new TaskEnvironmentMissingError()

  return environment
}
