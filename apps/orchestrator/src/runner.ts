import { type ExecutionEnvironment, PROVIDERS, type ProviderId } from '@specmate/core'
import {
  ClaudeCodeProvider,
  CodexProvider,
  DEFAULT_PROVIDER_RUNTIMES,
  DockerBackend,
  type ExecBackend,
  LocalBackend,
  type ProviderRegistry,
  type ProviderRuntimes,
  providerRegistry,
  type RunnerConfig,
  resolveRunnerConfig,
} from '@specmate/runner'
import { z } from 'zod'

/** Docker and `.env` supply unset variables as empty strings; treat those as absent. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional())

const providerList = z
  .string()
  .min(1)
  .default('claude-code')
  .transform((value) => value.split(',').map((name) => name.trim()))
  .pipe(z.array(z.enum(PROVIDERS)).nonempty())

export const RunnerEnv = z.object({
  RUNNER_BACKEND: z.enum(['docker', 'local']).default('local'),
  RUNNER_IMAGE: optionalString,
  RUNNER_TOOLCHAINS_VOLUME: optionalString,
  RUNNER_CPUS: optionalString,
  RUNNER_MEMORY: optionalString,
  /** Exactly the providers this deployment runs; provider binding selects from these (REQ-508). */
  AVAILABLE_PROVIDERS: providerList,
  CLAUDE_CODE_CLI: optionalString,
  CLAUDE_CODE_AUTH_VOLUME: optionalString,
  /** Comma-separated names forwarded into a stage under this provider, e.g. an API key. */
  CLAUDE_CODE_FORWARD_ENV: optionalString,
  CODEX_CLI: optionalString,
  CODEX_AUTH_VOLUME: optionalString,
  CODEX_FORWARD_ENV: optionalString,
  ROLES_DIR: z.string().min(1).default('roles'),
  STAGE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3 * 60 * 60_000),
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

/**
 * Renamed when a provider stopped being a process-wide singleton: each of these
 * says something about one provider, and there are now more than one. Named
 * rather than aliased, so a `.env` still carrying the old form is a startup
 * failure that says what to write instead (REQ-504) rather than a setting that
 * is read by nothing.
 */
const RENAMED_ENV: Readonly<Record<string, string>> = {
  RUNNER_CLI: 'CLAUDE_CODE_CLI',
  RUNNER_AUTH_VOLUME: 'CLAUDE_CODE_AUTH_VOLUME',
  RUNNER_FORWARD_ENV: 'CLAUDE_CODE_FORWARD_ENV',
  RUNNER_MODEL: 'the model-defaults setting, per role',
}

export class RenamedRunnerEnvError extends Error {
  constructor(renamed: readonly string[]) {
    super(`no longer read:\n${renamed.map((line) => `  ${line}`).join('\n')}`)
    this.name = 'RenamedRunnerEnvError'
  }
}

/** Empty is unset, which is what Compose supplies for a variable nobody set. */
export function checkRenamedRunnerEnv(env: Record<string, string | undefined>): void {
  const offending = Object.entries(RENAMED_ENV)
    .filter(([old]) => (env[old] ?? '') !== '')
    .map(([old, replacement]) => `${old} — use ${replacement}`)
  if (offending.length > 0) throw new RenamedRunnerEnvError(offending)
}

const FORBIDDEN_RUNNER_ENV_PREFIXES = ['GITHUB_'] as const

function forwardEnv(provider: ProviderId, raw: string | undefined): string[] {
  const names = raw?.split(',').map((name) => name.trim()) ?? []
  const forbidden = names.find((name) =>
    FORBIDDEN_RUNNER_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)),
  )
  if (forbidden) {
    throw new Error(`${forbidden} must not be forwarded into a runner (${provider})`)
  }

  return names
}

export function providerRuntimesFrom(env: RunnerEnv): ProviderRuntimes {
  const declared: Record<ProviderId, () => ProviderRuntimes[ProviderId]> = {
    'claude-code': () => ({
      cli: env.CLAUDE_CODE_CLI ?? DEFAULT_PROVIDER_RUNTIMES['claude-code'].cli,
      authVolume:
        env.CLAUDE_CODE_AUTH_VOLUME ?? DEFAULT_PROVIDER_RUNTIMES['claude-code'].authVolume,
      forwardEnv: forwardEnv('claude-code', env.CLAUDE_CODE_FORWARD_ENV),
    }),
    codex: () => ({
      cli: env.CODEX_CLI ?? DEFAULT_PROVIDER_RUNTIMES.codex.cli,
      authVolume: env.CODEX_AUTH_VOLUME ?? DEFAULT_PROVIDER_RUNTIMES.codex.authVolume,
      forwardEnv: forwardEnv('codex', env.CODEX_FORWARD_ENV),
    }),
    // In the provider enum because the database has had it since the first
    // migration; nothing runs it, and configuring it says so rather than
    // failing at the first stage bound to it.
    copilot: () => {
      throw new Error('provider "copilot" is not implemented; remove it from AVAILABLE_PROVIDERS')
    },
  }

  const runtimes: Record<string, ProviderRuntimes[ProviderId]> = {}
  for (const provider of new Set(env.AVAILABLE_PROVIDERS)) {
    runtimes[provider] = declared[provider]()
  }

  return runtimes
}

export function runnerConfigFrom(env: RunnerEnv, nodeEnv: string, pidDir?: string): RunnerConfig {
  // The in-process backend shares this process's filesystem and machine with an
  // agent that runs a foreign repository's code. In production that is not a
  // warning, it is a refusal.
  if (env.RUNNER_BACKEND === 'local' && nodeEnv === 'production') throw new UnsafeBackendError()

  return resolveRunnerConfig({
    backend: env.RUNNER_BACKEND,
    image: env.RUNNER_IMAGE,
    providers: providerRuntimesFrom(env),
    toolchainsVolume: env.RUNNER_TOOLCHAINS_VOLUME,
    cpus: env.RUNNER_CPUS,
    memory: env.RUNNER_MEMORY,
    rolesDir: env.ROLES_DIR,
    stageTimeoutMs: env.STAGE_TIMEOUT_MS,
    pidDir,
  })
}

export function backendFor(config: RunnerConfig): ExecBackend {
  return config.backend === 'docker' ? new DockerBackend(config) : new LocalBackend(config)
}

/** One adapter per configured provider — what a stage's bound provider selects from. */
export function providersFor(
  config: RunnerConfig,
  backend: ExecBackend = backendFor(config),
): ProviderRegistry {
  const built = Object.keys(config.providers).map((id) =>
    id === 'codex'
      ? new CodexProvider({ config, backend })
      : new ClaudeCodeProvider({ config, backend }),
  )

  return providerRegistry(built)
}

export function taskRunnerEnvironment(
  environment: ExecutionEnvironment | null,
): ExecutionEnvironment {
  if (!environment) throw new TaskEnvironmentMissingError()

  return environment
}
