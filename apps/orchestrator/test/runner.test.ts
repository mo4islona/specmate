import { describe, expect, test } from 'bun:test'
import {
  checkRenamedRunnerEnv,
  providersFor,
  RenamedRunnerEnvError,
  RunnerEnv,
  runnerConfigFrom,
  TaskEnvironmentMissingError,
  taskRunnerEnvironment,
  UnsafeBackendError,
} from '../src/runner.ts'

function env(overrides: Record<string, string> = {}) {
  return RunnerEnv.parse({ RUNNER_BACKEND: 'docker', ...overrides })
}

describe('runner configuration', () => {
  test('refuses to run agents in-process in production', () => {
    expect(() => runnerConfigFrom(env({ RUNNER_BACKEND: 'local' }), 'production')).toThrow(
      UnsafeBackendError,
    )
    expect(() => runnerConfigFrom(env({ RUNNER_BACKEND: 'local' }), 'production')).toThrow(
      /RUNNER_BACKEND/,
    )
  })

  test('allows the in-process backend outside production', () => {
    expect(runnerConfigFrom(env({ RUNNER_BACKEND: 'local' }), 'development').backend).toBe('local')
  })

  test('treats an empty variable as unset rather than invalid', () => {
    const config = runnerConfigFrom(env({ RUNNER_IMAGE: '', CLAUDE_CODE_CLI: '' }), 'production')

    expect(config.image).toBe('specmate/runner-universal:latest')
    expect(config.providers['claude-code']?.cli).toBe('claude')
  })

  test('reads the forwarded variable names as a list, per provider', () => {
    const config = runnerConfigFrom(
      env({
        AVAILABLE_PROVIDERS: 'claude-code,codex',
        CLAUDE_CODE_FORWARD_ENV: 'ANTHROPIC_API_KEY, OTHER',
        CODEX_FORWARD_ENV: 'CODEX_API_KEY',
      }),
      'production',
    )

    expect(config.providers['claude-code']?.forwardEnv).toEqual(['ANTHROPIC_API_KEY', 'OTHER'])
    expect(config.providers.codex?.forwardEnv).toEqual(['CODEX_API_KEY'])
  })

  test('refuses to forward GitHub authorization into a runner', () => {
    expect(() =>
      runnerConfigFrom(env({ CLAUDE_CODE_FORWARD_ENV: 'GITHUB_APP_CLIENT_ID' }), 'production'),
    ).toThrow(/GITHUB_APP_CLIENT_ID.*must not be forwarded/)
    expect(() =>
      runnerConfigFrom(
        env({ AVAILABLE_PROVIDERS: 'codex', CODEX_FORWARD_ENV: 'GITHUB_TOKEN' }),
        'production',
      ),
    ).toThrow(/GITHUB_TOKEN.*must not be forwarded/)
  })

  test('rejects a non-positive stage timeout', () => {
    expect(() => env({ STAGE_TIMEOUT_MS: '0' })).toThrow()
  })

  test('returns the complete task pin after provisioning', () => {
    const environment = {
      image: `runner@sha256:${'a'.repeat(64)}`,
      toolchains: [{ name: 'bun', version: '1.3.9' }],
    }

    expect(taskRunnerEnvironment(environment)).toEqual(environment)
    expect(() => taskRunnerEnvironment(null)).toThrow(TaskEnvironmentMissingError)
  })
})

// REQ-508.
describe('the configured provider set', () => {
  test('runs one provider unless configuration names more', () => {
    expect(Object.keys(runnerConfigFrom(env(), 'production').providers)).toEqual(['claude-code'])
    expect(env().AVAILABLE_PROVIDERS).toEqual(['claude-code'])
  })

  test('reads the set as a list and gives each its own CLI and session', () => {
    const config = runnerConfigFrom(
      env({ AVAILABLE_PROVIDERS: 'claude-code, codex' }),
      'production',
    )

    expect(config.providers['claude-code']).toMatchObject({
      cli: 'claude',
      authVolume: 'specmate_claude-auth',
    })
    expect(config.providers.codex).toMatchObject({
      cli: 'codex',
      authVolume: 'specmate_codex-auth',
    })
    // AC-520: the two never share a volume, which is what keeps one stage from
    // reaching the other's credential.
    expect(config.providers['claude-code']?.authVolume).not.toBe(config.providers.codex?.authVolume)
  })

  test('rejects a provider outside the catalog', () => {
    expect(() => env({ AVAILABLE_PROVIDERS: 'gemini' })).toThrow()
    expect(() => env({ AVAILABLE_PROVIDERS: '' })).toThrow()
  })

  test('refuses a provider nothing implements', () => {
    expect(() => runnerConfigFrom(env({ AVAILABLE_PROVIDERS: 'copilot' }), 'production')).toThrow(
      /copilot.*not implemented/,
    )
  })

  test('builds one adapter per configured provider', () => {
    const config = runnerConfigFrom(
      env({ RUNNER_BACKEND: 'local', AVAILABLE_PROVIDERS: 'claude-code,codex' }),
      'development',
    )

    expect([...providersFor(config).keys()].sort()).toEqual(['claude-code', 'codex'])
  })
})

// REQ-504, D7.
describe('renamed variables', () => {
  test('names the replacement for a variable that is no longer read', () => {
    expect(() => checkRenamedRunnerEnv({ RUNNER_AUTH_VOLUME: 'specmate_claude-auth' })).toThrow(
      RenamedRunnerEnvError,
    )
    expect(() => checkRenamedRunnerEnv({ RUNNER_CLI: 'claude' })).toThrow(/CLAUDE_CODE_CLI/)
    expect(() => checkRenamedRunnerEnv({ RUNNER_FORWARD_ENV: 'X' })).toThrow(
      /CLAUDE_CODE_FORWARD_ENV/,
    )
    expect(() => checkRenamedRunnerEnv({ RUNNER_MODEL: 'claude-opus-5' })).toThrow(/model-defaults/)
  })

  test('reports every offending variable at once', () => {
    expect(() =>
      checkRenamedRunnerEnv({ RUNNER_CLI: 'claude', RUNNER_MODEL: 'claude-opus-5' }),
    ).toThrow(/RUNNER_CLI[\s\S]*RUNNER_MODEL/)
  })

  test('treats an empty value as unset, which is what Compose supplies', () => {
    expect(() =>
      checkRenamedRunnerEnv({ RUNNER_CLI: '', RUNNER_AUTH_VOLUME: undefined }),
    ).not.toThrow()
  })
})
